import { useCallback } from "react";
import { Router } from "@decky/ui";
import { FileEntry, createFolder, deletePath, extractArchive, getDirectorySize, getProperties, readFileContent, renamePath } from "../api";
import { Dialog, DialogState } from "../dialogs";
import { t } from "../i18n";
import { setSelectionIntent } from "../utils/launchIntent";
import { handOffToEditor } from "../utils/editorHandoff";
import { isPermissionError } from "../utils/operationText";
import { showErrorToast } from "../utils/operationToast";
import { messageOf } from "../utils/paths";
import { RunOperation } from "./useOperationRunner";

type Params = {
  runOperation: RunOperation;
  setDialog: (updater: DialogState | ((current: DialogState) => DialogState)) => void;
};

const INVALID_NAME = /[/\\\0]/;

export function useItemActions({ runOperation, setDialog }: Params) {
  const reportError = useCallback((error: unknown, fallback: string) => {
    if (isPermissionError(error)) {
      setDialog({ kind: "message", title: t("modal.permission_denied"), message: t("permission.denied") });
    } else {
      showErrorToast(messageOf(error, fallback));
    }
  }, [setDialog]);

  const openCreateFolder = useCallback((parentDir: string) => setDialog({ kind: "createFolder", parentDir, name: "" }), [setDialog]);
  const openRename = useCallback((item: FileEntry) => setDialog({ kind: "rename", path: item.path, value: item.name }), [setDialog]);
  const openDelete = useCallback((item: FileEntry) => setDialog({ kind: "delete", path: item.path, name: item.name }), [setDialog]);

  const confirmCreateFolder = useCallback(async (dialog: Extract<Dialog, { kind: "createFolder" }>) => {
    const name = dialog.name.trim();
    if (!name || name === "." || name === ".." || INVALID_NAME.test(name)) {
      showErrorToast(t("error.invalid_name"));
      return;
    }
    setDialog(null);
    const label = `${t("action.creating_folder")}: ${name}`;
    await runOperation(label, (operationId) => createFolder(dialog.parentDir, name, operationId), {
      showProgress: false,
      onError: (e) => reportError(e, t("error.could_not_create_folder")),
    });
  }, [reportError, runOperation, setDialog]);

  const confirmRename = useCallback(async (dialog: Extract<Dialog, { kind: "rename" }>) => {
    const name = dialog.value.trim();
    if (!name || name === "." || name === ".." || INVALID_NAME.test(name)) {
      showErrorToast(t("error.invalid_name"));
      return;
    }
    setDialog(null);
    const label = `${t("action.renaming")}: ${name}`;
    await runOperation(label, (operationId) => renamePath(dialog.path, name, operationId), {
      showProgress: false,
      onError: (e) => reportError(e, t("error.could_not_rename")),
    });
  }, [reportError, runOperation, setDialog]);

  const confirmDelete = useCallback(async (dialog: Extract<Dialog, { kind: "delete" }>) => {
    setDialog(null);
    const label = `${t("action.deleting")}: ${dialog.name || t("common.item")}`;
    await runOperation(label, (operationId) => deletePath(dialog.path, label, operationId), {
      onError: (e) => reportError(e, t("error.could_not_delete")),
    });
  }, [reportError, runOperation, setDialog]);

  const extract = useCallback(async (item: FileEntry, targetDir: string) => {
    const label = `${t("action.extracting")}: ${item.name}`;
    await runOperation(label, (operationId) => extractArchive(item.path, targetDir, label, operationId), {
      showBackground: true,
      onError: (e) => reportError(e, t("error.could_not_extract")),
    });
  }, [reportError, runOperation]);

  const showProperties = useCallback(async (item: FileEntry) => {
    try {
      const data = await getProperties(item.path);
      const isFolder = data.type === "folder";
      setDialog({ kind: "properties", data, calculating: isFolder });
      if (!isFolder) return;

      let size: number | null = null;
      try {
        size = (await getDirectorySize(item.path)).size;
      } catch {
        size = null;
      }
      setDialog((current) =>
        current?.kind === "properties" && current.data.path === data.path
          ? { kind: "properties", data: size === null ? current.data : { ...current.data, size }, calculating: false }
          : current,
      );
    } catch (e) {
      showErrorToast(messageOf(e, t("error.could_not_properties")));
    }
  }, [setDialog]);

  const openInTextEditor = useCallback(async (item: FileEntry) => {
    try {
      const result = await readFileContent(item.path);
      if (!result.success || result.content === undefined) {
        showErrorToast(result.error || t("error.could_not_open_file"));
        return;
      }
      setSelectionIntent(null);
      handOffToEditor({ path: item.path, content: result.content });
      Router.CloseSideMenus?.();
      Router.Navigate?.("/decky-manager/text-editor");
    } catch (e) {
      showErrorToast(messageOf(e, t("error.could_not_open_file")));
    }
  }, []);

  return { openCreateFolder, openRename, openDelete, confirmCreateFolder, confirmRename, confirmDelete, extract, showProperties, openInTextEditor };
}
