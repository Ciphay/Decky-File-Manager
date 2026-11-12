import { DialogButton, Focusable, NavEntryPositionPreferences } from "@decky/ui";
import { t } from "../i18n";
import { PauseIcon, PlayIcon, StopIcon } from "../Icons";
import { BackgroundOperationState } from "../utils/backgroundStore";

const BUTTON_STYLE = { width: 40, height: 40, minWidth: 40, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" } as const;

export default function BackgroundOperationRow({
  operation,
  onPauseToggle,
  onCancel,
}: {
  operation: BackgroundOperationState;
  onPauseToggle: (operation: BackgroundOperationState) => void;
  onCancel: (operation: BackgroundOperationState) => void;
}) {
  const progress = Math.max(0, Math.min(100, operation.progress));

  return (
    <div style={{ width: "100%", display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{operation.label}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 12, color: "#aaa", flexShrink: 0 }}>{Math.floor(progress)}%</div>
          <div style={{ flex: 1, height: 8, borderRadius: 999, background: "#2b2b2b", overflow: "hidden" }}>
            <div style={{ width: `${progress}%`, height: "100%", background: "#4e8ad9", transition: "width 0.2s linear" }} />
          </div>
        </div>
      </div>
      <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X} style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        <DialogButton
          focusable
          onClick={() => onPauseToggle(operation)}
          aria-label={operation.paused ? t("action.resume") : t("action.pause")}
          style={BUTTON_STYLE}
        >
          {operation.paused ? <PlayIcon /> : <PauseIcon />}
        </DialogButton>
        <DialogButton focusable onClick={() => onCancel(operation)} aria-label={t("action.cancel")} style={BUTTON_STYLE}>
          <StopIcon />
        </DialogButton>
      </Focusable>
    </div>
  );
}
