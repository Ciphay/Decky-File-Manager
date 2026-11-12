import { DialogButton, Focusable } from "@decky/ui";
import { t } from "../../i18n";
import { OperationModalState } from "../../dialogs";
import ModalFrame from "./ModalFrame";

export default function OperationModal({
  operation,
  onBackground,
  onPauseToggle,
  onCancel,
}: {
  operation: NonNullable<OperationModalState>;
  onBackground: () => void;
  onPauseToggle: () => void;
  onCancel: () => void;
}) {
  const progress = Math.max(0, Math.min(100, operation.progress));

  return (
    <ModalFrame onCancel={onCancel}>
      <div style={{ minWidth: 280, padding: "8px 0" }}>
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <strong>{operation.label}</strong>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
          <div style={{ height: 12, borderRadius: 999, background: "#2b2b2b", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${progress}%`, background: "#4e8ad9", transition: "width 0.2s linear" }} />
          </div>
          <div style={{ textAlign: "left", fontSize: 12 }}>{Math.floor(progress)}%</div>
          <Focusable style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
            {operation.showBackground ? (
              <DialogButton style={{ flex: 1, minWidth: 0 }} onClick={onBackground}>{t("action.continue_in_background")}</DialogButton>
            ) : null}
            <DialogButton style={{ flex: 1, minWidth: 0 }} onClick={onPauseToggle}>
              {operation.paused ? t("action.resume") : t("action.pause")}
            </DialogButton>
            <DialogButton style={{ flex: 1, minWidth: 0 }} onClick={onCancel}>{t("action.cancel")}</DialogButton>
          </Focusable>
        </div>
      </div>
    </ModalFrame>
  );
}
