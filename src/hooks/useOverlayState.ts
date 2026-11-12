import { useCallback, useRef } from "react";
import { MENU_OVERLAY_SELECTOR, getOverlaySelector, isElementActuallyVisible } from "../utils/focus";

export type ContextMenuHandle = { Hide(): void };

export function useOverlayState(hasDialog: boolean) {
  const contextMenuRef = useRef<ContextMenuHandle | null>(null);
  const lastRemovedAtRef = useRef(0);

  const markOverlayRemoved = useCallback(() => {
    lastRemovedAtRef.current = Date.now();
  }, []);

  const clearContextMenu = useCallback(() => {
    if (!contextMenuRef.current) return;
    try {
      contextMenuRef.current.Hide();
    } catch (e) {
      console.warn("context menu hide failed", e);
    }
    contextMenuRef.current = null;
    lastRemovedAtRef.current = Date.now();
  }, []);

  const isAnyOverlayOpen = useCallback((): boolean => {
    if (contextMenuRef.current) {
      const menuVisible = Array.from(document.querySelectorAll<HTMLElement>(MENU_OVERLAY_SELECTOR)).some(isElementActuallyVisible);
      if (menuVisible) return true;
      clearContextMenu();
    }

    const selector = getOverlaySelector();
    const activeOverlay = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(selector);
    if (activeOverlay && isElementActuallyVisible(activeOverlay)) return true;
    if (Array.from(document.querySelectorAll<HTMLElement>(selector)).some(isElementActuallyVisible)) return true;

    return hasDialog;
  }, [clearContextMenu, hasDialog]);

  return { contextMenuRef, lastRemovedAtRef, markOverlayRemoved, clearContextMenu, isAnyOverlayOpen };
}

export type OverlayState = ReturnType<typeof useOverlayState>;
