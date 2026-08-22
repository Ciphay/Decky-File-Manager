import React from "react";
import { t } from "./i18n";
import {
  ModalRoot,
  DialogBody,
  Focusable,
  TextField,
  DialogButton,
  DialogButtonPrimary,
  NavEntryPositionPreferences,
} from "@decky/ui";

export default function FileSelector({
  isOpen,
  path,
  name,
  error,
  onChangeName,
  onCancel,
  onConfirm,
  confirmRef,
  inputScopeRef,
  inputFocusedRef,
  inputKeyboardOpenRef,
}: {
  isOpen: boolean;
  path: string | null;
  name: string;
  error: string | null;
  onChangeName: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  confirmRef: React.RefObject<HTMLButtonElement | null> | null;
  inputScopeRef: React.RefObject<HTMLDivElement | null> | null;
  inputFocusedRef: React.RefObject<boolean | null> | null;
  inputKeyboardOpenRef: React.RefObject<boolean | null> | null;
}) {
  if (!isOpen || !path) return null;

  return (
    <ModalRoot show={true} bDisableBackgroundDismiss={true} bHideMainWindowForPopouts={true} onCancel={onCancel}>
      <DialogBody>
        <div role="dialog">
          <Focusable
            navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
            onCancel={onCancel}
            onCancelButton={onCancel}
            style={{ outline: "none", display: "flex", flexDirection: "column", alignItems: "stretch" }}
            data-add-game-modal
          >
            <div style={{ textAlign: "center", padding: "22px 0 18px" }}>
              <h1 style={{ margin: 0, fontSize: 22 }}>{t("modal.add_shortcut_title").replace("{name}", name)}</h1>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%", marginTop: 16 }}>
              {error && (
                <div style={{ color: "#f55", fontSize: 14, paddingLeft: 2, paddingRight: 2, marginBottom: 8 }}>{error}</div>
              )}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 14, marginBottom: 6, textAlign: "left" }}>{t("label.shortcut_name")}</div>
                <div ref={inputScopeRef}>
                  <TextField
                    value={name}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChangeName(e.currentTarget.value)}
                    onFocus={() => {
                      if (inputFocusedRef) (inputFocusedRef as any).current = true;
                      if (inputKeyboardOpenRef) (inputKeyboardOpenRef as any).current = true;
                    }}
                    onBlur={() => {
                      if (inputFocusedRef) (inputFocusedRef as any).current = false;
                      if (inputKeyboardOpenRef) (inputKeyboardOpenRef as any).current = false;
                    }}
                    bShowCopyAction={false}
                    data-add-game-input
                    autoFocus
                  />
                </div>
              </div>
              <Focusable
                navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
                style={{ display: "flex", gap: 12, width: "100%", marginTop: 8 }}
              >
                <DialogButtonPrimary ref={confirmRef as any} onClick={onConfirm} data-add-game-primary focusable style={{ flex: 1 }}>
                  {t("action.yes")}
                </DialogButtonPrimary>
                <DialogButton onClick={onCancel} focusable style={{ flex: 1 }}>
                  {t("action.no")}
                </DialogButton>
              </Focusable>
            </div>
          </Focusable>
        </div>
      </DialogBody>
    </ModalRoot>
  );
}
