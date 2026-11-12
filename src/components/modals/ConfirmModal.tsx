import { DialogButton, Focusable, NavEntryPositionPreferences } from "@decky/ui";
import { t } from "../../i18n";
import ModalFrame, { BUTTON_ROW_STYLE } from "./ModalFrame";

export default function ConfirmModal({ title, message, onConfirm, onCancel }: { title: string; message: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <ModalFrame title={title} onCancel={onCancel}>
      <div style={{ padding: "6px 0", textAlign: "center" }}>{message}</div>
      <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X} style={BUTTON_ROW_STYLE}>
        <DialogButton onClick={onCancel} style={{ flex: 1 }}>{t("action.no")}</DialogButton>
        <DialogButton onClick={onConfirm} style={{ flex: 1 }}>{t("action.yes")}</DialogButton>
      </Focusable>
    </ModalFrame>
  );
}
