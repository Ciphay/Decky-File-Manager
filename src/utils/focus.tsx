import { ReactNode, useEffect, useRef } from "react";

export const FOCUSABLE_SELECTOR = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1']):not([disabled])";

export function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];

  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.getAttribute("aria-hidden") === "true") return false;
    if (element.closest("[inert]")) return false;
    if (element.hasAttribute("disabled")) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  });
}

export function isTextInputElement(element: HTMLElement | null): boolean {
  if (!element) return false;

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return true;
  }

  return element.isContentEditable;
}

export const OVERLAY_SELECTORS = [
  "#QuickAccess-Menu",
  "#QuickAccess-NA",
  "[id^='QuickAccess-']",
  "[id^='QuickAccess_']",
  "[id^='quickaccess_']",
  "[id^='quickaccess_tab_']",
  "[id^='quickaccess_content_']",
  ".contextMenu",
  ".contextMenuContents",
  ".BasicContextMenuModal",
  "[role='menu']",
  "[role='dialog']",
  "[data-modal-root]",
  "[data-decky-modal]",
  "[aria-expanded='true']",
  "[aria-haspopup]",
];

export const MENU_OVERLAY_SELECTOR = [
  "#QuickAccess-Menu",
  "#QuickAccess-NA",
  "[id^='QuickAccess-']",
  "[id^='QuickAccess_']",
  "[id^='quickaccess_']",
  "[id^='quickaccess_tab_']",
  "[id^='quickaccess_content_']",
  ".contextMenu",
  ".contextMenuContents",
  ".BasicContextMenuModal",
  "[role='menu']",
].join(", ");

export function getOverlaySelector(): string {
  return OVERLAY_SELECTORS.join(", ");
}

export function safeFocus(element: HTMLElement | null | undefined): void {
  if (!element) return;
  try {
    element.focus();
  } catch (e) {
    console.error("safeFocus error:", e);
  }
}

export function safeBlur(element: HTMLElement | null | undefined): void {
  if (!element) return;
  try {
    element.blur();
  } catch (e) {
    console.error("safeBlur error:", e);
  }
}

export function safeClick(element: HTMLElement | null | undefined): void {
  if (!element) return;
  try {
    element.click();
  } catch (e) {
    console.error("safeClick error:", e);
  }
}

export function safeSetAttribute(element: HTMLElement | null | undefined, name: string, value: string): void {
  if (!element) return;
  try {
    element.setAttribute(name, value);
  } catch (e) {
    console.error("safeSetAttribute error:", e);
  }
}

export function ModalFocusScope({ children }: { children: ReactNode }) {
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const scope = scopeRef.current;
    if (!scope) return;

    const backgroundScope = document.querySelector<HTMLElement>("[data-file-manager-background]");
    const fileManagerScope = document.querySelector<HTMLElement>("[data-file-manager-scope]");
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const restoreFocus = () => {
      const previous = previousFocusRef.current;
      if (previous && document.contains(previous)) {
        safeFocus(previous);
        return;
      }

      const fallback = getFocusableElements(backgroundScope ?? fileManagerScope)[0];
      if (fallback) {
        safeFocus(fallback);
      }
    };

    const trapFocus = (event: KeyboardEvent) => {
      const activeElement = document.activeElement as HTMLElement | null;
      if (!scope.contains(activeElement)) {
        const focusables = getFocusableElements(scope);
        if (focusables.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          focusables[0].focus();
        }
        return;
      }

      if (event.key === "Tab") {
        const focusables = getFocusableElements(scope);
        if (focusables.length === 0) {
          event.preventDefault();
          scope.focus();
          return;
        }

        const currentIndex = focusables.indexOf(activeElement as HTMLElement);
        const nextIndex = event.shiftKey
          ? (currentIndex <= 0 ? focusables.length - 1 : currentIndex - 1)
          : (currentIndex === -1 || currentIndex === focusables.length - 1 ? 0 : currentIndex + 1);
        event.preventDefault();
        event.stopPropagation();
        focusables[nextIndex].focus();
        return;
      }

      if (!isTextInputElement(activeElement) && (event.key === "ArrowDown" || event.key === "ArrowRight")) {
        const focusables = getFocusableElements(scope);
        if (focusables.length > 0) {
          const currentIndex = focusables.indexOf(activeElement as HTMLElement);
          const nextIndex = currentIndex === -1 || currentIndex === focusables.length - 1 ? 0 : currentIndex + 1;
          event.preventDefault();
          event.stopPropagation();
          focusables[nextIndex].focus();
        }
        return;
      }

      if (!isTextInputElement(activeElement) && (event.key === "ArrowUp" || event.key === "ArrowLeft")) {
        const focusables = getFocusableElements(scope);
        if (focusables.length > 0) {
          const currentIndex = focusables.indexOf(activeElement as HTMLElement);
          const nextIndex = currentIndex <= 0 ? focusables.length - 1 : currentIndex - 1;
          event.preventDefault();
          event.stopPropagation();
          focusables[nextIndex].focus();
        }
      }
    };

    const keepFocusInside = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (scope.contains(target)) return;
      event.stopPropagation();
      const focusables = getFocusableElements(scope);
      if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        scope.focus();
      }
    };

    const focusables = getFocusableElements(scope);
    if (focusables.length > 0) {
      safeFocus(focusables[0]);
    } else {
      safeFocus(scope);
    }

    document.addEventListener("keydown", trapFocus, true);
    document.addEventListener("focusin", keepFocusInside, true);

    return () => {
      document.removeEventListener("keydown", trapFocus, true);
      document.removeEventListener("focusin", keepFocusInside, true);
      restoreFocus();
    };
  }, []);

  return (
    <div ref={scopeRef} data-modal-focus-scope role="dialog" aria-modal="true" tabIndex={-1} style={{ outline: "none" }}>
      {children}
    </div>
  );
}

