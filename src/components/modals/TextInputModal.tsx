import { ChangeEvent, FocusEvent, KeyboardEvent, useEffect, useRef } from "react";
import { DialogButton, Focusable, NavEntryPositionPreferences, TextField } from "@decky/ui";
import { t } from "../../i18n";
import { FocusHandlers } from "../../hooks/useInputGuards";
import ModalFrame, { BUTTON_ROW_STYLE } from "./ModalFrame";

export default function TextInputModal({
  title,
  value,
  confirmLabel,
  error,
  selectOnOpen = false,
  isPassword = false,
  message,
  focusHandlers,
  onChange,
  onConfirm,
  onCancel,
}: {
  title: string;
  value: string;
  confirmLabel: string;
  error?: string | null;
  selectOnOpen?: boolean;
  isPassword?: boolean;
  message?: string;
  focusHandlers: FocusHandlers;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const cancel = () => {
    if (focusHandlers.consumeBack?.()) return;
    onCancel();
  };

  const selectedRef = useRef(false);

  useEffect(() => {
    if (!isPassword) return;
    const timer = window.setTimeout(() => scopeRef.current?.querySelector<HTMLInputElement>("input")?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [isPassword]);

  return (
    <ModalFrame title={title} onCancel={cancel} preferControls={!isPassword}>
      {message ? <div style={{ textAlign: "center", marginBottom: 8, opacity: 0.9 }}>{message}</div> : null}
      {error ? <div style={{ color: "#f55", fontSize: 14, marginBottom: 8, textAlign: "center" }}>{error}</div> : null}
      <div ref={scopeRef} style={{ padding: "6px 0" }}>
        <TextField
          value={value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.currentTarget.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onConfirm();
            }
          }}
          onFocus={(e: FocusEvent<HTMLInputElement>) => {
            focusHandlers.onFocus();
            if (selectOnOpen && !selectedRef.current) {
              selectedRef.current = true;
              e.currentTarget.select?.();
            }
          }}
          onBlur={focusHandlers.onBlur}
          onClick={focusHandlers.onActivate}
          bShowCopyAction={false}
          bIsPassword={isPassword}
        />
      </div>
      <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X} style={BUTTON_ROW_STYLE}>
        <DialogButton onClick={onConfirm} style={{ flex: 1 }}>{confirmLabel}</DialogButton>
        <DialogButton onClick={onCancel} style={{ flex: 1 }}>{t("action.cancel")}</DialogButton>
      </Focusable>
    </ModalFrame>
  );
}
