import { useCallback } from "react";
import { FileEntry, validateExecutable } from "../api";
import { Dialog, DialogState } from "../dialogs";
import { t } from "../i18n";
import { messageOf, getDirectoryOf, stripExtension } from "../utils/paths";

type Params = {
  setDialog: (updater: DialogState | ((current: DialogState) => DialogState)) => void;
  onAdded: () => void;
};

const quoteIfNeeded = (value: string) => (/\s/.test(value) ? `"${value}"` : value);

export function useAddShortcut({ setDialog, onAdded }: Params) {
  const openAddShortcut = useCallback((item: FileEntry | null) => {
    if (!item || item.is_dir) return;
    setDialog({ kind: "addShortcut", path: item.path, name: stripExtension(item.name), error: null });
  }, [setDialog]);

  const setError = useCallback((error: string | null) => {
    setDialog((current) => (current?.kind === "addShortcut" ? { ...current, error } : current));
  }, [setDialog]);

  const confirmAddShortcut = useCallback(async (dialog: Extract<Dialog, { kind: "addShortcut" }>) => {
    const shortcutName = dialog.name.trim();
    if (!shortcutName) {
      setError(t("shortcut.error.name_required"));
      return;
    }

    try {
      const validation = await validateExecutable(dialog.path);
      if (!validation.success) {
        setError(validation.error || t("shortcut.error.invalid_file"));
        return;
      }

      const apps = (window as any).SteamClient?.Apps;
      if (!apps?.AddShortcut) {
        setError(t("shortcut.error.steam_unavailable"));
        return;
      }

      const newAppId = await apps.AddShortcut(shortcutName, quoteIfNeeded(dialog.path), getDirectoryOf(dialog.path), "");
      if (typeof newAppId === "number" && !Number.isNaN(newAppId) && apps.SetShortcutName) {
        try {
          apps.SetShortcutName(newAppId, shortcutName);
        } catch (e) {
          console.warn("SteamClient.Apps.SetShortcutName not supported:", e);
        }
      }

      setDialog(null);
      onAdded();
    } catch (e) {
      setError(messageOf(e, t("shortcut.error.add_failed")));
    }
  }, [onAdded, setDialog, setError]);

  return { openAddShortcut, confirmAddShortcut };
}
