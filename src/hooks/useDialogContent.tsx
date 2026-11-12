import { ReactNode, useMemo } from "react";
import { DialogState } from "../dialogs";
import { t } from "../i18n";
import AddShortcutModal from "../components/modals/AddShortcutModal";
import ConfirmModal from "../components/modals/ConfirmModal";
import ConflictModal from "../components/modals/ConflictModal";
import MessageModal from "../components/modals/MessageModal";
import OperationModal from "../components/modals/OperationModal";
import PropertiesModal from "../components/modals/PropertiesModal";
import TextInputModal from "../components/modals/TextInputModal";
import { InputGuardBinder } from "./useInputGuards";
import { useAddShortcut } from "./useAddShortcut";
import { useClipboardActions } from "./useClipboardActions";
import { useItemActions } from "./useItemActions";
import { useOperationRunner } from "./useOperationRunner";
import { useDriveActions } from "./useDriveActions";

type Params = {
  dialog: DialogState;
  operationModal: ReturnType<typeof useOperationRunner>["operationModal"];
  setDialog: (updater: DialogState | ((current: DialogState) => DialogState)) => void;
  closeDialog: () => void;
  bind: InputGuardBinder;
  clipboard: ReturnType<typeof useClipboardActions>;
  itemActions: ReturnType<typeof useItemActions>;
  shortcut: ReturnType<typeof useAddShortcut>;
  runner: ReturnType<typeof useOperationRunner>;
  drives: ReturnType<typeof useDriveActions>;
};

export function useDialogContent({ dialog, operationModal, setDialog, closeDialog, bind, clipboard, itemActions, shortcut, runner, drives }: Params): ReactNode | null {
  const { confirmCreateFolder, confirmRename, confirmDelete } = itemActions;
  const { resolveConflict } = clipboard;
  const { confirmAddShortcut } = shortcut;
  const { moveToBackground, requestPauseToggle, requestCancel } = runner;
  const { confirmRename: confirmDriveRename } = drives;

  return useMemo(() => {
    if (operationModal) {
      return (
        <OperationModal
          operation={operationModal}
          onBackground={moveToBackground}
          onPauseToggle={() => void requestPauseToggle()}
          onCancel={() => void requestCancel()}
        />
      );
    }
    if (!dialog) return null;

    switch (dialog.kind) {
      case "rename":
        return (
          <TextInputModal
            title={t("modal.rename")}
            value={dialog.value}
            confirmLabel={t("action.save")}
            selectOnOpen
            focusHandlers={bind("rename")}
            onChange={(value) => setDialog((current) => (current?.kind === "rename" ? { ...current, value } : current))}
            onConfirm={() => void confirmRename(dialog)}
            onCancel={closeDialog}
          />
        );
      case "createFolder":
        return (
          <TextInputModal
            title={t("modal.new_folder")}
            value={dialog.name}
            confirmLabel={t("action.create")}
            focusHandlers={bind("createFolder")}
            onChange={(name) => setDialog((current) => (current?.kind === "createFolder" ? { ...current, name } : current))}
            onConfirm={() => void confirmCreateFolder(dialog)}
            onCancel={closeDialog}
          />
        );
      case "delete":
        return (
          <ConfirmModal
            title={t("modal.confirm_delete")}
            message={t("modal.delete_question").replace("{name}", dialog.name)}
            onConfirm={() => void confirmDelete(dialog)}
            onCancel={closeDialog}
          />
        );
      case "conflict":
        return (
          <ConflictModal
            title={dialog.title}
            message={dialog.message}
            isFolder={dialog.isFolder}
            onChoose={(strategy) => void resolveConflict(dialog.targetDir, dialog.itemName, strategy)}
            onCancel={closeDialog}
          />
        );
      case "message":
        return <MessageModal title={dialog.title} message={dialog.message} onClose={closeDialog} />;
      case "properties":
        return <PropertiesModal data={dialog.data} calculating={dialog.calculating} onClose={closeDialog} />;
      case "driveRename":
        return (
          <TextInputModal
            title={t("drive.rename.title")}
            value={dialog.value}
            confirmLabel={t("action.save")}
            selectOnOpen
            focusHandlers={bind("drive")}
            onChange={(value) => setDialog((current) => (current?.kind === "driveRename" ? { ...current, value } : current))}
            onConfirm={() => void confirmDriveRename(dialog)}
            onCancel={closeDialog}
          />
        );
      case "password":
        return (
          <TextInputModal
            title={dialog.title}
            message={dialog.message}
            error={dialog.error}
            value={dialog.value}
            confirmLabel={t("action.confirm")}
            isPassword
            focusHandlers={bind("drive")}
            onChange={(value) => setDialog((current) => (current?.kind === "password" ? { ...current, value, error: null } : current))}
            onConfirm={() => void dialog.submit(dialog.value)}
            onCancel={closeDialog}
          />
        );
      case "addShortcut":
        return (
          <AddShortcutModal
            name={dialog.name}
            error={dialog.error}
            focusHandlers={bind("addShortcut")}
            onChangeName={(name) => setDialog((current) => (current?.kind === "addShortcut" ? { ...current, name } : current))}
            onConfirm={() => void confirmAddShortcut(dialog)}
            onCancel={closeDialog}
          />
        );
    }
  }, [bind, closeDialog, confirmAddShortcut, confirmCreateFolder, confirmDelete, confirmRename, dialog, confirmDriveRename, moveToBackground, operationModal, requestCancel, requestPauseToggle, resolveConflict, setDialog]);
}
