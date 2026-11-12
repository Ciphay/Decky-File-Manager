import { FocusHandlers } from "../hooks/useInputGuards";
import { ChangeEvent, KeyboardEvent, useCallback, useRef } from "react";
import { TextField } from "@decky/ui";
import { t } from "../i18n";
import { safeBlur } from "../utils/focus";

export function usePathBarControl(focusList: () => void) {
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const suppressRef = useRef(true);
  const timerRef = useRef<number | null>(null);

  const getInput = useCallback(() => scopeRef.current?.querySelector<HTMLInputElement>("input") ?? null, []);

  const suppressFor = useCallback((ms: number) => {
    suppressRef.current = true;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      suppressRef.current = false;
      timerRef.current = null;
    }, ms);
  }, []);

  const rejectFocus = useCallback(() => {
    safeBlur(getInput());
    focusList();
  }, [focusList, getInput]);

  return { scopeRef, suppressRef, getInput, suppressFor, rejectFocus };
}

export type PathBarControl = ReturnType<typeof usePathBarControl>;

export default function PathBar({
  value,
  control,
  focusHandlers,
  onChange,
  onSubmit,
}: {
  value: string;
  control: PathBarControl;
  focusHandlers: FocusHandlers;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}) {
  const guarded = (handler: () => void) => () => {
    if (control.suppressRef.current) {
      control.rejectFocus();
      return;
    }
    handler();
  };

  return (
    <div ref={control.scopeRef} data-path-input style={{ width: "calc(100% - 30px)", boxSizing: "border-box", margin: "0 15px", padding: 0 }}>
      <TextField
        tabIndex={-1}
        value={value}
        onFocus={guarded(focusHandlers.onFocus)}
        onClick={guarded(focusHandlers.onFocus)}
        onBlur={focusHandlers.onBlur}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.currentTarget.value)}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit(value);
          }
        }}
        bShowCopyAction={false}
        tooltip={t("tooltip.currentPath")}
      />
    </div>
  );
}
