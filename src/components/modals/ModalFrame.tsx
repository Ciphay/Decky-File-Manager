import { ReactNode } from "react";
import { DialogBody, Focusable, ModalRoot, NavEntryPositionPreferences } from "@decky/ui";
import { ModalFocusScope } from "../../utils/focus";

export default function ModalFrame({
  title,
  onCancel,
  children,
  lockBackground = true,
  preferControls = false,
}: {
  title?: string;
  onCancel: () => void;
  children: ReactNode;
  lockBackground?: boolean;
  preferControls?: boolean;
}) {
  return (
    <ModalRoot show={true} bDisableBackgroundDismiss={lockBackground} bHideMainWindowForPopouts={true} onCancel={onCancel}>
      <DialogBody>
        <ModalFocusScope preferControls={preferControls}>
          <Focusable
            navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
            onCancel={onCancel}
            onCancelButton={onCancel}
            style={{ outline: "none", display: "flex", flexDirection: "column", alignItems: "stretch" }}
          >
            {title ? (
              <div style={{ textAlign: "center", padding: "6px 0 12px" }}>
                <h1 style={{ margin: 0 }}>{title}</h1>
              </div>
            ) : null}
            {children}
          </Focusable>
        </ModalFocusScope>
      </DialogBody>
    </ModalRoot>
  );
}

export const BUTTON_ROW_STYLE = { display: "flex", gap: 12, width: "100%", marginTop: 16 } as const;
