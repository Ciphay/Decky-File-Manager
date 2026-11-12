import { useCallback, useEffect, useState } from "react";
import { Navigation, Router } from "@decky/ui";
import { FileEntry, readFileContent, setFileSelection } from "../api";
import { t } from "../i18n";
import { handOffToEditor } from "../utils/editorHandoff";
import { peekSelectionIntent } from "../utils/launchIntent";
import { PickSession } from "../fileDialog/pickerSession";
import { showErrorToast } from "../utils/operationToast";
import { messageOf } from "../utils/paths";

export type SelectionKind = "shortcut" | "result-file" | "text-editor" | "pick";

export type LaunchParams = {
  selectionKind: SelectionKind | null;
  resultFile: string | null;
  startPath: string;
};

export const readLaunchParams = (): LaunchParams => {
  const params = new URLSearchParams(window.location.search);
  const pathname = window.location.pathname || "";
  const mode = pathname.endsWith("/select-file") ? "select-file" : pathname.endsWith("/select") ? "select" : params.get("mode");

  let selectionKind: SelectionKind | null = null;
  if (params.get("textEditorMode") === "true") selectionKind = "text-editor";
  else if (mode === "select-file") selectionKind = "shortcut";
  else if (mode === "select") selectionKind = "result-file";
  else if (mode !== "normal") selectionKind = peekSelectionIntent();

  return { selectionKind, resultFile: params.get("resultFile"), startPath: params.get("path") ?? "" };
};

export function useLaunchParams() {
  const [params, setParams] = useState<LaunchParams>(readLaunchParams);

  useEffect(() => {
    const sync = () => setParams((previous) => {
      const next = readLaunchParams();
      return next.selectionKind === previous.selectionKind && next.resultFile === previous.resultFile && next.startPath === previous.startPath ? previous : next;
    });
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  return params;
}

type SelectionParams = {
  params: LaunchParams;
  openAddShortcut: (item: FileEntry) => void;
  exitPlugin: () => void;
  pick?: PickSession;
};

export function useSelectionAction({ params, openAddShortcut, exitPlugin, pick }: SelectionParams) {
  return useCallback(async (item: FileEntry) => {
    if (!params.selectionKind || item.is_dir) return;

    if (params.selectionKind === "pick") {
      if (pick && !pick.request.chooseDirectory) pick.resolve(item.path);
      return;
    }

    if (params.selectionKind === "shortcut") {
      openAddShortcut(item);
      return;
    }

    if (params.selectionKind === "text-editor") {
      try {
        const result = await readFileContent(item.path);
        if (!result.success || result.content === undefined) {
          showErrorToast(result.error || t("error.could_not_open_file"));
          return;
        }
        handOffToEditor({ path: item.path, content: result.content });
        Router.CloseSideMenus?.();
        Navigation.NavigateBack?.();
      } catch (e) {
        showErrorToast(messageOf(e, t("error.could_not_open_file")));
      }
      return;
    }

    try {
      const result = await setFileSelection(item.path, params.resultFile);
      if (!result.success) throw new Error(result.error);
      exitPlugin();
    } catch (e) {
      showErrorToast(messageOf(e, t("error.could_not_select_file")));
    }
  }, [exitPlugin, openAddShortcut, params.resultFile, params.selectionKind, pick]);
}
