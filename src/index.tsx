import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t, loadRemoteTranslations, getLocale } from "./i18n";
import pluginInfo from "../plugin.json";
import {
  ButtonItem,
  Focusable,
  Navigation,
  NavEntryPositionPreferences,
  PanelSection,
  PanelSectionRow,
  Router,
  TextField,
  ToggleField,
  DropdownItem,
  ModalRoot,
  DialogBody,
  DialogButton,
} from "@decky/ui";
import { callable, definePlugin, routerHook } from "@decky/api";
import { showContextMenu, Menu, MenuItem, MenuSeparator } from "@decky/ui";

const FOCUSABLE_SELECTOR = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1']):not([disabled])";

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];

  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.getAttribute("aria-hidden") === "true") return false;
    if (element.closest("[inert]")) return false;
    if (element.hasAttribute("disabled")) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  });
}

function isTextInputElement(element: HTMLElement | null): boolean {
  return !!element && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement);
}

function ModalFocusScope({ children }: { children: ReactNode }) {
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const scope = scopeRef.current;
    if (!scope) return;

    const fileManagerScope = document.querySelector<HTMLElement>("[data-file-manager-scope]");
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (fileManagerScope) {
      fileManagerScope.setAttribute("data-focus-scope-disabled", "true");
      fileManagerScope.setAttribute("aria-hidden", "true");
      fileManagerScope.setAttribute("inert", "");
      fileManagerScope.style.pointerEvents = "none";
    }

    const restoreFocus = () => {
      const previous = previousFocusRef.current;
      if (previous && document.contains(previous)) {
        try {
          previous.focus();
        } catch {
          // ignore focus restoration errors
        }
        return;
      }

      const fallback = getFocusableElements(fileManagerScope)[0];
      if (fallback) {
        try {
          fallback.focus();
        } catch {
          // ignore focus restoration errors
        }
      }
    };

    const trapFocus = (event: KeyboardEvent) => {
      const activeElement = document.activeElement as HTMLElement | null;
      if (!scope.contains(activeElement)) {
        const focusables = getFocusableElements(scope);
        if (focusables.length > 0) {
          event.preventDefault();
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
        focusables[nextIndex].focus();
        return;
      }

      if (!isTextInputElement(activeElement) && (event.key === "ArrowDown" || event.key === "ArrowRight")) {
        const focusables = getFocusableElements(scope);
        if (focusables.length > 0) {
          const currentIndex = focusables.indexOf(activeElement as HTMLElement);
          const nextIndex = currentIndex === -1 || currentIndex === focusables.length - 1 ? 0 : currentIndex + 1;
          event.preventDefault();
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
      focusables[0].focus();
    } else {
      scope.focus();
    }

    document.addEventListener("keydown", trapFocus, true);
    document.addEventListener("focusin", keepFocusInside, true);

    return () => {
      document.removeEventListener("keydown", trapFocus, true);
      document.removeEventListener("focusin", keepFocusInside, true);

      if (fileManagerScope) {
        fileManagerScope.removeAttribute("data-focus-scope-disabled");
        fileManagerScope.removeAttribute("aria-hidden");
        fileManagerScope.removeAttribute("inert");
        fileManagerScope.style.pointerEvents = "";
      }

      restoreFocus();
    };
  }, []);

  return (
    <div ref={scopeRef} data-modal-focus-scope role="dialog" aria-modal="true" tabIndex={-1} style={{ outline: "none" }}>
      {children}
    </div>
  );
}

function BaseIcon({ children }: { children: ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      {children}
    </svg>
  );
}

function FolderIcon() {
  return (
    <BaseIcon>
      <path d="M19.5 21a3 3 0 0 0 3-3v-4.5a3 3 0 0 0-3-3h-15a3 3 0 0 0-3 3V18a3 3 0 0 0 3 3h15ZM1.5 10.146V6a3 3 0 0 1 3-3h5.379a2.25 2.25 0 0 1 1.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 0 1 3 3v1.146A4.483 4.483 0 0 0 19.5 9h-15a4.483 4.483 0 0 0-3 1.146Z" />
    </BaseIcon>
  );
}

function DocumentIcon() {
  return (
    <BaseIcon>
      <path d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0 0 16.5 9h-1.875a1.875 1.875 0 0 1-1.875-1.875V5.25A3.75 3.75 0 0 0 9 1.5H5.625Z" />
      <path d="M12.971 1.816A5.23 5.23 0 0 1 14.25 5.25v1.875c0 .207.168.375.375.375H16.5a5.23 5.23 0 0 1 3.434 1.279 9.768 9.768 0 0 0-6.963-6.963Z" />
    </BaseIcon>
  );
}

function ArchiveIcon() {
  return (
    <BaseIcon>
      <path d="M3.375 3C2.339 3 1.5 3.84 1.5 4.875v.75c0 1.036.84 1.875 1.875 1.875h17.25c1.035 0 1.875-.84 1.875-1.875v-.75C22.5 3.839 21.66 3 20.625 3H3.375Z" />
      <path fillRule="evenodd" d="m3.087 9 .54 9.176A3 3 0 0 0 6.62 21h10.757a3 3 0 0 0 2.995-2.824L20.913 9H3.087Zm6.163 3.75A.75.75 0 0 1 10 12h4a.75.75 0 0 1 0 1.5h-4a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
    </BaseIcon>
  );
}

function ExtractIcon() {
  return (
    <BaseIcon>
      <path d="M11.47 1.72a.75.75 0 0 1 1.06 0l3 3a.75.75 0 0 1-1.06 1.06l-1.72-1.72V7.5h-1.5V4.06L9.53 5.78a.75.75 0 0 1-1.06-1.06l3-3ZM11.25 7.5V15a.75.75 0 0 0 1.5 0V7.5h3.75a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3h3.75Z" />
    </BaseIcon>
  );
}

// `FileIcon` removed — não era utilizado após customização para Document/Archive icons.

function CopyIcon() {
  return (
    <BaseIcon>
      <path fillRule="evenodd" d="M17.663 3.118c.225.015.45.032.673.05C19.876 3.298 21 4.604 21 6.109v9.642a3 3 0 0 1-3 3V16.5c0-5.922-4.576-10.775-10.384-11.217.324-1.132 1.3-2.01 2.548-2.114.224-.019.448-.036.673-.051A3 3 0 0 1 13.5 1.5H15a3 3 0 0 1 2.663 1.618ZM12 4.5A1.5 1.5 0 0 1 13.5 3H15a1.5 1.5 0 0 1 1.5 1.5H12Z" clipRule="evenodd" />
      <path d="M3 8.625c0-1.036.84-1.875 1.875-1.875h.375A3.75 3.75 0 0 1 9 10.5v1.875c0 1.036.84 1.875 1.875 1.875h1.875A3.75 3.75 0 0 1 16.5 18v2.625c0 1.035-.84 1.875-1.875 1.875h-9.75A1.875 1.875 0 0 1 3 20.625v-12Z" />
      <path d="M10.5 10.5a5.23 5.23 0 0 0-1.279-3.434 9.768 9.768 0 0 1 6.963 6.963 5.23 5.23 0 0 0-3.434-1.279h-1.875a.375.375 0 0 1-.375-.375V10.5Z" />
    </BaseIcon>
  );
}

function CutIcon() {
  return (
    <BaseIcon>
      <path fillRule="evenodd" d="M8.128 9.155a3.751 3.751 0 1 1 .713-1.321l1.136.656a.75.75 0 0 1 .222 1.104l-.006.007a.75.75 0 0 1-1.032.157 1.421 1.421 0 0 0-.113-.072l-.92-.531Zm-4.827-3.53a2.25 2.25 0 0 1 3.994 2.063.756.756 0 0 0-.122.23 2.25 2.25 0 0 1-3.872-2.293ZM13.348 8.272a5.073 5.073 0 0 0-3.428 3.57 5.08 5.08 0 0 0-.165 1.202 1.415 1.415 0 0 1-.707 1.201l-.96.554a3.751 3.751 0 1 0 .734 1.309l13.729-7.926a.75.75 0 0 0-.181-1.374l-.803-.215a5.25 5.25 0 0 0-2.894.05l-5.325 1.629Zm-9.223 7.03a2.25 2.25 0 1 0 2.25 3.897 2.25 2.25 0 0 0-2.25-3.897ZM12 12.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clipRule="evenodd" />
      <path d="M16.372 12.615a.75.75 0 0 1 .75 0l5.43 3.135a.75.75 0 0 1-.182 1.374l-.802.215a5.25 5.25 0 0 1-2.894-.051l-5.147-1.574a.75.75 0 0 1-.156-1.367l3-1.732Z" />
    </BaseIcon>
  );
}

function PasteIcon() {
  return (
    <BaseIcon>
      <path d="M10.5 3A1.501 1.501 0 0 0 9 4.5h6A1.5 1.5 0 0 0 13.5 3h-3Zm-2.693.178A3 3 0 0 1 10.5 1.5h3a3 3 0 0 1 2.694 1.678c.497.042.992.092 1.486.15 1.497.173 2.57 1.46 2.57 2.929V19.5a3 3 0 0 1-3 3H6.75a3 3 0 0 1-3-3V6.257c0-1.47 1.073-2.756 2.57-2.93.493-.057.989-.107 1.487-.15Z" />
    </BaseIcon>
  );
}

function NewFolderIcon() {
  return (
    <BaseIcon>
      <path fillRule="evenodd" d="M19.5 21a3 3 0 0 0 3-3V9a3 3 0 0 0-3-3h-5.379a.75.75 0 0 1-.53-.22L11.47 3.66A2.25 2.25 0 0 0 9.879 3H4.5a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h15Zm-6.75-10.5a.75.75 0 0 0-1.5 0v2.25H9a.75.75 0 0 0 0 1.5h2.25v2.25a.75.75 0 0 0 1.5 0v-2.25H15a.75.75 0 0 0 0-1.5h-2.25V10.5Z" clipRule="evenodd" />
    </BaseIcon>
  );
}

function RenameIcon() {
  return (
    <BaseIcon>
      <path d="M21.731 2.269a2.625 2.625 0 0 0-3.712 0l-1.157 1.157 3.712 3.712 1.157-1.157a2.625 2.625 0 0 0 0-3.712ZM19.513 8.199l-3.712-3.712-8.4 8.4a5.25 5.25 0 0 0-1.32 2.214l-.8 2.685a.75.75 0 0 0 .933.933l2.685-.8a5.25 5.25 0 0 0 2.214-1.32l8.4-8.4Z" />
      <path d="M5.25 5.25a3 3 0 0 0-3 3v10.5a3 3 0 0 0 3 3h10.5a3 3 0 0 0 3-3V13.5a.75.75 0 0 0-1.5 0v5.25a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V8.25a1.5 1.5 0 0 1 1.5-1.5h5.25a.75.75 0 0 0 0-1.5H5.25Z" />
    </BaseIcon>
  );
}

function DeleteIcon() {
  return (
    <BaseIcon>
      <path fillRule="evenodd" d="M16.5 4.478v.227a48.816 48.816 0 0 1 3.878.512.75.75 0 1 1-.256 1.478l-.209-.035-1.005 13.07a3 3 0 0 1-2.991 2.77H8.084a3 3 0 0 1-2.991-2.77L4.087 6.66l-.209.035a.75.75 0 0 1-.256-1.478A48.567 48.567 0 0 1 7.5 4.705v-.227c0-1.564 1.213-2.9 2.816-2.951a52.662 52.662 0 0 1 3.369 0c1.603.051 2.815 1.387 2.815 2.951Zm-6.136-1.452a51.196 51.196 0 0 1 3.273 0C14.39 3.05 15 3.684 15 4.478v.113a49.488 49.488 0 0 0-6 0v-.113c0-.794.609-1.428 1.364-1.452Zm-.355 5.945a.75.75 0 1 0-1.5.058l.347 9a.75.75 0 1 0 1.499-.058l-.346-9Zm5.48.058a.75.75 0 1 0-1.498-.058l-.347 9a.75.75 0 0 0 1.5.058l.345-9Z" clipRule="evenodd" />
    </BaseIcon>
  );
}

function PropertiesIcon() {
  return (
    <BaseIcon>
      <path d="M10.5 3A1.501 1.501 0 0 0 9 4.5h6A1.5 1.5 0 0 0 13.5 3h-3Zm-2.693.178A3 3 0 0 1 10.5 1.5h3a3 3 0 0 1 2.694 1.678c.497.042.992.092 1.486.15 1.497.173 2.57 1.46 2.57 2.929V19.5a3 3 0 0 1-3 3H6.75a3 3 0 0 1-3-3V6.257c0-1.47 1.073-2.756 2.57-2.93.493-.057.989-.107 1.487-.15Z" />
    </BaseIcon>
  );
}

function PluginIcon() {
  return (
    <BaseIcon>
      <path d="M19.5 21a3 3 0 0 0 3-3v-4.5a3 3 0 0 0-3-3h-15a3 3 0 0 0-3 3V18a3 3 0 0 0 3 3h15ZM1.5 10.146V6a3 3 0 0 1 3-3h5.379a2.25 2.25 0 0 1 1.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 0 1 3 3v1.146A4.483 4.483 0 0 0 19.5 9h-15a4.483 4.483 0 0 0-3 1.146Z" />
    </BaseIcon>
  );
}

type FileEntry = {
  name: string;
  path: string;
  is_dir: boolean;
  size: number | null;
  modified: number;
};

function isArchiveFile(name: string): boolean {
  const lower = name.toLowerCase();
  const archiveExtensions = [
    ".zip",
    ".tar",
    ".tar.gz",
    ".tgz",
    ".tar.bz2",
    ".tar.xz",
    ".tar.zst",
    ".rar",
    ".7z",
    ".gz",
    ".bz2",
    ".xz",
    ".zst",
    ".iso",
  ];
  return archiveExtensions.some((ext) => lower.endsWith(ext));
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(value < 10 && i > 0 ? 2 : 0)} ${sizes[i]}`;
}

const listDir = callable<[string], { path: string; items: FileEntry[] }>("list_dir");

function FileManagerPage() {
  const [path, setPath] = useState("/home/deck");
  const pathRef = useRef(path);
  const [editedPath, setEditedPath] = useState("/home/deck");
  const historyRef = useRef<Array<{ path: string; focusTarget: string | null }>>([]);
  const [items, setItems] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [sortOrder, setSortOrder] = useState("asc");
  const [fileTypeFilter, setFileTypeFilter] = useState("all");
  const [visibleItemCount, setVisibleItemCount] = useState(150);
  const backTimeout = useRef<number | null>(null);
  const isLongBack = useRef(false);
  const backPressed = useRef(false);
  const backHadOverlayOnPress = useRef(false);
  const backConsumedOnPress = useRef(false);
  const lastOverlayRemovedAt = useRef<number>(0);
  const isPluginActive = useRef(false);
  const contextMenuInstance = useRef<{ Hide(): void } | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const pathInputScopeRef = useRef<HTMLDivElement | null>(null);
  const pathInputFocusedRef = useRef(false);
  const pathInputBlurTimerRef = useRef<number | null>(null);
  const pathInputLastFocusRef = useRef(0);

  const stabilizePathInputFocus = useCallback(() => {
    const focusInput = () => {
      const input = pathInputScopeRef.current?.querySelector<HTMLInputElement>("input");
      if (input && document.activeElement !== input) {
        input.focus();
      }
    };

    // The Steam virtual keyboard opens asynchronously. Reassert focus after
    // it has mounted so the first characters are not lost.
    window.setTimeout(focusInput, 0);
    window.setTimeout(focusInput, 80);
    window.setTimeout(focusInput, 180);
  }, []);
  const openContextMenuRef = useRef<(item: FileEntry | null) => void>(() => null);
  const getCurrentFocusedItemRef = useRef<() => FileEntry | null>(() => null);
  const goBackRef = useRef<() => void>(() => null);
  const exitPluginRef = useRef<() => void>(() => null);

  const loadPath = useCallback(
    async (newPath: string, notFoundMsg?: string, pushHistory = true, focusTarget: string | null = null) => {
      setLoading(true);
      setError(null);
      try {
        const res = await listDir(newPath);
        if (pushHistory && newPath !== pathRef.current) {
          historyRef.current = [...historyRef.current, { path: pathRef.current, focusTarget }];
        }
        setPath(res.path);
        pathRef.current = res.path;
        setEditedPath(res.path);
        setItems(res.items);
        setFocusPath(focusTarget);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(notFoundMsg ?? message ?? t("error.could_not_load_directory"));
      } finally {
        setLoading(false);
      }
    },
    [path],
  );

  const exitPlugin = useCallback(() => {
    Router.CloseSideMenus();
    Navigation.NavigateBack?.();
  }, []);

  const handleCancel = useCallback(() => {
    // Don't prevent default - allow normal navigation with DPAD/analog
  }, []);

  const goBack = useCallback(() => {
    setError(null);

    // Navega para a pasta pai do `path` atual em vez de usar o histórico anterior.
    try {
      if (!path || path === "/") {
        // já na raiz: fecha o plugin
        exitPlugin();
        return;
      }

      const parts = path.split("/");
      // Remove componentes vazios resultantes de leading slash
      const filtered = parts.filter((p) => p !== "");

      if (filtered.length === 0) {
        exitPlugin();
        return;
      }

      filtered.pop();
      const parentDir = "/" + filtered.join("/") || "/";

      if (parentDir === path) {
        exitPlugin();
        return;
      }

      void loadPath(parentDir, t("error.directory_not_found"));
    } catch (e) {
      // fallback: se algo der errado, tenta usar o histórico antigo
      if (historyRef.current.length > 0) {
        const previousEntry = historyRef.current[historyRef.current.length - 1];
        historyRef.current = historyRef.current.slice(0, -1);
        void loadPath(previousEntry.path, t("error.directory_not_found"), false, previousEntry.focusTarget);
      }
    }
  }, [loadPath, path, exitPlugin]);

  const initialLoadDone = useRef(false);

  const [i18nVersion, setI18nVersion] = useState(0);
  void i18nVersion;

  useEffect(() => {
    // Try to load remote/bundled translations at startup and force rerender.
    void (async () => {
      try {
        const REMOTE_BASE = (pluginInfo && (pluginInfo as any).translations_base_url) || "";
        await loadRemoteTranslations(REMOTE_BASE || undefined);
        setI18nVersion((v) => v + 1);
        // eslint-disable-next-line no-console
        console.info("i18n: active locale:", getLocale());
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("i18n: remote load failed", e);
      }
    })();

    if (initialLoadDone.current) return;
    initialLoadDone.current = true;
    loadPath(path);
  }, [loadPath, path]);

  useEffect(() => {
    setVisibleItemCount(150);
  }, [path, showHidden, sortOrder, fileTypeFilter]);

  const hasClipboard = callable<[], { has: boolean }>("has_clipboard");
  const copyPath = callable<[string], { ok: boolean }>("copy_path");
  const cutPath = callable<[string], { ok: boolean }>("cut_path");
  const pastePathWithOptions = callable<[string, string, boolean], { ok: boolean; skipped?: boolean; cancelled?: boolean; conflict_strategy?: string }>("paste_path_with_options");
  const checkPasteConflict = callable<[string], { blocked: boolean; reason?: string; needs_conflict?: boolean; path?: string; name: string; is_dir?: boolean }>("check_paste_conflict");
  const extractArchive = callable<[string, string], { success: boolean; new_path?: string }>("extract_archive");
  const renamePath = callable<[string, string], { success: boolean; new_path: string }>("rename_item");
  const deletePath = callable<[string], { success: boolean; error?: string }>("delete_item");
  const getProperties = callable<[string], {
    name: string;
    path: string;
    type: "file" | "folder";
    size: number | null;
    created: string;
    modified: string;
    permissions: string;
  }>("get_properties");
  const getDirectorySize = callable<[string], { size: number | null; path: string }>("get_directory_size");


  const [clipboardHas, setClipboardHas] = useState(false);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>("");
  const [renameRequested, setRenameRequested] = useState(false);
  const renameModalRef = useRef<HTMLDivElement | null>(null);
  const renameSaveRef = useRef<HTMLButtonElement | null>(null);
  const [deleteRequested, setDeleteRequested] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteName, setDeleteName] = useState<string | null>(null);
  const deleteModalRef = useRef<HTMLDivElement | null>(null);
  const deleteConfirmRef = useRef<HTMLButtonElement | null>(null);
  const [propertiesRequested, setPropertiesRequested] = useState(false);
  const propertiesModalRef = useRef<HTMLDivElement | null>(null);
  const propertiesCloseRef = useRef<HTMLButtonElement | null>(null);
  const [isCalculatingFolderSize, setIsCalculatingFolderSize] = useState(false);

  const [propertiesData, setPropertiesData] = useState<{
    name: string;
    path: string;
    type: "file" | "folder";
    size: number | null;
    created: string;
    modified: string;
    permissions: string;
  } | null>(null);

  type ConflictModalState = {
    title: string;
    message: string;
    targetDir: string;
    itemName: string;
    isFolderConflict: boolean;
  } | null;
  type OperationModalState = {
    label: string;
    progress: number;
  } | null;
  type PermissionModalState = {
    message: string;
  } | null;

  const [conflictModal, setConflictModal] = useState<ConflictModalState>(null);
  const [operationModal, setOperationModal] = useState<OperationModalState>(null);
  const [operationCancelRequested, setOperationCancelRequested] = useState(false);
  const [permissionModal, setPermissionModal] = useState<PermissionModalState>(null);
  const conflictPrimaryRef = useRef<HTMLButtonElement | null>(null);
  const permissionPrimaryRef = useRef<HTMLButtonElement | null>(null);

  const [createFolderRequested, setCreateFolderRequested] = useState(false);
  const [createFolderName, setCreateFolderName] = useState("");
  const createFolderRef = useRef<HTMLDivElement | null>(null);
  const createFolderConfirmRef = useRef<HTMLButtonElement | null>(null);
  const fileManagerScopeRef = useRef<HTMLDivElement | null>(null);
  const hasActiveModal = renameRequested || deleteRequested || propertiesRequested || createFolderRequested || !!conflictModal || !!operationModal || !!permissionModal;

  const isDropdownMenuOpenInDom = useCallback(() => {
    if (typeof document === "undefined") return false;

    const dropdownMenu = document.querySelector<HTMLElement>("[role='menu'], .contextMenu, .contextMenuContents, .BasicContextMenuModal");
    if (!dropdownMenu) return false;

    const activeElement = document.activeElement as HTMLElement | null;
    return Boolean(activeElement?.closest("[role='menu'], .contextMenu, .contextMenuContents, .BasicContextMenuModal") || dropdownMenu.closest("[role='menu'], .contextMenu, .contextMenuContents, .BasicContextMenuModal"));
  }, []);

  const focusActiveModal = useCallback(() => {
    if (typeof document === "undefined") return;

    const focusableSelector = [
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1']):not([disabled])",
    ].join(", ");

    const modalScope = document.querySelector<HTMLElement>("[role='dialog'], [data-modal-root], [data-decky-modal]");
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => {
      if (element.closest("[inert]")) return false;
      if (element.getAttribute("aria-hidden") === "true") return false;
      if (element.hasAttribute("disabled")) return false;
      const withinModal = modalScope ? element.closest("[role='dialog'], [data-modal-root], [data-decky-modal]") : null;
      if (modalScope && !withinModal) return false;
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    });

    const preferred = candidates.find((element) => element.offsetParent !== null || element.getClientRects().length > 0);
    if (preferred) {
      try {
        preferred.focus();
      } catch {
        // ignore focus errors
      }
      return;
    }

    if (modalScope) {
      try {
        modalScope.focus();
      } catch {
        // ignore focus errors
      }
    }
  }, []);

  useEffect(() => {
    if (!hasActiveModal) return;

    const timer = window.setTimeout(() => {
      focusActiveModal();
    }, 60);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        focusActiveModal();
        return;
      }

      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        const activeElement = document.activeElement as HTMLElement | null;
        if (activeElement && !activeElement.closest("[role='dialog'], [data-modal-root]")) {
          event.preventDefault();
          event.stopPropagation();
          focusActiveModal();
        }
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      const modalScope = document.querySelector<HTMLElement>("[role='dialog'], [data-modal-root], [data-decky-modal]");
      if (!modalScope) return;

      if (!target.closest("[role='dialog'], [data-modal-root], [data-decky-modal]")) {
        event.stopPropagation();
        focusActiveModal();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusin", handleFocusIn, true);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", handleFocusIn, true);
    };
  }, [focusActiveModal, hasActiveModal]);

  useEffect(() => {
    (async () => {
      try {
        const res = await hasClipboard();
        setClipboardHas(res.has);
      } catch {
        setClipboardHas(false);
      }
    })();
  }, [hasClipboard, path]);

  const isAnyModalOrMenuOpen = useCallback(() => {
    if (contextMenuInstance.current) {
      return true;
    }

    if (typeof document !== "undefined") {
      const activeElement = document.activeElement as HTMLElement | null;
      const overlaySelector = [
        ".contextMenu",
        ".contextMenuContents",
        ".BasicContextMenuModal",
        "[role='menu']",
        "[role='dialog']",
        "[data-modal-root]",
        "[data-decky-modal]",
        "[aria-expanded='true']",
        "[aria-haspopup]",
      ].join(", ");

      const overlayOpen = document.querySelector(overlaySelector);
      const activeElementIsOverlay = activeElement?.closest(overlaySelector);
      if (overlayOpen || activeElementIsOverlay) {
        return true;
      }
    }

    return propertiesRequested || renameRequested || deleteRequested || createFolderRequested || !!conflictModal || !!operationModal || !!permissionModal;
  }, [propertiesRequested, renameRequested, deleteRequested, createFolderRequested, conflictModal, operationModal, permissionModal]);

  useEffect(() => {
    const input = (window as any).SteamClient?.Input;
    let unregister: any;

    if (input?.RegisterForControllerInputMessages) {
      unregister = input.RegisterForControllerInputMessages(
        (_controllerIndex: number, gamepadButton: number, isPressed: boolean) => {
          if (!isPluginActive.current) return;

          const GAMEPAD_BUTTON_B = 1;
          const GAMEPAD_BUTTON_Y = 3;

          if (gamepadButton === GAMEPAD_BUTTON_Y && isPressed) {
            const item = getCurrentFocusedItemRef.current();
            openContextMenuRef.current(item);
            return;
          }

          if (gamepadButton !== GAMEPAD_BUTTON_B) return;
          if (isPressed) {
            if (backPressed.current) return;

            // Circle first dismisses the Steam virtual keyboard when the path
            // field is focused; only the next press navigates back.
            const activeElement = document.activeElement as HTMLElement | null;
            const pathInputWasRecentlyFocused = Date.now() - pathInputLastFocusRef.current < 3000;
            if (pathInputFocusedRef.current || pathInputWasRecentlyFocused || (activeElement instanceof HTMLElement && activeElement.closest("[data-path-input]"))) {
              pathInputFocusedRef.current = false;
              pathInputLastFocusRef.current = 0;
              if (pathInputBlurTimerRef.current !== null) {
                window.clearTimeout(pathInputBlurTimerRef.current);
                pathInputBlurTimerRef.current = null;
              }
              activeElement?.blur();
              return;
            }

            const hasOverlay = isAnyModalOrMenuOpen();
            const dropdownMenuOpen = isDropdownMenuOpenInDom();
            const shouldConsumeBack = hasOverlay || dropdownMenuOpen || Boolean(activeElement?.closest("[role='menu'], [role='dialog'], [data-modal-root], [data-decky-modal], [aria-expanded='true'], [aria-haspopup], .contextMenu, .contextMenuContents, .BasicContextMenuModal"));

            backPressed.current = true;
            backHadOverlayOnPress.current = shouldConsumeBack;
            backConsumedOnPress.current = shouldConsumeBack;

            if (shouldConsumeBack) {
              if (contextMenuInstance.current) {
                contextMenuInstance.current.Hide();
                contextMenuInstance.current = null;
              }

              const overlayElement = activeElement?.closest("[role='menu'], [role='dialog'], [data-modal-root], [data-decky-modal], .contextMenu, .contextMenuContents, .BasicContextMenuModal") as HTMLElement | null;
              if (overlayElement) {
                try {
                  overlayElement.blur?.();
                } catch {
                  // ignore
                }
              }

              if (dropdownMenuOpen) {
                try {
                  // Try to find a visible context menu / dropdown and click the
                  // 'Cancelar' (Cancel) item if available. This closes the menu
                  // reliably and consumes the Circle press so it doesn't fall
                  // through to goBack on release.
                  const containers = Array.from(document.querySelectorAll<HTMLElement>(
                    ".contextMenu, .contextMenuContents, [role='menu']"
                  ));

                  let closed = false;
                  for (const c of containers) {
                    if (!c || !(c.offsetWidth || c.offsetHeight || c.getClientRects().length)) continue;
                    const candidates = Array.from(c.querySelectorAll<HTMLElement>("button, [role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox'], div"));
                    const cancel = candidates.find((e) => /cancelar|cancel|fechar|close/i.test((e.textContent || "").trim()));
                    if (cancel) {
                      try {
                        cancel.click();
                        closed = true;
                        break;
                      } catch {
                        // ignore click failure
                      }
                    }
                  }

                  if (!closed) {
                    // fallback: send Escape to try to close any open menu
                    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
                    activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
                  }
                } catch {
                  // ignore
                }

                return;
              }

              const dismissableDropdown = document.querySelector<HTMLElement>("[aria-expanded='true'], [aria-haspopup]");
              if (dismissableDropdown) {
                try {
                  dismissableDropdown.setAttribute("aria-expanded", "false");
                } catch {
                  // ignore
                }
              }

              return;
            }
            isLongBack.current = false;
            if (backTimeout.current) {
              window.clearTimeout(backTimeout.current);
            }
            backTimeout.current = window.setTimeout(() => {
              isLongBack.current = true;
              exitPluginRef.current();
            }, 200);
          } else {
            if (!backPressed.current) return;
            backPressed.current = false;
            if (backTimeout.current) {
              window.clearTimeout(backTimeout.current);
              backTimeout.current = null;
            }
            const now = Date.now();
            if (
              backHadOverlayOnPress.current ||
              backConsumedOnPress.current ||
              (lastOverlayRemovedAt.current && now - lastOverlayRemovedAt.current < 400)
            ) {
              backHadOverlayOnPress.current = false;
              backConsumedOnPress.current = false;
              lastOverlayRemovedAt.current = 0;
              return;
            }
            if (!isLongBack.current) {
              goBackRef.current();
            }
            isLongBack.current = false;
          }
        },
      );
    }

    return () => {
      if (backTimeout.current) {
        window.clearTimeout(backTimeout.current);
        backTimeout.current = null;
      }
      if (typeof unregister === "function") {
        unregister();
      } else if (unregister?.Unregister) {
        unregister.Unregister();
      }
    };
  }, [isAnyModalOrMenuOpen]);

  useEffect(() => {
    if (renameRequested) {
      // focus the input inside the rename modal
      setTimeout(() => {
        const input = renameModalRef.current?.querySelector<HTMLInputElement>("input");
        input?.focus();
        input?.select();
      }, 50);
    }
  }, [renameRequested]);

  useEffect(() => {
    if (propertiesRequested) {
      // focus the close button in the properties modal so controller input goes there
      setTimeout(() => {
        const btn = propertiesCloseRef.current ?? propertiesModalRef.current?.querySelector<HTMLButtonElement>("button");
        try {
          btn?.focus();
        } catch (e) {
          // ignore focus errors
        }
      }, 50);
    }
  }, [propertiesRequested]);

  useEffect(() => {
    if (deleteRequested) {
      setTimeout(() => {
        const btn = deleteConfirmRef.current ?? deleteModalRef.current?.querySelector<HTMLButtonElement>("button");
        try { btn?.focus(); } catch (e) {}
      }, 50);
    }
  }, [deleteRequested]);

  useEffect(() => {
    if (!conflictModal) return;
    const timeout = window.setTimeout(() => {
      conflictPrimaryRef.current?.focus();
    }, 50);
    return () => window.clearTimeout(timeout);
  }, [conflictModal]);

  useEffect(() => {
    if (!permissionModal) return;
    const timeout = window.setTimeout(() => {
      permissionPrimaryRef.current?.focus();
    }, 50);
    return () => window.clearTimeout(timeout);
  }, [permissionModal]);

  const refreshClipboard = useCallback(async () => {
    try {
      const res = await hasClipboard();
      setClipboardHas(res.has);
    } catch {
      setClipboardHas(false);
    }
  }, [hasClipboard]);

  const isOperationRunning = useRef(false);

  const runOperation = useCallback(
    async (label: string, action: () => Promise<any>, options?: { onError?: (e: any) => void }) => {
      if (isOperationRunning.current) {
        setError(t("action.another_running"));
        return null;
      }
      isOperationRunning.current = true;

      setOperationCancelRequested(false);
      setOperationModal({ label, progress: 0 });
      const interval = window.setInterval(() => {
        setOperationModal((prev) => prev ? { ...prev, progress: Math.min(prev.progress + 7, 95) } : prev);
      }, 160);

      try {
        const res = await action();

        if (operationCancelRequested) {
          setOperationModal(null);
          setError(t("action.cancelled"));
          await refreshClipboard();
          return null;
        }

        if (res && typeof res === "object" && "success" in res && res.success === false) {
          const err = (res as any).error ?? t("action.failed");
          throw new Error(err);
        }

        setOperationModal((prev) => prev ? { ...prev, progress: 100 } : prev);
        
        await refreshClipboard();
        await loadPath(path);

        if (res && typeof res === "object" && (res as any).new_path) {
          setFocusPath((res as any).new_path as string);
        }

        window.setTimeout(() => setOperationModal(null), 220);
        return res;
      } catch (e: any) {
        setOperationModal(null);
        await refreshClipboard();
        
        if (options?.onError) {
          options.onError(e);
        } else {
          setError(e?.message ?? t("action.failed"));
        }
        return null;
      } finally {
        window.clearInterval(interval);
        setOperationCancelRequested(false);
        isOperationRunning.current = false;
      }
    },
    [operationCancelRequested, refreshClipboard, loadPath, path],
  );

  const handlePaste = useCallback(async (targetDir: string) => {
    try {
      const conflict = await checkPasteConflict(targetDir);
      if (conflict.blocked) {
        setPermissionModal({ message: t("paste.blocked") });
        return;
      }

      if (conflict.needs_conflict) {
        setConflictModal({
          title: conflict.is_dir ? t("conflict.folder_exists") : t("conflict.file_exists"),
          message: t("conflict.message").replace("{name}", conflict.name),
          targetDir,
          itemName: conflict.name,
          isFolderConflict: Boolean(conflict.is_dir),
        });
        return;
      }

      await runOperation(t("action.pasting"), () => pastePathWithOptions(targetDir, "keep-both", false), {
        onError: (e) => {
          const message = String(e?.message ?? t("action.failed"));
          if (message.toLowerCase().includes("permissão")) {
            setPermissionModal({ message: t("permission.denied") });
          } else {
            setError(message);
          }
        },
      });
    } catch (e: any) {
      setError(e?.message ?? t("error.prepare_paste"));
    }
  }, [checkPasteConflict, runOperation]);

  const createFolderCallable = callable<[string, string], { success: boolean; path?: string }>("create_folder");

  const handleCreateFolder = useCallback(async (parentDir: string, name: string) => {
    if (!name) return setError(t("error.invalid_name"));
      await runOperation(t("action.creating_folder"), () => createFolderCallable(parentDir, name), {
      onError: (e) => {
          setError(e?.message ?? t("error.could_not_create_folder"));
      },
    });
    setCreateFolderRequested(false);
    setCreateFolderName("");
  }, [createFolderCallable, runOperation]);

  const handleConflictChoice = useCallback(async (strategy: string, applyToAll = false) => {
    if (!conflictModal) return;

    setConflictModal(null);
    await runOperation(t("action.pasting"), () => pastePathWithOptions(conflictModal.targetDir, strategy, applyToAll), {
      onError: (e) => {
        const message = String(e?.message ?? t("action.failed"));
        if (message.toLowerCase().includes("permissão")) {
          setPermissionModal({ message: t("permission.denied") });
        } else {
          setError(message);
        }
      },
    });
  }, [conflictModal, runOperation]);

  const openContextMenu = useCallback(
    (item: FileEntry | null) => {
      // Close any existing context menu before opening a new one.
      if (contextMenuInstance.current) {
        contextMenuInstance.current.Hide();
        contextMenuInstance.current = null;
      }

      // determine parent element to anchor the menu
      let parentEl: EventTarget | undefined;
      if (item) {
        parentEl = (itemRefs.current[item.path] as EventTarget) ?? (typeof document !== "undefined" ? document.activeElement as EventTarget : undefined);
      } else {
        parentEl = listContainerRef.current ?? (typeof document !== "undefined" ? document.activeElement as EventTarget : undefined);
      }

      if (item) {
        const copy = async () => {
          try {
              await copyPath(item.path);
            await refreshClipboard();
          } catch (e: any) {
              setError(e?.message ?? t("error.could_not_copy"));
          }
        };
        const cut = async () => {
          try {
            await cutPath(item.path);
            await refreshClipboard();
          } catch (e: any) {
            setError(e?.message ?? t("error.could_not_cut"));
          }
        };
        const extract = async () => {
          try {
            const targetDir = pathRef.current ?? path;
                const res = await runOperation(t("action.extracting"), () => extractArchive(item.path, targetDir), {
              onError: (e) => {
                    const message = String(e?.message ?? t("error.could_not_extract"));
                if (message.toLowerCase().includes("permissão")) {
                      setPermissionModal({ message: t("permission.denied") });
                } else {
                      setError(message);
                }
              },
            });
            if (res && res.new_path) {
              setFocusPath(res.new_path);
            }
          } catch (e: any) {
            setError(e?.message ?? t("error.could_not_extract"));
          }
        };
        const paste = () => void handlePaste(pathRef.current ?? path);
        const rename = () => {
          // open inline rename field
          setRenameTarget(item.path);
          setRenameValue(item.name);
          setRenameRequested(true);
        };
        const remove = () => {
          // open native confirmation modal
          setDeleteTarget(item.path);
          setDeleteName(item.name);
          setDeleteRequested(true);
        };
        const properties = () => {
          void (async () => {
            try {
              const props = await getProperties(item.path);

              setPropertiesData(props);
              setPropertiesRequested(true);

              if (props.type === "folder") {
              setIsCalculatingFolderSize(true);
              } else {
              setIsCalculatingFolderSize(false);
              }

// If it's a folder, calculate size in background
if (props.type === "folder") {
                getDirectorySize(item.path)
    .then((sizeResult) => {

        if (sizeResult.size !== null) {
            setPropertiesData((prev) =>
                prev
                    ? {
                        ...prev,
                        size: sizeResult.size
                    }
                    : prev
            );
        }

        setIsCalculatingFolderSize(false);

    })
    .catch(() => {

        setIsCalculatingFolderSize(false);

    });
              }
            } catch (e: any) {
                setError(e?.message ?? t("error.could_not_properties"));
            }
          })();
        };

        contextMenuInstance.current = showContextMenu(
          <Menu label={`${t("menu.options")} : ${item.name}`}>
            <MenuItem onClick={() => void copy()} onSelected={() => void copy()}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}><CopyIcon />{t("menu.copy")}</span>
            </MenuItem>

            {clipboardHas ? <MenuItem onClick={paste} onSelected={paste}><span style={{ display: "flex", alignItems: "center", gap: 10 }}><PasteIcon />{t("menu.paste")}</span></MenuItem> : null}

            <MenuItem onClick={() => void cut()} onSelected={() => void cut()}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}><CutIcon />{t("menu.cut")}</span>
            </MenuItem>
            {isArchiveFile(item.name) ? (
              <MenuItem onClick={() => void extract()} onSelected={() => void extract()}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}><ExtractIcon />{t("menu.extract")}</span>
              </MenuItem>
            ) : null}

            <MenuItem onClick={() => setCreateFolderRequested(true)} onSelected={() => setCreateFolderRequested(true)}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}><NewFolderIcon />{t("menu.newFolder")}</span>
            </MenuItem>

            <MenuSeparator />

            <MenuItem onClick={rename} onSelected={rename}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}><RenameIcon />{t("menu.rename")}</span>
            </MenuItem>

            <MenuItem tone="destructive" onClick={remove} onSelected={remove}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}><DeleteIcon />{t("menu.delete")}</span>
            </MenuItem>

            <MenuItem onClick={properties} onSelected={properties}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}><PropertiesIcon />{t("menu.properties")}</span>
            </MenuItem>
          </Menu>,
          parentEl,
        );
      } else {
        // No focused item: show minimal menu (Paste and Create Folder)
        const paste = () => void handlePaste(pathRef.current ?? path);
        contextMenuInstance.current = showContextMenu(
          <Menu label={t("menu.options")}>
            {clipboardHas ? <MenuItem onClick={paste} onSelected={paste}>{t("menu.paste")}</MenuItem> : null}
            <MenuItem onClick={() => setCreateFolderRequested(true)} onSelected={() => setCreateFolderRequested(true)}>{t("menu.newFolder")}</MenuItem>
          </Menu>,
          parentEl,
        );
      }
    },
    [
      clipboardHas,
      copyPath,
      cutPath,
      deletePath,
      getProperties,
      loadPath,
      path,
      refreshClipboard,
      renamePath,
      runOperation,
      handlePaste,
    ],
  );

  const getCurrentFocusedItem = useCallback(() => {
    if (typeof document === "undefined") return null;
    const active = document.activeElement as HTMLElement | null;
    if (active) {
      try {
        const closest = (active as HTMLElement).closest('[data-item-path]') as HTMLElement | null;
        if (closest) {
          const p = closest.getAttribute('data-item-path');
          if (p) {
            const found = items.find((it) => it.path === p);
            if (found) return found;
          }
        }
      } catch (e) {
        // ignore
      }
    }
    if (focusPath) {
      const focusedItem = items.find((item) => item.path === focusPath);
      if (focusedItem) {
        return focusedItem;
      }
    }

    // No focused item found: return null (do not fallback to first item)
    return null;
  }, [focusPath, items]);

  useEffect(() => {
    openContextMenuRef.current = openContextMenu;
    getCurrentFocusedItemRef.current = getCurrentFocusedItem;
    goBackRef.current = goBack;
    exitPluginRef.current = exitPlugin;
  }, [openContextMenu, getCurrentFocusedItem, goBack, exitPlugin]);

  const handleFooterTriangle = useCallback(() => {
    const item = getCurrentFocusedItemRef.current();
    openContextMenuRef.current(item);
  }, []);

  const handleFooterCross = useCallback(() => {
    const item = getCurrentFocusedItemRef.current();
    if (item && item.is_dir) {
      void loadPath(item.path, undefined, true, item.path);
    }
  }, [loadPath]);

  const handleFooterCircle = useCallback(() => {
    goBack();
  }, [goBack]);

  useEffect(() => {
    isPluginActive.current = true;
    return () => {
      isPluginActive.current = false;
    };
  }, []);

  const filteredItems = useMemo(() => {
    let filtered = items;

    if (!showHidden) {
      filtered = filtered.filter((item) => !item.name.startsWith("."));
    }

    if (fileTypeFilter === "folders") {
      filtered = filtered.filter((item) => item.is_dir);
    } else if (fileTypeFilter === "files") {
      filtered = filtered.filter((item) => !item.is_dir);
    }

    return [...filtered].sort((a, b) => {
      const comparison = a.name.localeCompare(b.name);
      return sortOrder === "asc" ? comparison : -comparison;
    });
  }, [items, showHidden, fileTypeFilter, sortOrder]);

  const fileRows = useMemo(() => {
    if (loading) return <PanelSectionRow>Carregando...</PanelSectionRow>;
    if (error) return <PanelSectionRow>{error}</PanelSectionRow>;

    if (!filteredItems.length) return <PanelSectionRow>Pasta vazia.</PanelSectionRow>;

    const visibleItems = filteredItems.slice(0, visibleItemCount);
    const hasMoreItems = visibleItems.length < filteredItems.length;

    return (
      <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_Y}>
        {visibleItems.map((item) => (
          <div
            key={item.path}
            data-item-path={item.path}
            ref={(el) => {
              itemRefs.current[item.path] = el;
            }}
          >
            <PanelSectionRow>
              <Focusable
                onActivate={() => {
                  if (item.is_dir) {
                    loadPath(item.path, undefined, true, item.path);
                  }
                }}
                onFocus={() => setFocusPath(item.path)}
              >
                <ButtonItem
                  onClick={() => {
                    if (item.is_dir) {
                      loadPath(item.path, undefined, true, item.path);
                    }
                  }}
                  layout="below"
                >
                  <div style={{ width: "100%", display: "flex", justifyContent: "flex-start", textAlign: "left", alignItems: "center", gap: 10 }}>
                    {item.is_dir ? <FolderIcon /> : isArchiveFile(item.name) ? <ArchiveIcon /> : <DocumentIcon />}
                    <span style={{ color: "currentColor", opacity: 0.95 }}>{item.name}</span>
                  </div>
                </ButtonItem>
              </Focusable>
            </PanelSectionRow>
          </div>
        ))}
        {hasMoreItems ? (
          <PanelSectionRow>
            <ButtonItem onClick={() => setVisibleItemCount((count) => count + 150)}>
              {t("action.show_more").replace("{count}", String(filteredItems.length - visibleItems.length))}
            </ButtonItem>
          </PanelSectionRow>
        ) : null}
      </Focusable>
    );
  }, [loading, error, filteredItems, visibleItemCount, focusPath, loadPath]);

  return (
    <>
      {!hasActiveModal ? (
        <Focusable
          style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}
          navEntryPreferPosition={NavEntryPositionPreferences.FIRST}
          onCancel={handleCancel}
          onCancelButton={handleCancel}
          onCancelActionDescription={t("action.back")}
          onOKActionDescription={t("action.select")}
          onOptionsActionDescription={t("action.options")}
        >
          <div ref={fileManagerScopeRef} data-file-manager-scope style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: "100%", padding: "56px 12px 48px", boxSizing: "border-box" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: "100%" }}>
              <div ref={pathInputScopeRef} data-path-input>
                <TextField
                  onFocus={() => {
                    pathInputFocusedRef.current = true;
                    pathInputLastFocusRef.current = Date.now();
                    if (pathInputBlurTimerRef.current !== null) {
                      window.clearTimeout(pathInputBlurTimerRef.current);
                      pathInputBlurTimerRef.current = null;
                    }
                    stabilizePathInputFocus();
                  }}
                  onClick={stabilizePathInputFocus}
                  onBlur={() => {
                    // Steam's virtual keyboard can briefly move focus away from
                    // the input before delivering the Circle controller event.
                    // Keep the guard alive for that transition.
                    if (pathInputBlurTimerRef.current !== null) {
                      window.clearTimeout(pathInputBlurTimerRef.current);
                    }
                    pathInputBlurTimerRef.current = window.setTimeout(() => {
                      pathInputFocusedRef.current = false;
                      pathInputBlurTimerRef.current = null;
                    }, 350);
                  }}
                  value={editedPath}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditedPath(e.currentTarget.value)}
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void loadPath(editedPath);
                    }
                  }}
                  bShowCopyAction={false}
                  tooltip={t("tooltip.currentPath")}
                  style={{ width: "100%", boxSizing: "border-box", minWidth: 0 }}
                />
              </div>

              <div style={{ width: "100%", padding: "8px 0", boxSizing: "border-box", minWidth: 0 }}>
                <Focusable
                  navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
                  style={{ display: "flex", gap: "12px", width: "100%", padding: "0" }}
                >
                  <div style={{ flex: "1 1 0%", minWidth: 0, display: "flex", alignItems: "center", justifyContent: "flex-start", padding: "0" }}>
                    <div style={{ width: "100%", minWidth: 0 }}>
                      <ToggleField
                        label={t("label.hidden")}
                        checked={showHidden}
                        onChange={(v: boolean) => setShowHidden(v)}
                      />
                    </div>
                  </div>
                  <div style={{ flex: "1 1 0%", minWidth: 0, display: "flex", alignItems: "center", justifyContent: "flex-start", padding: "0" }}>
                    <div style={{ width: "100%", minWidth: 0 }}>
                      <DropdownItem
                        label={t("label.order")}
                        rgOptions={[
                          { label: t("option.az"), data: "asc" },
                          { label: t("option.za"), data: "desc" },
                        ]}
                        selectedOption={sortOrder}
                        onChange={(option) => setSortOrder(option.data as "asc" | "desc")}
                      />
                    </div>
                  </div>
                  <div style={{ flex: "1 1 0%", minWidth: 0, display: "flex", alignItems: "center", justifyContent: "flex-start", padding: "0" }}>
                    <div style={{ width: "100%", minWidth: 0 }}>
                      <DropdownItem
                        label={t("label.type")}
                        rgOptions={[
                          { label: t("option.all"), data: "all" },
                          { label: t("option.folders"), data: "folders" },
                          { label: t("option.files"), data: "files" },
                        ]}
                        selectedOption={fileTypeFilter}
                        onChange={(option) => setFileTypeFilter(option.data as string)}
                      />
                    </div>
                  </div>
                </Focusable>
              </div>

              <div
                ref={listContainerRef}
                onScroll={(event) => {
                  const element = event.currentTarget;
                  if (element.scrollTop + element.clientHeight >= element.scrollHeight - 160) {
                    setVisibleItemCount((count) => Math.min(count + 150, filteredItems.length));
                  }
                }}
                style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingBottom: 48, boxSizing: "border-box" }}
              >
                <PanelSection title={t("panel.files")}>
                  {fileRows}
                </PanelSection>
                <div style={{ height: 48, flexShrink: 0 }} />
              </div>
            </div>
          </div>
        </Focusable>
      ) : null}

      {hasActiveModal ? (
        <>
          {hasActiveModal && (
            <div
              data-modal-root
              tabIndex={-1}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0, 0, 0, 0.45)",
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
                border: "1px solid rgba(255,255,255,0.08)",
                zIndex: 0,
              }}
            />
          )}

          {renameRequested && (
            <ModalRoot
              show={true}
              bDisableBackgroundDismiss={true}
              bHideMainWindowForPopouts={true}
              onCancel={() => {
                setRenameRequested(false);
                setRenameTarget(null);
                setRenameValue("");
              }}
            >
              <DialogBody>
                <ModalFocusScope>
                  <Focusable
                    navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
                    onCancel={() => { setRenameRequested(false); setRenameTarget(null); setRenameValue(""); }}
                    onCancelButton={() => { setRenameRequested(false); setRenameTarget(null); setRenameValue(""); }}
                    style={{ outline: "none", display: "flex", flexDirection: "column", alignItems: "stretch" }}
                  >
                    <div style={{ textAlign: "center", padding: "6px 0 12px" }}>
                      <h1 style={{ margin: 0 }}>{t("modal.rename")}</h1>
                    </div>

                    <div ref={renameModalRef} style={{ padding: "6px 0" }}>
                      <TextField
                        value={renameValue}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRenameValue(e.currentTarget.value)}
                        bShowCopyAction={false}
                        autoFocus
                      />
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", marginTop: 16 }}>
                      <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}>
                        <div style={{ width: "100%" }}>
                          <DialogButton ref={renameSaveRef as any} onClick={async () => {
                            if (!renameTarget) return;
                            if (!renameValue) return setError(t("error.invalid_name"));
                            await runOperation(t("action.renaming"), () => renamePath(renameTarget, renameValue), {
                              onError: (e) => {
                                setError(e?.message ?? t("error.could_not_rename"));
                              },
                            });
                            setRenameRequested(false);
                            setRenameTarget(null);
                            setRenameValue("");
                          }}>
                            {t("action.save")}
                          </DialogButton>
                        </div>
                      </Focusable>
                      <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}>
                        <div style={{ width: "100%" }}>
                          <DialogButton onClick={() => { setRenameRequested(false); setRenameTarget(null); setRenameValue(""); }}>
                            {t("action.cancel")}
                          </DialogButton>
                        </div>
                      </Focusable>
                    </div>
                  </Focusable>
                </ModalFocusScope>
              </DialogBody>
            </ModalRoot>
          )}

          {createFolderRequested && (
            <ModalRoot
              show={true}
              bDisableBackgroundDismiss={true}
              bHideMainWindowForPopouts={true}
              onCancel={() => { setCreateFolderRequested(false); setCreateFolderName(""); }}
            >
              <DialogBody>
                <ModalFocusScope>
                  <Focusable
                    navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
                    onCancel={() => { setCreateFolderRequested(false); setCreateFolderName(""); }}
                    onCancelButton={() => { setCreateFolderRequested(false); setCreateFolderName(""); }}
                    style={{ outline: "none", display: "flex", flexDirection: "column", alignItems: "stretch" }}
                  >
                    <div style={{ textAlign: "center", padding: "6px 0 12px" }}>
                      <h1 style={{ margin: 0 }}>{t("modal.new_folder")}</h1>
                    </div>

                    <div ref={createFolderRef} style={{ padding: "6px 0" }}>
                      <TextField
                        value={createFolderName}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCreateFolderName(e.currentTarget.value)}
                        bShowCopyAction={false}
                        autoFocus
                      />
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", marginTop: 16 }}>
                      <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}>
                        <div style={{ width: "100%" }}>
                          <DialogButton ref={createFolderConfirmRef as any} onClick={async () => {
                            await handleCreateFolder(pathRef.current, createFolderName);
                          }}>
                            {t("action.create")}
                          </DialogButton>
                        </div>
                      </Focusable>
                      <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}>
                        <div style={{ width: "100%" }}>
                          <DialogButton onClick={() => { setCreateFolderRequested(false); setCreateFolderName(""); }}>
                            {t("action.cancel")}
                          </DialogButton>
                        </div>
                      </Focusable>
                    </div>
                  </Focusable>
                </ModalFocusScope>
              </DialogBody>
            </ModalRoot>
          )}

          {deleteRequested && deleteTarget && (
            <ModalRoot
              show={true}
              bDisableBackgroundDismiss={true}
              bHideMainWindowForPopouts={true}
              onCancel={() => {
                setDeleteRequested(false);
                setDeleteTarget(null);
                setDeleteName(null);
              }}
            >
              <DialogBody>
                <ModalFocusScope>
                  <Focusable
                    navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
                    onCancel={() => { setDeleteRequested(false); setDeleteTarget(null); setDeleteName(null); }}
                    onCancelButton={() => { setDeleteRequested(false); setDeleteTarget(null); setDeleteName(null); }}
                    style={{ outline: "none", display: "flex", flexDirection: "column", alignItems: "stretch" }}
                  >
                    <div style={{ textAlign: "center", padding: "6px 0 12px" }}>
                      <h1 style={{ margin: 0 }}>{t("modal.confirm_delete")}</h1>
                    </div>
                    <div ref={deleteModalRef} style={{ padding: "6px 0", textAlign: "center" }}>
                      <div>{t("modal.delete_question").replace("{name}", String(deleteName))}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", marginTop: 16 }}>
                      <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}>
                        <div style={{ width: "100%" }}>
                          <DialogButton ref={deleteConfirmRef as any} onClick={async () => {
                            if (!deleteTarget) return;
                            await runOperation(t("action.deleting"), () => deletePath(deleteTarget), {
                              onError: (e) => {
                                const message = String(e?.message ?? t("error.could_not_delete"));
                                if (message.toLowerCase().includes("permissão")) {
                                  setPermissionModal({ message: t("permission.denied") });
                                } else {
                                  setError(message);
                                }
                              },
                            });
                            setDeleteRequested(false);
                            setDeleteTarget(null);
                            setDeleteName(null);
                          }}>
                            {t("action.yes")}
                          </DialogButton>
                        </div>
                      </Focusable>
                      <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}>
                        <div style={{ width: "100%" }}>
                          <DialogButton onClick={() => { setDeleteRequested(false); setDeleteTarget(null); setDeleteName(null); }}>
                            {t("action.no")}
                          </DialogButton>
                        </div>
                      </Focusable>
                    </div>
                  </Focusable>
                </ModalFocusScope>
              </DialogBody>
            </ModalRoot>
          )}

          {conflictModal && (
            <ModalRoot
              show={true}
              bDisableBackgroundDismiss={true}
              bHideMainWindowForPopouts={true}
              onCancel={() => setConflictModal(null)}
            >
              <DialogBody>
                <ModalFocusScope>
                  <Focusable
                    navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
                    onCancel={() => setConflictModal(null)}
                    onCancelButton={() => setConflictModal(null)}
                    style={{ outline: "none", display: "flex", flexDirection: "column", alignItems: "stretch" }}
                  >
                    <div style={{ textAlign: "center", padding: "6px 0 12px" }}>
                      <h1 style={{ margin: 0 }}>{conflictModal.title}</h1>
                    </div>
                    <div style={{ padding: "6px 0", textAlign: "center" }}>
                      <div>{conflictModal.message}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", marginTop: 16 }}>
                      {conflictModal.isFolderConflict ? (
                        <>
                          <DialogButton ref={conflictPrimaryRef as any} onClick={() => void handleConflictChoice("merge")}>{t("conflict.merge")}</DialogButton>
                          <DialogButton onClick={() => void handleConflictChoice("replace")} >{t("conflict.replace")}</DialogButton>
                          <DialogButton onClick={() => void handleConflictChoice("ignore")} >{t("conflict.ignore")}</DialogButton>
                          <DialogButton onClick={() => setConflictModal(null)}>{t("action.cancel")}</DialogButton>
                        </>
                      ) : (
                        <>
                          <DialogButton ref={conflictPrimaryRef as any} onClick={() => void handleConflictChoice("replace")}>{t("conflict.replace")}</DialogButton>
                          <DialogButton onClick={() => void handleConflictChoice("keep-both")}>{t("conflict.keep_both")}</DialogButton>
                          <DialogButton onClick={() => void handleConflictChoice("ignore")}>{t("conflict.ignore")}</DialogButton>
                          <DialogButton onClick={() => setConflictModal(null)}>{t("action.cancel")}</DialogButton>
                        </>
                      )}
                    </div>
                  </Focusable>
                </ModalFocusScope>
              </DialogBody>
            </ModalRoot>
          )}

          {permissionModal && (
            <ModalRoot
              show={true}
              bDisableBackgroundDismiss={true}
              bHideMainWindowForPopouts={true}
              onCancel={() => setPermissionModal(null)}
            >
              <DialogBody>
                <ModalFocusScope>
                  <Focusable
                    navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
                    onCancel={() => setPermissionModal(null)}
                    onCancelButton={() => setPermissionModal(null)}
                    style={{ outline: "none", display: "flex", flexDirection: "column", alignItems: "stretch" }}
                  >
                    <div style={{ textAlign: "center", padding: "6px 0 12px" }}>
                      <h1 style={{ margin: 0 }}>{t("modal.permission_denied")}</h1>
                    </div>
                    <div style={{ padding: "6px 0", textAlign: "center" }}>
                      <div>{permissionModal.message}</div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
                      <DialogButton ref={permissionPrimaryRef as any} onClick={() => setPermissionModal(null)}>{t("action.cancel")}</DialogButton>
                    </div>
                  </Focusable>
                </ModalFocusScope>
              </DialogBody>
            </ModalRoot>
          )}

          {operationModal && (
            <ModalRoot
              show={true}
              bDisableBackgroundDismiss={true}
              bHideMainWindowForPopouts={true}
              onCancel={() => setOperationCancelRequested(true)}
            >
              <DialogBody>
                <ModalFocusScope>
                  <div style={{ minWidth: 280, padding: "8px 0" }}>
                    <div style={{ textAlign: "center", marginBottom: 8 }}>
                      <strong>{operationModal.label}</strong>
                    </div>
                    <div style={{ height: 12, borderRadius: 999, background: "#2b2b2b", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${operationModal.progress}%`, background: "#4e8ad9", transition: "width 0.2s linear" }} />
                    </div>
                    <div style={{ textAlign: "center", marginTop: 8, fontSize: 12 }}>{operationModal.progress}%</div>
                    <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
                      <DialogButton onClick={() => setOperationCancelRequested(true)}>
                        {t("action.cancel")}
                      </DialogButton>
                    </div>
                  </div>
                </ModalFocusScope>
              </DialogBody>
            </ModalRoot>
          )}

          {propertiesRequested && propertiesData && (
            <ModalRoot
              show={true}
              bHideMainWindowForPopouts={true}
              onCancel={() => {
                setPropertiesRequested(false);
                setPropertiesData(null);
                setIsCalculatingFolderSize(false);
              }}
            >
              <DialogBody>
                <ModalFocusScope>
                  <div style={{ textAlign: "center", paddingBottom: 8 }}>
                    <h1 style={{ margin: 0 }}>{t("menu.properties")}</h1>
                  </div>
                  <Focusable
                    onCancel={() => {setPropertiesRequested(false);setPropertiesData(null);setIsCalculatingFolderSize(false);
                    }}
                  onCancelButton={() => {setPropertiesRequested(false);setPropertiesData(null);setIsCalculatingFolderSize(false);
                    }}
                    style={{ outline: "none" }}
                  >
                    <div ref={propertiesModalRef} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div><strong>{t("properties.name")}</strong> {propertiesData.name}</div>
                      <div><strong>{t("properties.path")}</strong> {propertiesData.path}</div>
                      <div><strong>{t("properties.type")}</strong> {propertiesData.type === "folder" ? t("properties.type.folder") : t("properties.type.file")}</div>
                      <div><strong>{t("properties.size")}</strong> {propertiesData.type === "folder" && isCalculatingFolderSize
                        ? t("properties.calculating")
                        : propertiesData.size !== null
                          ? formatBytes(propertiesData.size)
                          : "N/A"}</div>
                      <div><strong>{t("properties.created")}</strong> {propertiesData.created}</div>
                      <div><strong>{t("properties.modified")}</strong> {propertiesData.modified}</div>
                      <div><strong>{t("properties.permissions")}</strong> {propertiesData.permissions}</div>
                    </div>
                    <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 12 }}>
                      <DialogButton ref={propertiesCloseRef as any} onClick={() => { setPropertiesRequested(false); setPropertiesData(null); setIsCalculatingFolderSize(false); }}>
                        {t("action.close")}
                      </DialogButton>
                    </div>
                  </Focusable>
                </ModalFocusScope>
              </DialogBody>
            </ModalRoot>
          )}
        </>
      ) : null}

      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          height: 60,
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 24,
          paddingRight: 24,
          pointerEvents: "none",
          zIndex: 999,
        }}
      >
        <div
          style={{
            width: 80,
            height: 60,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            pointerEvents: "auto",
          }}
          onClick={handleFooterCircle}
        />

        <div
          style={{
            width: 80,
            height: 60,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            pointerEvents: "auto",
          }}
          onClick={handleFooterTriangle}
        />

        <div
          style={{
            width: 80,
            height: 60,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            pointerEvents: "auto",
          }}
          onClick={handleFooterCross}
        />
      </div>
    </>
  );
}

function Content() {
  const openFullScreen = useCallback(() => {
    Router.CloseSideMenus();
    // Use Navigate instead of NavigateToLayoutPreview to avoid the layout preview
    // which can add default back/home hints in the overlay.
    Router.Navigate?.("/steam-os-file-manager");
  }, []);

  return (
    <PanelSection title={t("panel.file_manager")}>
      <PanelSectionRow>
        <ButtonItem
          onClick={openFullScreen}
          layout="below"
        >
          <div style={{ width: "100%", display: "flex", justifyContent: "flex-start", alignItems: "center", gap: 10 }}>
            <PluginIcon />
            <span>{t("action.open_file_manager")}</span>
          </div>
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
}

routerHook.addRoute("/steam-os-file-manager", FileManagerPage);

export default definePlugin(() => {
  return {
    name: "Decky Manager",
    content: <Content />,
    icon: <PluginIcon />,
  };
});