export function isElementActuallyVisible(element: HTMLElement | null): boolean {
  if (!element) return false;

  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 || element.childElementCount > 0;
}

export function isSteamQuickAccessMenuOpenInDom(): boolean {
  const isQuickAccessWindowName = (value: string | null | undefined): boolean =>
    typeof value === "string" && /^QuickAccess(?:[-_]|$)/i.test(value);

  const getSteamWindowCandidates = (): Window[] => {
    const discovered = new Set<Window>();
    const add = (candidate: Window | null | undefined) => {
      if (!candidate || discovered.has(candidate)) return;
      discovered.add(candidate);
    };

    add(typeof window !== "undefined" ? window : null);
    add(typeof window !== "undefined" ? window.parent : null);
    add(typeof window !== "undefined" ? window.top : null);
    add(typeof window !== "undefined" ? ((window as any).SteamUIStore?.GetFocusedWindowInstance?.()?.BrowserWindow ?? null) : null);

    return Array.from(discovered);
  };

  for (const win of getSteamWindowCandidates()) {
    const navTrees =
      (win as any)?.GamepadNavTree?.m_context?.m_ActiveContext?.m_rgGamepadNavigationTrees ??
      (win as any)?.FocusNavController?.m_ActiveContext?.m_rgGamepadNavigationTrees ??
      [];

    const qamTree = navTrees.find((tree: any) => {
      const id = String(tree?.id ?? "");
      return /^QuickAccess(?:[-_]|$)/i.test(id);
    });

    const qamDoc = qamTree?.m_Root?.m_element?.ownerDocument as Document | undefined;
    if (qamDoc && !qamDoc.hidden) {
      return true;
    }

    const winChecks = [
      win?.name,
      win?.location?.href,
      win?.document?.title,
      win?.document?.URL,
    ];

    if (winChecks.some(isQuickAccessWindowName)) {
      return true;
    }
  }

  if (typeof document === "undefined") {
    return false;
  }

  const steamQuickAccessSelectors = [
    "#QuickAccess-Menu",
    "#QuickAccess-NA",
    "[id^='QuickAccess-']",
    "[id^='QuickAccess_']",
    "[id^='quickaccess_']",
    "[id^='quickaccess_tab_']",
    "[id^='quickaccess_content_']",
  ].join(", ");

  const overlay = Array.from(document.querySelectorAll<HTMLElement>(steamQuickAccessSelectors)).find((element) => isElementActuallyVisible(element));
  return !!overlay;
}

export function isSteamMainMenuOpenInDom(): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  const steamMainMenuSelectors = [
    "#Menu",
    "#MainMenu",
    "#SteamMenu",
    "[id*='MainMenu']",
    "[id*='SteamMenu']",
    "[data-steam-menu]",
    "[data-steam-overlay]",
  ].join(", ");

  const menu = Array.from(document.querySelectorAll<HTMLElement>(steamMainMenuSelectors)).find((element) => {
    if (!isElementActuallyVisible(element)) {
      return false;
    }

    const id = (element.id || "").toLowerCase();
    const text = (element.textContent || "").toLowerCase();
    const className = (element.className || "").toString().toLowerCase();

    return id.includes("mainmenu") || id.includes("steammenu") || text.includes("home") || className.includes("steammenu");
  });

  if (menu) {
    return true;
  }

  const getSteamWindowCandidates = (): Window[] => {
    const discovered = new Set<Window>();
    const add = (candidate: Window | null | undefined) => {
      if (!candidate || discovered.has(candidate)) return;
      discovered.add(candidate);
    };

    add(typeof window !== "undefined" ? window : null);
    add(typeof window !== "undefined" ? window.parent : null);
    add(typeof window !== "undefined" ? window.top : null);
    add(typeof window !== "undefined" ? ((window as any).SteamUIStore?.GetFocusedWindowInstance?.()?.BrowserWindow ?? null) : null);

    return Array.from(discovered);
  };

  for (const win of getSteamWindowCandidates()) {
    const navTrees =
      (win as any)?.GamepadNavTree?.m_context?.m_ActiveContext?.m_rgGamepadNavigationTrees ??
      (win as any)?.FocusNavController?.m_ActiveContext?.m_rgGamepadNavigationTrees ??
      [];

    const steamMenuTree = navTrees.find((tree: any) => {
      const id = String(tree?.id ?? "").toLowerCase();
      return id.includes("mainmenu") || id.includes("steammenu") || id.includes("menu");
    });

    const steamDoc = steamMenuTree?.m_Root?.m_element?.ownerDocument as Document | undefined;
    if (steamDoc && !steamDoc.hidden) {
      return true;
    }
  }

  return false;
}

