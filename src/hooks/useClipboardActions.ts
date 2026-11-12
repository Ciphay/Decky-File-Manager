import { useCallback, useEffect, useState } from "react";
import { FileEntry, checkPasteConflict, copyPath, cutPath, hasClipboard, pastePathWithOptions } from "../api";
import { DialogState } from "../dialogs";
import { t, tf } from "../i18n";
import { isPermissionError } from "../utils/operationText";
import { showErrorToast } from "../utils/operationToast";
import { messageOf } from "../utils/paths";
import { ConflictStrategy } from "../components/modals/ConflictModal";
import { RunOperation } from "./useOperationRunner";

type Params = {
  runOperation: RunOperation;
  setDialog: (dialog: DialogState) => void;
};

export function useClipboardActions({ runOperation, setDialog }: Params) {
  const [clipboardHas, setClipboardHas] = useState(false);

  const refreshClipboard = useCallback(async (): Promise<boolean> => {
    try {
      const has = Boolean((await hasClipboard()).has);
      setClipboardHas(has);
      return has;
    } catch (e) {
      console.warn("Clipboard check failed:", e);
      setClipboardHas(false);
      return false;
    }
  }, []);

  useEffect(() => {
    void refreshClipboard();
  }, [refreshClipboard]);

  const reportError = useCallback((error: unknown, fallback: string) => {
    if (isPermissionError(error)) {
      setDialog({ kind: "message", title: t("modal.permission_denied"), message: t("permission.denied") });
    } else {
      showErrorToast(messageOf(error, fallback));
    }
  }, [setDialog]);

  const runPaste = useCallback(async (targetDir: string, strategy: string, itemName: string) => {
    const name = itemName || t("common.item");
    const pasteLabel = `${t("action.pasting")}: ${name}`;
    const moveLabel = `${t("action.moving")}: ${name}`;
    const result = await runOperation(pasteLabel, (operationId) => pastePathWithOptions(targetDir, strategy, false, pasteLabel, moveLabel, operationId), {
      showBackground: true,
      onError: (e) => reportError(e, t("action.failed")),
    });

    if (result?.skipped_count) {
      const names = (result.skipped_items ?? []).join(", ");
      setDialog({ kind: "message", title: t("modal.warning"), message: `${tf("paste.skipped", { count: result.skipped_count })}\n${names}` });
    }
  }, [reportError, runOperation, setDialog]);

  const paste = useCallback(async (targetDir: string) => {
    try {
      const conflict = await checkPasteConflict(targetDir);
      if (conflict.blocked) {
        const message = conflict.reason === "same-directory" ? t("error.same_directory") : t("paste.blocked");
        setDialog({ kind: "message", title: t("modal.warning"), message });
        return;
      }
      if (conflict.needs_conflict) {
        setDialog({
          kind: "conflict",
          title: conflict.is_dir ? t("conflict.folder_exists") : t("conflict.file_exists"),
          message: tf("conflict.message", { name: conflict.name }),
          targetDir,
          itemName: conflict.name,
          isFolder: Boolean(conflict.is_dir),
        });
        return;
      }
      await runPaste(targetDir, "keep-both", conflict.name);
    } catch (e) {
      showErrorToast(messageOf(e, t("error.prepare_paste")));
    }
  }, [runPaste, setDialog]);

  const resolveConflict = useCallback(async (targetDir: string, itemName: string, strategy: ConflictStrategy) => {
    setDialog(null);
    await runPaste(targetDir, strategy, itemName);
  }, [runPaste, setDialog]);

  const copy = useCallback(async (item: FileEntry) => {
    try {
      await copyPath(item.path);
      await refreshClipboard();
    } catch (e) {
      showErrorToast(messageOf(e, t("error.could_not_copy")));
    }
  }, [refreshClipboard]);

  const cut = useCallback(async (item: FileEntry) => {
    try {
      await cutPath(item.path);
      await refreshClipboard();
    } catch (e) {
      showErrorToast(messageOf(e, t("error.could_not_cut")));
    }
  }, [refreshClipboard]);

  const transferToOtherPane = useCallback(async (item: FileEntry, kind: "copy" | "cut", sourceDir: string, destinationDir: string) => {
    if (sourceDir === destinationDir) {
      setDialog({ kind: "message", title: t("modal.warning"), message: t("error.same_directory") });
      return;
    }
    try {
      await (kind === "copy" ? copyPath : cutPath)(item.path);
      await refreshClipboard();
      await paste(destinationDir);
    } catch (e) {
      showErrorToast(messageOf(e, kind === "copy" ? t("error.could_not_copy") : t("error.could_not_cut")));
    }
  }, [paste, refreshClipboard, setDialog]);

  return { clipboardHas, refreshClipboard, copy, cut, paste, resolveConflict, transferToOtherPane, reportError };
}
