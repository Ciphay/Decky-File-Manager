import { useCallback, useEffect, useRef } from "react";
import { unregisterSteamCallback } from "../utils/steamInput";

export type InputName = "path" | "rename" | "createFolder" | "addShortcut" | "drive";
export type InputGuard = { focused: boolean; keyboardOpen: boolean };
export type InputGuards = Record<InputName, InputGuard>;

export const KEYBOARD_BACK_GRACE_MS = 450;

const createGuards = (): InputGuards => ({
  path: { focused: false, keyboardOpen: false },
  rename: { focused: false, keyboardOpen: false },
  createFolder: { focused: false, keyboardOpen: false },
  addShortcut: { focused: false, keyboardOpen: false },
  drive: { focused: false, keyboardOpen: false },
});

export function useInputGuards() {
  const guardsRef = useRef<InputGuards>(createGuards());
  const suppressUntilRef = useRef(0);

  useEffect(() => {
    const input = (window as any).SteamClient?.Input;
    const registration = input?.RegisterForUserDismissKeyboardMessages?.(() => {
      Object.values(guardsRef.current).forEach((guard) => {
        guard.keyboardOpen = false;
      });
      suppressUntilRef.current = Date.now() + KEYBOARD_BACK_GRACE_MS;
    });
    return () => unregisterSteamCallback(registration);
  }, []);

  const isKeyboardOpen = useCallback(() => Object.values(guardsRef.current).some((guard) => guard.focused && guard.keyboardOpen), []);

  const consumeKeyboardBack = useCallback((): boolean => {
    const now = Date.now();
    if (isKeyboardOpen()) {
      Object.values(guardsRef.current).forEach((guard) => {
        guard.keyboardOpen = false;
      });
      suppressUntilRef.current = now + KEYBOARD_BACK_GRACE_MS;
      return true;
    }
    return now < suppressUntilRef.current;
  }, [isKeyboardOpen]);

  const bind = useCallback((name: InputName) => ({
    onFocus: () => {
      guardsRef.current[name].focused = true;
      guardsRef.current[name].keyboardOpen = true;
    },
    onBlur: () => {
      guardsRef.current[name].focused = false;
      guardsRef.current[name].keyboardOpen = false;
    },
    onActivate: () => {
      if (guardsRef.current[name].focused) guardsRef.current[name].keyboardOpen = true;
    },
    consumeBack: consumeKeyboardBack,
  }), [consumeKeyboardBack]);

  return { guardsRef, bind, isKeyboardOpen, consumeKeyboardBack };
}

export type FocusHandlers = {
  onFocus: () => void;
  onBlur: () => void;
  onActivate?: () => void;
  consumeBack?: () => boolean;
};

export type InputGuardBinder = ReturnType<typeof useInputGuards>["bind"];
