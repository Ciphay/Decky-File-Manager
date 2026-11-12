import { DialogButton } from "@decky/ui";
import { t } from "../../i18n";
import ModalFrame from "./ModalFrame";

export default function MessageModal({ title, message, onClose }: { title: string; message: string; onClose: () => void }) {
  return (
    <ModalFrame title={title} onCancel={onClose}>
      <div style={{ padding: "6px 0", textAlign: "center", whiteSpace: "pre-line", wordBreak: "break-word" }}>{message}</div>
      <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
        <DialogButton onClick={onClose}>{t("action.close")}</DialogButton>
      </div>
    </ModalFrame>
  );
}
