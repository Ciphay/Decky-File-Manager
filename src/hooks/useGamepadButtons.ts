import { useEffect, useRef } from "react";
import {
  CONTEXT_MENU_SELECTORS,
  QUICK_ACCESS_SELECTORS,
  STEAM_MAIN_MENU_SELECTORS,
  getOverlaySelector,
  isElementActuallyVisible,
  isSteamMainMenuOpenInDom,
  isSteamQuickAccessMenuOpenInDom,
  isTextInputElement,
  safeBlur,
} from "../utils/focus";
import { unregisterSteamCallback } from "../utils/steamInput";

const BUTTON_B = 1;
const BUTTON_Y = 3;
const LONG_PRESS_MS = 200;
const RECENT_OVERLAY_MS = 400;

const OUTSIDE_OVERLAY_SELECTOR = [
  ...CONTEXT_MENU_SELECTORS,
  "[role='dialog']",
  "[data-decky-modal]",
  "[aria-expanded='true'][aria-haspopup]",
  ...QUICK_ACCESS_SELECTORS,
  ...STEAM_MAIN_MENU_SELECTORS,
].join(", ");

export type GamepadHandlers = {
  isQuickAccessVisible: boolean;
  hasDialog: boolean;
  isAnyOverlayOpen: () => boolean;
  isKeyboardOpen: () => boolean;
  consumeKeyboardBack: () => boolean;
  lastOverlayRemovedAt: () => number;
  closeTopOverlay: () => boolean;
  openContextMenu: () => void;
  goBack: () => void;
  exitPlugin: () => void;
  getScope: () => HTMLElement | null;
  getPathInput: () => HTMLInputElement | null;
  suppressPathFocus: () => void;
};

const isSteamOverlayOpen = (scope: HTMLElement | null, quickAccessVisible: boolean): boolean => {
  if (quickAccessVisible || isSteamQuickAccessMenuOpenInDom() || isSteamMainMenuOpenInDom()) return true;
  return Array.from(document.querySelectorAll<HTMLElement>(OUTSIDE_OVERLAY_SELECTOR)).some((overlay) => {
    if (!isElementActuallyVisible(overlay)) return false;
    if (!scope) return true;
    if (overlay.contains(scope)) return false;
    return !scope.contains(overlay) && !overlay.closest("[data-file-manager-scope]") && !overlay.closest("[data-file-manager-background]");
  });
};

export function useGamepadButtons(handlers: GamepadHandlers) {
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    const input = (window as any).SteamClient?.Input;
    if (!input?.RegisterForControllerInputMessages) return;

    let active = true;
    let backPressed = false;
    let consumed = false;
    let longPress = false;
    let timer: number | null = null;

    const clearTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const onPressB = () => {
      const h = latest.current;
      if (backPressed || isSteamOverlayOpen(h.getScope(), h.isQuickAccessVisible)) return;

      const active = document.activeElement as HTMLElement | null;
      const pathInput = h.getPathInput();
      const pathFocused = !!pathInput && active === pathInput;
      const overlayActive = h.hasDialog || h.isAnyOverlayOpen() || h.isKeyboardOpen() || Boolean(active?.closest(getOverlaySelector()));

      backPressed = true;
      longPress = false;
      clearTimer();

      if (h.consumeKeyboardBack()) {
        consumed = true;
        if (!h.hasDialog && isTextInputElement(active)) safeBlur(active);
        return;
      }

      if (pathFocused && !h.isKeyboardOpen() && !overlayActive) {
        h.suppressPathFocus();
        safeBlur(pathInput);
        consumed = true;
        h.goBack();
        return;
      }

      consumed = overlayActive;
      if (consumed) {
        if (!h.closeTopOverlay() && isTextInputElement(active)) {
          safeBlur(active);
        }
        return;
      }

      timer = window.setTimeout(() => {
        longPress = true;
        latest.current.exitPlugin();
      }, LONG_PRESS_MS);
    };

    const onReleaseB = () => {
      if (!backPressed) return;
      const h = latest.current;
      backPressed = false;
      clearTimer();

      const recentlyClosed = h.lastOverlayRemovedAt() > 0 && Date.now() - h.lastOverlayRemovedAt() < RECENT_OVERLAY_MS;
      const skip = consumed || recentlyClosed || longPress || isSteamOverlayOpen(h.getScope(), h.isQuickAccessVisible);
      consumed = false;
      longPress = false;
      if (!skip) h.goBack();
    };

    const registration = input.RegisterForControllerInputMessages((_controllerIndex: number, button: number, isPressed: boolean) => {
      if (!active) return;
      const h = latest.current;

      if (button === BUTTON_Y && isPressed) {
        if (isTextInputElement(document.activeElement as HTMLElement | null) || h.isAnyOverlayOpen()) return;
        h.openContextMenu();
      } else if (button === BUTTON_B) {
        if (isPressed) onPressB();
        else onReleaseB();
      }
    });

    return () => {
      active = false;
      clearTimer();
      unregisterSteamCallback(registration);
    };
  }, []);
}
