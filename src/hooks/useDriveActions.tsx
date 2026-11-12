import { useCallback } from "react";
import { Menu, MenuItem, showContextMenu } from "@decky/ui";
import { DriveResult, mountDrive, renameDrive, unmountDrive } from "../api";
import { Dialog, DialogState } from "../dialogs";
import { t } from "../i18n";
import { DriveInfo } from "../utils/drives";
import { showErrorToast } from "../utils/operationToast";
import { messageOf } from "../utils/paths";
import { OverlayState } from "./useOverlayState";

type SetDialog = (updater: DialogState | ((current: DialogState) => DialogState)) => void;

type Params = {
  drives: DriveInfo[];
  setDialog: SetDialog;
  overlay: OverlayState;
  refreshDrives: () => Promise<void>;
  openPath: (path: string) => void;
  onUnmounted: (mountPath: string) => void;
};

export function useDriveActions({ drives, setDialog, overlay, refreshDrives, openPath, onUnmounted }: Params) {
  const withPassword = useCallback(async (title: string, run: (password: string | null) => Promise<DriveResult>, onSuccess: (result: DriveResult) => void, failure: string) => {
    const report = (result: DriveResult) => showErrorToast(result.error || failure);

    let first: DriveResult;
    try {
      first = await run(null);
    } catch (e) {
      showErrorToast(messageOf(e, failure));
      return;
    }
    if (first.ok) return onSuccess(first);
    if (!first.needs_password) return report(first);

    const submit = async (password: string): Promise<void> => {
      let result: DriveResult;
      try {
        result = await run(password);
      } catch (e) {
        showErrorToast(messageOf(e, failure));
        setDialog(null);
        return;
      }
      if (result.wrong_password) {
        setDialog((current) => (current?.kind === "password" ? { ...current, value: "", error: t("drive.password.wrong") } : current));
        return;
      }
      setDialog(null);
      if (result.ok) onSuccess(result);
      else report(result);
    };

    setDialog({ kind: "password", title, message: t("drive.password.message"), value: "", error: null, submit });
  }, [setDialog]);

  const mount = useCallback((drive: DriveInfo, passphrase: string | null = null) => {
    if (!drive.device) return;
    const device = drive.device;
    void withPassword(t("drive.password.title"), (password) => mountDrive(device, password, passphrase), (result) => {
      void refreshDrives();
      if (result.path) openPath(result.path);
    }, t("error.could_not_mount_drive"));
  }, [openPath, refreshDrives, withPassword]);

  const unlock = useCallback((drive: DriveInfo) => {
    const failure = t("error.could_not_mount_drive");
    const submit = async (passphrase: string): Promise<void> => {
      let result: DriveResult;
      try {
        result = await mountDrive(drive.device as string, null, passphrase);
      } catch (e) {
        showErrorToast(messageOf(e, failure));
        setDialog(null);
        return;
      }
      if (result.wrong_passphrase) {
        setDialog((current) => (current?.kind === "password" ? { ...current, value: "", error: t("drive.passphrase.wrong") } : current));
        return;
      }
      setDialog(null);
      if (result.ok) {
        void refreshDrives();
        if (result.path) openPath(result.path);
      } else if (result.needs_password) {
        mount(drive, passphrase);
      } else {
        showErrorToast(result.error || failure);
      }
    };
    setDialog({ kind: "password", title: t("drive.unlock.title"), message: t("drive.unlock.message").replace("{name}", drive.name), value: "", error: null, submit });
  }, [mount, openPath, refreshDrives, setDialog]);

  const activate = useCallback((drive: DriveInfo) => {
    if (drive.mounted !== false) openPath(drive.path);
    else if (drive.encrypted) unlock(drive);
    else mount(drive);
  }, [mount, openPath, unlock]);

  const unmount = useCallback((drive: DriveInfo) => {
    if (!drive.device) return;
    const device = drive.device;
    void withPassword(t("drive.password.title"), (password) => unmountDrive(device, password), () => {
      onUnmounted(drive.path);
      void refreshDrives();
    }, t("drive.error.unmount"));
  }, [onUnmounted, refreshDrives, withPassword]);

  const confirmRename = useCallback(async (dialog: Extract<Dialog, { kind: "driveRename" }>) => {
    const label = dialog.value.trim();
    if (!label) return;
    setDialog(null);
    await withPassword(t("drive.password.title"), (password) => renameDrive(dialog.device, label, password), () => void refreshDrives(), t("drive.error.rename"));
  }, [refreshDrives, setDialog, withPassword]);

  const openDriveMenu = useCallback((drivePath: string) => {
    const drive = drives.find((entry) => entry.path === drivePath);
    if (!drive || drive.system || !drive.device) return;
    if (overlay.isAnyOverlayOpen()) return;
    overlay.clearContextMenu();

    const once = (action: () => void) => {
      let done = false;
      return () => {
        if (done) return;
        done = true;
        overlay.clearContextMenu();
        action();
      };
    };
    const rename = once(() => setDialog({ kind: "driveRename", device: drive.device as string, value: drive.name }));
    const doUnmount = once(() => unmount(drive));
    const anchor = document.querySelector<HTMLElement>(`[data-drive-path="${CSS.escape(drive.path)}"]`) ?? (document.activeElement as HTMLElement | null) ?? undefined;

    overlay.contextMenuRef.current = showContextMenu(
      <Menu label={drive.name}>
        <MenuItem onClick={rename} onSelected={rename}>{t("drive.menu.rename")}</MenuItem>
        {drive.mounted ? <MenuItem onClick={doUnmount} onSelected={doUnmount}>{t("drive.menu.unmount")}</MenuItem> : null}
      </Menu>,
      anchor,
    );
  }, [drives, overlay, setDialog, unmount]);

  return { activate, openDriveMenu, confirmRename };
}
