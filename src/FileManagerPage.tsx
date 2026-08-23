import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, SetStateAction } from "react";
import { t, loadRemoteTranslations, getLocale } from "./i18n";
import pluginInfo from "../plugin.json";
import FileSelector from "./FileSelector";
import { usePane } from "./PaneView";
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
  showModal,
} from "@decky/ui";
import { callable, useQuickAccessVisible } from "@decky/api";
import { showContextMenu, Menu, MenuItem, MenuSeparator } from "@decky/ui";
import {
  MENU_OVERLAY_SELECTOR,
  isSteamQuickAccessMenuOpenInDom,
  isSteamMainMenuOpenInDom,
  getOverlaySelector,
  isElementActuallyVisible,
  isTextInputElement,
  safeFocus,
  safeBlur,
  ModalFocusScope,
} from "./utils/focus";
import {
  FolderIcon,
  DocumentIcon,
  ArchiveIcon,
  ExtractIcon,
  CopyIcon,
  CutIcon,
  PasteIcon,
  NewFolderIcon,
  RenameIcon,
  DeleteIcon,
  PropertiesIcon,
  SteamIcon,
} from "./Icons";
import { isArchiveFile, formatBytes } from "./utils/file";
import DrivesBar from "./DrivesBar";

type FileEntry = {
  name: string;
  path: string;
  is_dir: boolean;
  size: number | null;
  modified: number;
};

const FILE_MANAGER_HORIZONTAL_INSET = 12;
const FILE_MANAGER_EDGE_OFFSET = 3;
const FILE_MANAGER_OUTER_STYLE: React.CSSProperties = {
  width: `calc(100% - ${FILE_MANAGER_EDGE_OFFSET * 2}px)`,
  boxSizing: "border-box",
  margin: `0 ${FILE_MANAGER_EDGE_OFFSET}px`,
};

const getParentDirectory = (currentPath: string) => {
  if (!currentPath || currentPath === "/") return "/";

  const parts = currentPath.split("/").filter(Boolean);
  if (parts.length === 0) return "/";

  parts.pop();
  return "/" + parts.join("/") || "/";
};

const listDir = callable<[string], { path: string; items: FileEntry[] }>("list_dir");

const formatLocaleDate = (timestamp: number): string => {
  try {
    return new Intl.DateTimeFormat(getLocale(), {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(timestamp * 1000));
  } catch {
    return new Date(timestamp * 1000).toLocaleString();
  }
};

const stripTrailingEllipsis = (value: string): string => String(value ?? "").replace(/(?:\s*[.]{1,3}\s*)(?=(?:[:\-]|$))/g, "").replace(/\s{2,}/g, " ").trim();

const isGenericOperationText = (value: string) => {
  const normalized = String(value || "").trim().toLowerCase();
  return /^(all ok|all is ok|ok|done|success|successfully|sucesso|concluído|concluida|concluída|operation|operacao)$/i.test(normalized);
};

const formatPropertyPermissions = (permissions: { owner: string; immutable: boolean; raw: string }): string => {
  const parts = [permissions.owner];
  if (permissions.immutable) {
    parts.push(t("properties.permission.immutable"));
  }
  return parts.join(" • ");
};

function FileManagerPage() {
  const [path, setPath] = useState("");
  const pathRef = useRef(path);
  const [editedPath, setEditedPath] = useState("");
  const historyRef = useRef<Array<{ path: string; focusTarget: string | null }>>([]);
  const [items, setItems] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const isQuickAccessVisible = useQuickAccessVisible();

  const {
    isSplitView,
    setIsSplitView,
    selectedPane,
    setSelectedPane,
    leftPath,
    setLeftPath,
    rightPath,
    setRightPath,
    leftItems,
    rightItems,
    leftLoading,
    rightLoading,
    leftError,
    rightError,
    lastLoadedPanePathRef,
    getPanePath,
    loadPanePath,
    syncPanePair,
  } = usePane({ listDir, currentPath: path });
  const [sortOrder, setSortOrder] = useState("asc");
  const [fileTypeFilter, setFileTypeFilter] = useState("all");
  const [visibleItemCount, setVisibleItemCount] = useState(150);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const resultFileRef = useRef<string | null>(null);
  const fileSelectionModeRef = useRef<"file" | "folder" | "text-editor" | null>(null);
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
  const pathInputKeyboardOpenRef = useRef(false);
  const pathInputBlurTimerRef = useRef<number | null>(null);
  const pathInputLastFocusRef = useRef(0);
  const pathInputSuppressFocusRef = useRef(true);

  const openContextMenuRef = useRef<(item: FileEntry | null) => void>(() => null);
  const getCurrentFocusedItemRef = useRef<() => FileEntry | null>(() => null);
  const goBackRef = useRef<() => void>(() => null);
  const exitPluginRef = useRef<() => void>(() => null);

  const getParentNavigationItemForPath = useCallback((currentPath: string | null): FileEntry | null => {
    if (!currentPath || currentPath === "/") return null;

    return {
      name: t("nav.parent"),
      path: getParentDirectory(currentPath),
      is_dir: true,
      size: null,
      modified: 0,
    };
  }, []);

  const isParentNavigationItem = useCallback(
    (item: FileEntry | null, currentPath: string | null = path) => {
      const parentItem = getParentNavigationItemForPath(currentPath);
      return !!item && !!parentItem && item.path === parentItem.path && item.name === parentItem.name && item.is_dir;
    },
    [getParentNavigationItemForPath, path],
  );

  const focusFirstListItem = useCallback(() => {
    if (typeof document === "undefined") return;

    if (pathInputFocusedRef.current || pathInputKeyboardOpenRef.current) {
      return;
    }

    const firstItemWrapper = Object.values(itemRefs.current).find((el) => !!el) ?? listContainerRef.current?.querySelector<HTMLElement>("[data-item-path]");
    if (!firstItemWrapper) {
      return;
    }

    const focusableCandidate = firstItemWrapper.querySelector<HTMLElement>("button:not([disabled]), [role='button']:not([disabled]), [tabindex]:not([tabindex='-1']):not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])") ?? firstItemWrapper;
    if (focusableCandidate && document.activeElement !== focusableCandidate) {
      safeFocus(focusableCandidate);
    }
  }, []);

  useLayoutEffect(() => {
    if (typeof document === "undefined") return;

    const input = pathInputScopeRef.current?.querySelector<HTMLInputElement>("input");
    if (input && document.activeElement === input) {
      pathInputSuppressFocusRef.current = true;
      pathInputFocusedRef.current = false;
      pathInputKeyboardOpenRef.current = false;
      safeBlur(input);
      focusFirstListItem();
    }
    window.setTimeout(() => {
      pathInputSuppressFocusRef.current = false;
    }, 150);
  }, [focusFirstListItem]);

  useLayoutEffect(() => {
    if (typeof document === "undefined") return;
    if (loading || focusPath !== null || items.length === 0) return;

    const input = pathInputScopeRef.current?.querySelector<HTMLInputElement>("input");
    if (input && document.activeElement === input) {
      safeBlur(input);
    }

    focusFirstListItem();
  }, [focusFirstListItem, focusPath, items.length, loading]);

  const getGlobalPath = useCallback(() => path || "/", [path]);

  useEffect(() => {
    if (!path) return;
    const currentPath = path || "/";
    if (!isSplitView && leftPath !== currentPath) {
      setLeftPath(currentPath);
    }
    if (!isSplitView && rightPath !== currentPath) {
      setRightPath(currentPath);
    }
  }, [isSplitView, leftPath, path, rightPath, setLeftPath, setRightPath]);

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

        if (!isSplitView) {
          syncPanePair(res.path, res.items);
        }

        setFocusPath(focusTarget);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const fallbackMessage = notFoundMsg ?? message ?? t("error.could_not_load_directory");
        if (fallbackMessage) {
          setError(null);
        }
      } finally {
        setLoading(false);
      }
    },
    [isSplitView, syncPanePair],
  );

  const loadPathRef = useRef(loadPath);
  useEffect(() => {
    loadPathRef.current = loadPath;
  }, [loadPath]);

  useEffect(() => {
    if (loading || !items.length) return;
    if (focusPath !== null) return;

    const frame = window.requestAnimationFrame(() => focusFirstListItem());

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [focusPath, items, loading, path, focusFirstListItem]);

  const exitPlugin = useCallback(() => {
    Router.CloseSideMenus();
    Navigation.NavigateBack?.();
  }, []);

  const handleCancel = useCallback(() => {
  }, []);

  const goBack = useCallback(() => {
    if (shouldSuppressGoBack()) {
      return;
    }

    setError(null);

    const currentPanePath = isSplitView
      ? (selectedPane === "left" ? leftPath || path || "/" : rightPath || path || "/")
      : (path || "/");

    try {
      if (!currentPanePath) {
        exitPlugin();
        return;
      }

      if (currentPanePath === "/") {
        return;
      }

      const parts = currentPanePath.split("/");
      const filtered = parts.filter((p) => p !== "");

      if (filtered.length === 0) {
        exitPlugin();
        return;
      }

      filtered.pop();
      const parentDir = "/" + filtered.join("/") || "/";

      if (parentDir === currentPanePath) {
        exitPlugin();
        return;
      }

      if (isSplitView) {
        void loadPanePath(selectedPane, parentDir);
        return;
      }

      void loadPath(parentDir, t("error.directory_not_found"));
    } catch (e) {
      if (historyRef.current.length > 0) {
        const previousEntry = historyRef.current[historyRef.current.length - 1];
        historyRef.current = historyRef.current.slice(0, -1);
        void loadPath(previousEntry.path, t("error.directory_not_found"), false, previousEntry.focusTarget);
      }
    }
  }, [isSplitView, leftPath, loadPanePath, loadPath, path, rightPath, selectedPane, exitPlugin]);

  const initialLoadDone = useRef(false);

  const [i18nVersion, setI18nVersion] = useState(0);
  void i18nVersion;

  useEffect(() => {
    void (async () => {
      try {
        const REMOTE_BASE = (pluginInfo && (pluginInfo as any).translations_base_url) || "";
        await loadRemoteTranslations(REMOTE_BASE || undefined);
        setI18nVersion((v) => v + 1);
        console.info("i18n: active locale:", getLocale());
      } catch (e) {
        console.warn("i18n: remote load failed", e);
      }
    })();

    if (initialLoadDone.current) return;
    initialLoadDone.current = true;

    const applyModeFromLocation = () => {
      const searchParams = new URLSearchParams(window.location.search);
      const pathname = window.location.pathname || "/steam-os-file-manager";
      const pathMode = pathname.endsWith("/select-file") ? "select-file" : pathname.endsWith("/select") ? "select" : null;
      const modeParam = searchParams.get("mode");
      const textEditorMode = searchParams.get("textEditorMode") === "true";
      const isContentSidebarMode = searchParams.get("content") === "true";
      const mode = pathMode ?? (modeParam === "select-file" ? "select-file" : modeParam === "select" ? "select" : "normal");
      const isSelectionModeActive = mode !== "normal" || textEditorMode;
      setIsSelectionMode(isSelectionModeActive);

      if (textEditorMode) {
        fileSelectionModeRef.current = "text-editor";
      } else if (mode === "select-file") {
        fileSelectionModeRef.current = "file";
        sessionStorage.removeItem("_decky_text_editor_selection_mode");
      } else if (mode === "select") {
        fileSelectionModeRef.current = "folder";
        sessionStorage.removeItem("_decky_text_editor_selection_mode");
      } else {
        fileSelectionModeRef.current = null;
        sessionStorage.removeItem("_decky_text_editor_selection_mode");
      }

      const resultFile = searchParams.get("resultFile");
      if (resultFile) {
        resultFileRef.current = decodeURIComponent(resultFile);
      } else {
        resultFileRef.current = null;
      }

      if (isContentSidebarMode) {
        setIsSplitView(false);
      }

      const startPath = decodeURIComponent(searchParams.get("path") || "");
      void loadPathRef.current(startPath, undefined, true, null);
    };

    applyModeFromLocation();

    const handleLocationChange = () => {
      applyModeFromLocation();
    };

    window.addEventListener("popstate", handleLocationChange);
    return () => window.removeEventListener("popstate", handleLocationChange);
  }, []);

  useEffect(() => {
    setVisibleItemCount(150);
  }, [path, showHidden, sortOrder, fileTypeFilter]);

  useEffect(() => {
    if (!path) return;

    if (!isSplitView) {
      if (leftPath !== path) setLeftPath(path);
      if (rightPath === "") setRightPath(path);
      return;
    }

    if (leftPath === "") setLeftPath(path);
    if (rightPath === "") setRightPath(path);
  }, [isSplitView, path, leftPath, rightPath]);

  useEffect(() => {
    if (!leftPath || leftLoading) return;
    if (lastLoadedPanePathRef.current.left === leftPath) return;
    void loadPanePath("left", leftPath);
  }, [leftLoading, leftPath, loadPanePath]);

  useEffect(() => {
    if (!rightPath || rightLoading) return;
    if (lastLoadedPanePathRef.current.right === rightPath) return;
    void loadPanePath("right", rightPath);
  }, [rightLoading, rightPath, loadPanePath]);

  const hasClipboard = callable<[], { has: boolean }>("has_clipboard");
  const copyPath = callable<[string], { ok: boolean }>("copy_path");
  const cutPath = callable<[string], { ok: boolean }>("cut_path");
  const pastePathWithOptions = callable<[string, string, boolean, string, string, string], { ok: boolean; skipped?: boolean; cancelled?: boolean; conflict_strategy?: string }>("paste_path_with_options");
  const checkPasteConflict = callable<[string], { blocked: boolean; reason?: string; needs_conflict?: boolean; path?: string; name: string; is_dir?: boolean }>("check_paste_conflict");
  const extractArchive = callable<[string, string, string, string], { success: boolean; new_path?: string }>("extract_archive");
  const renamePath = callable<[string, string, string], { success: boolean; new_path: string }>("rename_item");
  const deletePath = callable<[string, string, string], { success: boolean; error?: string }>("delete_item");
  const getOperationProgress = callable<[string], { progress: number; active: boolean; label: string; detail?: string; paused: boolean }>("get_operation_progress");
  const cancelOperation = callable<[string], { ok: boolean }>("cancel_operation");
  const pauseOperation = callable<[string], { ok: boolean }>("pause_operation");
  const resumeOperation = callable<[string], { ok: boolean }>("resume_operation");
  const readFileContent = callable<[string], { success: boolean; content?: string; error?: string; size?: number }>("read_file_content");
  const setFileSelection = callable<[string, string | null], { success: boolean; selected_file?: string; error?: string }>("set_file_selection");
  const validateExecutable = callable<[string], { success: boolean; path?: string; name?: string; error?: string }>("validate_executable");
  const getProperties = callable<[string], {
    name: string;
    path: string;
    type: "file" | "folder";
    size: number | null;
    created: number;
    modified: number;
    permissions: {
      owner: string;
      immutable: boolean;
      raw: string;
    };
  }>("get_properties");
  const getDirectorySize = callable<[string], { size: number | null; path: string }>("get_directory_size");
  const mountDrive = callable<[string], { ok: boolean; path?: string; error?: string }>("mount_drive");

  const [clipboardHas, setClipboardHas] = useState(false);
  const clipboardHasRef = useRef(false);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>("");
  const [renameRequested, setRenameRequested] = useState(false);
  const renameModalRef = useRef<HTMLDivElement | null>(null);
  const renameSaveRef = useRef<HTMLButtonElement | null>(null);
  const renameInputFocusedRef = useRef(false);
  const renameInputKeyboardOpenRef = useRef(false);
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
    created: number;
    modified: number;
    permissions: {
      owner: string;
      immutable: boolean;
      raw: string;
    };
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
    showBackground?: boolean;
    operationId?: string;
    paused?: boolean;
  } | null;
  type BackgroundOperationState = {
    label: string;
    progress: number;
    operationId: string;
    paused: boolean;
  };
  type PermissionModalState = {
    message: string;
  } | null;

  const [conflictModal, setConflictModal] = useState<ConflictModalState>(null);
  const [operationModal, setOperationModal] = useState<OperationModalState>(null);
  const [backgroundOperations, setBackgroundOperations] = useState<BackgroundOperationState[]>([]);
  const backgroundOperationsRef = useRef<BackgroundOperationState[]>([]);
  const activePollingOperationIdsRef = useRef<Set<string>>(new Set());
  const latestModalOperationIdRef = useRef<string | null>(null);
  const [operationCancelRequested, setOperationCancelRequested] = useState(false);
  const operationCancelRequestedRef = useRef(false);
  const isMountedRef = useRef(true);
  const [permissionModal, setPermissionModal] = useState<PermissionModalState>(null);
  const [sameDirectoryModal, setSameDirectoryModal] = useState<string | null>(null);

  useEffect(() => {
    backgroundOperationsRef.current = backgroundOperations;
  }, [backgroundOperations]);

  const dispatchBackgroundOperationStore = useCallback((operations: BackgroundOperationState[]) => {
    const store = (window as any).__deckyManagerBackgroundOperation__ || {};
    (window as any).__deckyManagerBackgroundOperation__ = {
      ...store,
      operations,
      active: operations.length > 0,
    };
    window.dispatchEvent(new CustomEvent("decky-manager-background-operation", {
      detail: { operations, active: operations.length > 0 },
    }));
  }, []);

  const setBackgroundOperationList = useCallback((operations: SetStateAction<BackgroundOperationState[]>) => {
    setBackgroundOperations((prev) => {
      const nextOperations =
        typeof operations === "function"
          ? (operations as (prev: BackgroundOperationState[]) => BackgroundOperationState[])(prev)
          : operations;
      backgroundOperationsRef.current = nextOperations;
      dispatchBackgroundOperationStore(nextOperations);
      return nextOperations;
    });
  }, [dispatchBackgroundOperationStore]);

  const addBackgroundOperation = useCallback(
    (operation: BackgroundOperationState) => {
      setBackgroundOperationList((prev) => {
        const exists = prev.some((op) => op.operationId === operation.operationId);
        if (exists) {
          return prev.map((op) => (op.operationId === operation.operationId ? operation : op));
        }
        return [...prev, operation];
      });
    },
    [setBackgroundOperationList]
  );

  const updateBackgroundOperation = useCallback(
    (operationId: string, updater: (op: BackgroundOperationState) => BackgroundOperationState) => {
      setBackgroundOperationList((prev) => prev.map((op) => (op.operationId === operationId ? updater(op) : op)));
    },
    [setBackgroundOperationList]
  );

  const removeBackgroundOperation = useCallback(
    (operationId: string) => {
      setBackgroundOperationList((prev) => prev.filter((op) => op.operationId !== operationId));
    },
    [setBackgroundOperationList]
  );

  const restoreBackgroundOperationFromStore = useCallback(() => {
    const store = (window as any).__deckyManagerBackgroundOperation__;
    if (Array.isArray(store?.operations)) {
      const operations = store.operations as BackgroundOperationState[];
      setBackgroundOperations(operations);
      backgroundOperationsRef.current = operations;
    }
  }, []);

  useEffect(() => {
    restoreBackgroundOperationFromStore();

    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (Array.isArray(detail?.operations)) {
        const operations = detail.operations as BackgroundOperationState[];
        setBackgroundOperations(operations);
        backgroundOperationsRef.current = operations;
      }
    };

    window.addEventListener("decky-manager-background-operation", handler as EventListener);
    return () => window.removeEventListener("decky-manager-background-operation", handler as EventListener);
  }, [restoreBackgroundOperationFromStore]);

  const requestOperationPauseToggle = useCallback(
    async (operationId?: string) => {
      const operationToPauseId = operationId ?? operationModal?.operationId ?? null;
      if (!operationToPauseId) {
        return;
      }

      try {
        const activeOperation = backgroundOperationsRef.current.find((op) => op.operationId === operationToPauseId);
        if (activeOperation?.paused) {
          await resumeOperation(operationToPauseId);
          updateBackgroundOperation(operationToPauseId, (op) => ({ ...op, paused: false }));
          if (operationModal?.operationId === operationToPauseId) {
            setOperationModal((prev) => prev ? { ...prev, paused: false } : prev);
          }
        } else {
          await pauseOperation(operationToPauseId);
          updateBackgroundOperation(operationToPauseId, (op) => ({ ...op, paused: true }));
          if (operationModal?.operationId === operationToPauseId) {
            setOperationModal((prev) => prev ? { ...prev, paused: true } : prev);
          }
        }
      } catch (e) {
        console.warn("operation pause toggle failed", e);
      }
    },
    [pauseOperation, resumeOperation, operationModal, updateBackgroundOperation]
  );

  const requestOperationCancel = useCallback(
    async (operationId?: string) => {
      const operationToCancelId = operationId ?? operationModal?.operationId ?? null;

      if (!operationToCancelId) {
        if (operationCancelRequestedRef.current) {
          return;
        }
        if (isMountedRef.current) {
          setOperationCancelRequested(true);
        }
        operationCancelRequestedRef.current = true;
        return;
      }

      const globalCanceled = (window as any).__deckyManagerBackgroundCanceledOperationIds || new Set<string>();
      globalCanceled.add(operationToCancelId);
      (window as any).__deckyManagerBackgroundCanceledOperationIds = globalCanceled;

      try {
        await cancelOperation(operationToCancelId);
      } catch (e) {
        globalCanceled.delete(operationToCancelId);
        (window as any).__deckyManagerBackgroundCanceledOperationIds = globalCanceled;
        console.warn("cancelOperation failed", e);
      }

      removeBackgroundOperation(operationToCancelId);
      activePollingOperationIdsRef.current.delete(operationToCancelId);
      if (operationModal?.operationId === operationToCancelId) {
        setOperationModal(null);
      }
    },
    [cancelOperation, operationModal, removeBackgroundOperation]
  );

  useEffect(() => {
    (window as any).deckyManagerBackgroundOperationCancel = requestOperationCancel;
    (window as any).deckyManagerBackgroundOperationPauseToggle = requestOperationPauseToggle;
    return () => {
      if ((window as any).deckyManagerBackgroundOperationCancel === requestOperationCancel) {
        delete (window as any).deckyManagerBackgroundOperationCancel;
      }
      if ((window as any).deckyManagerBackgroundOperationPauseToggle === requestOperationPauseToggle) {
        delete (window as any).deckyManagerBackgroundOperationPauseToggle;
      }
    };
  }, [requestOperationCancel, requestOperationPauseToggle]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const conflictPrimaryRef = useRef<HTMLButtonElement | null>(null);
  const permissionPrimaryRef = useRef<HTMLButtonElement | null>(null);

  const [createFolderRequested, setCreateFolderRequested] = useState(false);
  const [createFolderName, setCreateFolderName] = useState("");
  const createFolderRef = useRef<HTMLDivElement | null>(null);
  const createFolderConfirmRef = useRef<HTMLButtonElement | null>(null);
  const createFolderInputScopeRef = useRef<HTMLDivElement | null>(null);
  const createFolderInputFocusedRef = useRef(false);
  const createFolderInputKeyboardOpenRef = useRef(false);
  const fileManagerScopeRef = useRef<HTMLDivElement | null>(null);
  const backgroundFileManagerRef = useRef<HTMLDivElement | null>(null);
  const [addGameRequested, setAddGameRequested] = useState(false);
  const [addGamePath, setAddGamePath] = useState<string | null>(null);
  const [addGameName, setAddGameName] = useState<string>("");
  const [addGameError, setAddGameError] = useState<string | null>(null);
  const addGameConfirmRef = useRef<HTMLButtonElement | null>(null);
  const addGameInputScopeRef = useRef<HTMLDivElement | null>(null);
  const addGameInputFocusedRef = useRef(false);
  const addGameInputKeyboardOpenRef = useRef(false);
  const modalShowResultRef = useRef<{ Close: () => void; Update?: (modal: React.ReactNode) => void } | null>(null);
  const hasActiveModal = renameRequested || deleteRequested || propertiesRequested || createFolderRequested || addGameRequested || !!conflictModal || !!operationModal || !!permissionModal || !!sameDirectoryModal;
  const hasModalStateOpen = hasActiveModal;

  const resetAddGameModal = useCallback(() => {
    setAddGameRequested(false);
    setAddGamePath(null);
    setAddGameName("");
    addGameInputFocusedRef.current = false;
    addGameInputKeyboardOpenRef.current = false;
    setAddGameError(null);
  }, []);

  const openAddGameModal = useCallback((item: { path: string; name: string } | null) => {
    if (!item) return;
    const gameName = item.name.includes(".") ? item.name.substring(0, item.name.lastIndexOf(".")) : item.name;
    setAddGamePath(item.path);
    setAddGameName(gameName);
    setAddGameError(null);
    setAddGameRequested(true);
  }, []);

  const handleAddGame = useCallback(async () => {
    if (!addGamePath) return;

    const shortcutName = addGameName.trim();
    if (!shortcutName) {
      setAddGameError(t("shortcut.error.name_required"));
      return;
    }

    setAddGameError(null);
    try {

      const validRes = await validateExecutable(addGamePath);
      if (!validRes.success) {
        setAddGameError(validRes.error || t("shortcut.error.invalid_file"));
        return;
      }

      const steamClient = (window as any).SteamClient;
      if (!steamClient || !steamClient.Apps || !steamClient.Apps.AddShortcut) {
        setAddGameError(t("shortcut.error.steam_unavailable"));
        return;
      }

      const lastSlash = addGamePath.lastIndexOf("/");
      const directory = lastSlash > 0 ? addGamePath.substring(0, lastSlash) : "/";

      const newAppId = await steamClient.Apps.AddShortcut(
        shortcutName,
        addGamePath,
        directory,
        ""
      );

      if (typeof newAppId === "number" && !Number.isNaN(newAppId) && steamClient.Apps.SetShortcutName) {
        try {
          steamClient.Apps.SetShortcutName(newAppId, shortcutName);
        } catch (e) {
          console.warn("SteamClient.Apps.SetShortcutName not supported:", e);
        }
      }

      resetAddGameModal();
      exitPlugin();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setAddGameError(message || t("shortcut.error.add_failed"));
    }
  }, [addGamePath, addGameName, validateExecutable, exitPlugin, resetAddGameModal, t]);

  useEffect(() => {
    const background = backgroundFileManagerRef.current;
    if (!background) return;

    const frame = window.requestAnimationFrame(() => {
      if (hasActiveModal) {
        background.setAttribute("inert", "");
        background.setAttribute("aria-hidden", "true");
      } else {
        background.removeAttribute("inert");
        background.removeAttribute("aria-hidden");
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [hasActiveModal]);

  useLayoutEffect(() => {
    if (!addGameRequested || !addGamePath) return;

    const focusInput = () => {
      const input = document.querySelector<HTMLInputElement>("[data-add-game-input]");
      if (!input) return;
      safeFocus(input);
      try {
        const valueLength = input.value.length;
        input.setSelectionRange?.(valueLength, valueLength);
      } catch (e) {
        console.error("setSelectionRange failed:", e);
      }
    };

    const frame = window.requestAnimationFrame(focusInput);
    const timeout = window.setTimeout(focusInput, 60);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [addGamePath, addGameRequested]);

  useEffect(() => {
    (async () => {
      try {
        const res = await hasClipboard();
        const hasClipboardNow = Boolean(res.has);
        clipboardHasRef.current = hasClipboardNow;
        setClipboardHas(hasClipboardNow);
      } catch (e) {
        console.warn("Clipboard check failed:", e);
        clipboardHasRef.current = false;
        setClipboardHas(false);
      }
    })();
  }, [hasClipboard, path]);

  const clearContextMenu = useCallback(() => {
    if (!contextMenuInstance.current) return;
    try {
      contextMenuInstance.current.Hide();
    } catch (e) {
      console.warn("context menu hide failed", e);
    }
    contextMenuInstance.current = null;
    lastOverlayRemovedAt.current = Date.now();
  }, []);

  const closeActiveModalOrContextMenu = useCallback(() => {
    if (contextMenuInstance.current) {
      clearContextMenu();
      return true;
    }

    if (renameRequested) {
      setRenameRequested(false);
      setRenameTarget(null);
      setRenameValue("");
      lastOverlayRemovedAt.current = Date.now();
      return true;
    }

    if (createFolderRequested) {
      setCreateFolderRequested(false);
      setCreateFolderName("");
      createFolderInputFocusedRef.current = false;
      createFolderInputKeyboardOpenRef.current = false;
      lastOverlayRemovedAt.current = Date.now();
      return true;
    }

    if (deleteRequested) {
      setDeleteRequested(false);
      setDeleteTarget(null);
      setDeleteName(null);
      lastOverlayRemovedAt.current = Date.now();
      return true;
    }

    if (conflictModal) {
      setConflictModal(null);
      lastOverlayRemovedAt.current = Date.now();
      return true;
    }

    if (permissionModal) {
      setPermissionModal(null);
      lastOverlayRemovedAt.current = Date.now();
      return true;
    }

    if (sameDirectoryModal) {
      setSameDirectoryModal(null);
      lastOverlayRemovedAt.current = Date.now();
      return true;
    }

    if (operationModal) {
      void requestOperationCancel();
      lastOverlayRemovedAt.current = Date.now();
      return true;
    }

    if (propertiesRequested) {
      setPropertiesRequested(false);
      setPropertiesData(null);
      setIsCalculatingFolderSize(false);
      lastOverlayRemovedAt.current = Date.now();
      return true;
    }

    if (addGameRequested) {
      resetAddGameModal();
      return true;
    }

    return false;
  }, [addGameRequested, clearContextMenu, conflictModal, createFolderRequested, deleteRequested, operationModal, permissionModal, propertiesRequested, renameRequested, resetAddGameModal]);

  const isAnyModalOrMenuOpen = useCallback(() => {
    if (contextMenuInstance.current) {
      const activeMenu = Array.from(document.querySelectorAll<HTMLElement>(MENU_OVERLAY_SELECTOR)).some((overlay) => isElementActuallyVisible(overlay));
      if (activeMenu) {
        return true;
      }
      clearContextMenu();
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
        "#QuickAccess-Menu",
        "#QuickAccess-NA",
        "[id^='QuickAccess-']",
        "[id^='QuickAccess_']",
        "[id^='quickaccess_']",
        "[id^='quickaccess_tab_']",
        "[id^='quickaccess_content_']",
      ].join(", ");

      const activeElementIsOverlay = activeElement?.closest(overlaySelector) as HTMLElement | null;
      if (activeElementIsOverlay && isElementActuallyVisible(activeElementIsOverlay)) {
        return true;
      }

      const overlayOpen = Array.from(document.querySelectorAll<HTMLElement>(overlaySelector)).some((overlay) => isElementActuallyVisible(overlay));
      if (overlayOpen) {
        return true;
      }
    }

    return hasActiveModal;
  }, [clearContextMenu, hasActiveModal]);

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
            const activeElement = document.activeElement as HTMLElement | null;
            const textFieldActive = isTextInputElement(activeElement);
            if (textFieldActive || isAnyModalOrMenuOpen()) {
              return;
            }
            const item = getCurrentFocusedItemRef.current();
            openContextMenuRef.current(item);
            return;
          }

          if (gamepadButton !== GAMEPAD_BUTTON_B) return;

          const pluginScope = fileManagerScopeRef.current ?? backgroundFileManagerRef.current;
          const outsidePluginOverlaySelector = ".contextMenu, .contextMenuContents, .BasicContextMenuModal, [role='menu'], [role='dialog'], [data-decky-modal], [aria-expanded='true'][aria-haspopup], #QuickAccess-Menu, #QuickAccess-NA, #Menu, #MainMenu, #SteamMenu, [id^='QuickAccess-'], [id^='QuickAccess_'], [id^='quickaccess_'], [id^='quickaccess_tab_'], [id^='quickaccess_content_'], [id*='MainMenu'], [id*='SteamMenu'], [data-steam-menu], [data-steam-overlay]";
          const overlayVisibleOutsidePlugin = Array.from(document.querySelectorAll<HTMLElement>(outsidePluginOverlaySelector)).some((overlay) => {
            if (!isElementActuallyVisible(overlay)) return false;
            if (!pluginScope) return true;
            return !pluginScope.contains(overlay) && !overlay.closest("[data-file-manager-scope]") && !overlay.closest("[data-file-manager-background]");
          });

          if (overlayVisibleOutsidePlugin || isSteamQuickAccessMenuOpenInDom() || isSteamMainMenuOpenInDom() || isQuickAccessVisible) {
            return;
          }

          if (isPressed) {
            if (backPressed.current) return;

            const activeElement = document.activeElement as HTMLElement | null;
            const pathInputElement = pathInputScopeRef.current?.querySelector<HTMLInputElement>("input");
            const isPathInputFocused = pathInputFocusedRef.current || (!!pathInputScopeRef.current && pathInputScopeRef.current.contains(activeElement));
            const isPathKeyboardOpen = pathInputKeyboardOpenRef.current && isPathInputFocused;

            const isAddGameInputFocused = addGameInputFocusedRef.current;
            const isAddGameKeyboardOpen = addGameInputKeyboardOpenRef.current && isAddGameInputFocused;

            const isRenameInputFocused = renameInputFocusedRef.current;
            const isRenameKeyboardOpen = renameInputKeyboardOpenRef.current && isRenameInputFocused;
            const isCreateFolderInputFocused = createFolderInputFocusedRef.current;
            const isCreateFolderKeyboardOpen = createFolderInputKeyboardOpenRef.current && isCreateFolderInputFocused;

            const hasOverlay = isAnyModalOrMenuOpen();
            const steamQuickAccessOpen = isSteamQuickAccessMenuOpenInDom() || isSteamMainMenuOpenInDom() || isQuickAccessVisible;
            const overlayOrKeyboardActive = hasModalStateOpen || hasOverlay || steamQuickAccessOpen || isPathKeyboardOpen || isAddGameKeyboardOpen || isRenameKeyboardOpen || isCreateFolderKeyboardOpen || Boolean(activeElement?.closest(getOverlaySelector()));
            const shouldConsumeBack = overlayOrKeyboardActive;

            backPressed.current = true;
            backHadOverlayOnPress.current = shouldConsumeBack;
            backConsumedOnPress.current = shouldConsumeBack;

            if (isPathInputFocused && !isPathKeyboardOpen && !hasOverlay && !Boolean(activeElement?.closest(getOverlaySelector()))) {
              pathInputSuppressFocusRef.current = true;
              isLongBack.current = false;
              if (backTimeout.current) {
                window.clearTimeout(backTimeout.current);
                backTimeout.current = null;
              }
              backPressed.current = true;
              backHadOverlayOnPress.current = false;
              backConsumedOnPress.current = true;
              if (shouldSuppressGoBack()) {
                return;
              }
              goBackRef.current();
              window.setTimeout(() => {
                pathInputSuppressFocusRef.current = false;
              }, 220);
              return;
            }

            if (shouldConsumeBack) {
              const closedByState = closeActiveModalOrContextMenu();
              if (closedByState) {
                return;
              }

              if (contextMenuInstance.current) {
                contextMenuInstance.current.Hide();
                contextMenuInstance.current = null;
              }

              const overlayElement = activeElement?.closest(getOverlaySelector()) as HTMLElement | null;
              if (overlayElement) {
                safeBlur(overlayElement);
              }

              if (isAddGameKeyboardOpen) {
                const addGameInputElement = addGameInputScopeRef.current?.querySelector<HTMLInputElement>("input");
                safeBlur(addGameInputElement);
                addGameInputKeyboardOpenRef.current = false;
                addGameInputFocusedRef.current = false;
                return;
              }

              if (isRenameKeyboardOpen) {
                const renameInputElement = renameModalRef.current?.querySelector<HTMLInputElement>("input");
                safeBlur(renameInputElement);
                renameInputKeyboardOpenRef.current = false;
                renameInputFocusedRef.current = false;
                return;
              }

              if (isCreateFolderKeyboardOpen) {
                const createFolderInputElement = createFolderInputScopeRef.current?.querySelector<HTMLInputElement>("input");
                safeBlur(createFolderInputElement);
                createFolderInputKeyboardOpenRef.current = false;
                createFolderInputFocusedRef.current = false;
                return;
              }

              if (isPathKeyboardOpen) {
                pathInputKeyboardOpenRef.current = false;
                pathInputFocusedRef.current = true;
                pathInputSuppressFocusRef.current = true;

                if (pathInputElement) {
                  safeBlur(pathInputElement);
                } else {
                  safeBlur(activeElement);
                }

                window.setTimeout(() => {
                  if (pathInputElement && document.activeElement !== pathInputElement) {
                    safeFocus(pathInputElement);
                  }
                  pathInputSuppressFocusRef.current = false;
                }, 80);
                return;
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
              if (shouldSuppressGoBack()) {
                return;
              }
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
      setTimeout(() => {
        const input = renameModalRef.current?.querySelector<HTMLInputElement>("input");
        input?.focus();
        input?.select();
      }, 50);
    }
  }, [renameRequested]);

  useEffect(() => {
    const input = (window as any).SteamClient?.Input;
    let unregisterKeyboardDismiss: any;

    if (input?.RegisterForUserDismissKeyboardMessages) {
      unregisterKeyboardDismiss = input.RegisterForUserDismissKeyboardMessages(() => {
        pathInputKeyboardOpenRef.current = false;
        renameInputKeyboardOpenRef.current = false;
        addGameInputKeyboardOpenRef.current = false;
        createFolderInputKeyboardOpenRef.current = false;
        createFolderInputFocusedRef.current = false;
      });
    }

    return () => {
      if (typeof unregisterKeyboardDismiss === "function") {
        unregisterKeyboardDismiss();
      } else if (unregisterKeyboardDismiss?.Unregister) {
        unregisterKeyboardDismiss.Unregister();
      }
    };
  }, []);

  useEffect(() => {
    if (propertiesRequested) {
      setTimeout(() => {
        const btn = propertiesCloseRef.current ?? propertiesModalRef.current?.querySelector<HTMLButtonElement>("button");
        safeFocus(btn);
      }, 50);
    }
  }, [propertiesRequested]);

  useEffect(() => {
    if (deleteRequested) {
      setTimeout(() => {
        const btn = deleteConfirmRef.current ?? deleteModalRef.current?.querySelector<HTMLButtonElement>("button");
        safeFocus(btn);
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
      const hasClipboardNow = Boolean(res.has);
      clipboardHasRef.current = hasClipboardNow;
      setClipboardHas(hasClipboardNow);
    } catch (e) {
      console.warn("refreshClipboard failed:", e);
      clipboardHasRef.current = false;
      setClipboardHas(false);
    }
  }, [hasClipboard]);

  const refreshFileManagerAfterOperation = useCallback(async (force = false, targetDir?: string) => {
    if (isOperationRunning.current && !force && !targetDir) {
      return;
    }

    const destinationDir = targetDir ? String(targetDir).trim() : "";
    const normalizedTargetDir = destinationDir && destinationDir.includes("/") ? destinationDir.replace(/\/+$/, "") : destinationDir;
    if (normalizedTargetDir) {
      const fallbackDir = normalizedTargetDir.endsWith("/") ? normalizedTargetDir : normalizedTargetDir;
      const safeTargetDir = fallbackDir.includes(".") && !fallbackDir.endsWith("/") && !fallbackDir.endsWith(".")
        ? fallbackDir.slice(0, Math.max(0, fallbackDir.lastIndexOf("/"))) || "/"
        : fallbackDir;

      if (isSplitView) {
        const leftTarget = getPanePath("left");
        const rightTarget = getPanePath("right");
        const matchesLeft = leftTarget === safeTargetDir || leftTarget.startsWith(`${safeTargetDir}/`);
        const matchesRight = rightTarget === safeTargetDir || rightTarget.startsWith(`${safeTargetDir}/`);

        const targetSide: "left" | "right" =
          matchesLeft ? "left" : matchesRight ? "right" : selectedPane === "left" ? "right" : "left";

        const paneRefreshes: Promise<void>[] = [];
        if (matchesLeft) {
          paneRefreshes.push(loadPanePath("left", leftTarget));
        }
        if (matchesRight) {
          paneRefreshes.push(loadPanePath("right", rightTarget));
        }
        if (paneRefreshes.length === 0) {
          paneRefreshes.push(loadPanePath(targetSide, safeTargetDir));
        }
        await Promise.all(paneRefreshes);
        return;
      }

      await loadPath(safeTargetDir, undefined, false);
      return;
    }

    if (isSplitView) {
      const leftTarget = getPanePath("left");
      const rightTarget = getPanePath("right");

      await Promise.all([
        loadPanePath("left", leftTarget),
        loadPanePath("right", rightTarget),
      ]);
      return;
    }

    await loadPath(getGlobalPath(), undefined, false);
  }, [getGlobalPath, getPanePath, isSplitView, loadPanePath, loadPath, selectedPane]);

  const isOperationRunning = useRef(false);

  const runOperation = useCallback(
    async (label: string, action: (operationId: string) => Promise<any>, options?: { onError?: (e: any) => void; showProgress?: boolean; showBackground?: boolean }) => {
      isOperationRunning.current = true;

      const operationId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const showProgress = options?.showProgress ?? true;
      const shouldUseProgressPolling = showProgress;
      operationCancelRequestedRef.current = false;
      setOperationCancelRequested(false);
      if (shouldUseProgressPolling) {
        activePollingOperationIdsRef.current.add(operationId);
        latestModalOperationIdRef.current = operationId;
      }

      let pollTimeout: number | null = null;
      let graceAttempts = shouldUseProgressPolling ? 5 : 0;
      const pollProgress = () => {
        if (!shouldUseProgressPolling) {
          return;
        }

        if (!activePollingOperationIdsRef.current.has(operationId)) {
          return;
        }

        pollTimeout = window.setTimeout(() => {
          void (async () => {
            if (!activePollingOperationIdsRef.current.has(operationId)) {
              return;
            }

            try {
              const status = await getOperationProgress(operationId);
              if (!activePollingOperationIdsRef.current.has(operationId)) {
                return;
              }
              const nextRawProgress = Number(status.progress ?? 0);
              const nextProgress = Math.max(0, Math.min(100, nextRawProgress));
              const nextLabel = typeof status.label === "string" && status.label.trim() ? stripTrailingEllipsis(status.label) : stripTrailingEllipsis(label);
              const nextDetail = typeof status.detail === "string" ? stripTrailingEllipsis(status.detail) : "";
              const normalizedBaseLabel = typeof nextLabel === "string" && nextLabel.includes(":")
                ? nextLabel.split(":", 1)[0].trim()
                : nextLabel;
              const nextDisplayLabel = nextDetail && !isGenericOperationText(nextDetail)
                ? `${normalizedBaseLabel || nextLabel}: ${nextDetail}`
                : normalizedBaseLabel || nextLabel;

              if (!status.active) {
                if (graceAttempts > 0) {
                  graceAttempts -= 1;
                  pollProgress();
                  return;
                }

                if (!activePollingOperationIdsRef.current.has(operationId)) {
                  return;
                }

                activePollingOperationIdsRef.current.delete(operationId);
                removeBackgroundOperation(operationId);
                return;
              }

              if (latestModalOperationIdRef.current === operationId) {
                setOperationModal((prev) => {
                  if (!prev) return prev;
                  if (prev.progress === nextProgress && prev.label === nextDisplayLabel && prev.paused === Boolean(status.paused)) return prev;
                  return { ...prev, progress: nextProgress, label: nextDisplayLabel, operationId, paused: Boolean(status.paused) };
                });
              }

              if (activePollingOperationIdsRef.current.has(operationId) && backgroundOperationsRef.current.some((op) => op.operationId === operationId)) {
                updateBackgroundOperation(operationId, (op) => ({
                  ...op,
                  label: nextDisplayLabel,
                  progress: nextProgress,
                  paused: Boolean(status.paused),
                }));
              }

              pollProgress();
            } catch (e) {
              console.warn("getOperationProgress failed", e);
              pollProgress();
            }
          })();
        }, 100);
      };

      if (shouldUseProgressPolling) {
        setOperationModal({ label: stripTrailingEllipsis(label), progress: 0, showBackground: options?.showBackground ?? false, operationId, paused: false });
        pollProgress();
      }

      try {
        const res = await action(operationId);

        if (showProgress && shouldUseProgressPolling && operationCancelRequestedRef.current) {
          setOperationModal(null);
          removeBackgroundOperation(operationId);
          activePollingOperationIdsRef.current.delete(operationId);
          await refreshClipboard();
          await refreshFileManagerAfterOperation(true);
          window.dispatchEvent(new CustomEvent("decky-manager-refresh-file-manager"));
          return null;
        }

        if (res && typeof res === "object" && "success" in res && res.success === false) {
          const err = (res as any).error ?? t("action.failed");
          throw new Error(err);
        }

        if (showProgress && shouldUseProgressPolling) {
          setOperationModal((prev) => prev ? { ...prev, progress: 100 } : prev);
          if (backgroundOperationsRef.current.some((op) => op.operationId === operationId)) {
            removeBackgroundOperation(operationId);
          }
          activePollingOperationIdsRef.current.delete(operationId);
        }

        await refreshClipboard();
        await refreshFileManagerAfterOperation(true);
        window.dispatchEvent(new CustomEvent("decky-manager-refresh-file-manager"));

        if (showProgress) {
          window.setTimeout(() => setOperationModal(null), 220);
        }
        return res;
      } catch (e: any) {
        if (showProgress && shouldUseProgressPolling) {
          setOperationModal(null);
          if (backgroundOperationsRef.current.some((op) => op.operationId === operationId)) {
            removeBackgroundOperation(operationId);
          }
          activePollingOperationIdsRef.current.delete(operationId);
        }
        await refreshClipboard();
        await refreshFileManagerAfterOperation(true);
        window.dispatchEvent(new CustomEvent("decky-manager-refresh-file-manager"));

        if (options?.onError) {
          options.onError(e);
        } else {
          setError(e?.message ?? t("action.failed"));
        }
        return null;
      } finally {
        if (pollTimeout !== null) {
          window.clearTimeout(pollTimeout);
        }
        operationCancelRequestedRef.current = false;
        setOperationCancelRequested(false);
        isOperationRunning.current = false;
      }
    },
    [operationCancelRequested, refreshClipboard, refreshFileManagerAfterOperation, getOperationProgress, dispatchBackgroundOperationStore],
  );

  const handlePaste = useCallback(async (targetDir: string, useExplicitTarget = false) => {
    const effectiveTargetDir = isSplitView && !useExplicitTarget ? getPanePath(selectedPane) : targetDir;

    try {
      const conflict = await checkPasteConflict(effectiveTargetDir);
      if (conflict.blocked) {
        setPermissionModal({ message: t("paste.blocked") });
        return;
      }

      if (conflict.needs_conflict) {
        setConflictModal({
          title: conflict.is_dir ? t("conflict.folder_exists") : t("conflict.file_exists"),
          message: t("conflict.message").replace("{name}", conflict.name),
          targetDir: effectiveTargetDir,
          itemName: conflict.name,
          isFolderConflict: Boolean(conflict.is_dir),
        });
        return;
      }

      const pasteLabel = `${t("action.pasting")}: ${conflict.name || t("common.item")}`;
      const moveLabel = `${t("action.moving")}: ${conflict.name || t("common.item")}`;

      await runOperation(pasteLabel, (operationId) => pastePathWithOptions(effectiveTargetDir, "keep-both", false, pasteLabel, moveLabel, operationId), {
        showBackground: true,
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
  }, [checkPasteConflict, getPanePath, isSplitView, runOperation, selectedPane]);

  const createFolderCallable = callable<[string, string, string], { success: boolean; path?: string }>("create_folder");

  const handleCreateFolder = useCallback(async (parentDir: string, name: string) => {
    if (!name) return setError(t("error.invalid_name"));
    const resolvedParentDir = isSplitView ? getPanePath(selectedPane) : parentDir;
    const createFolderLabel = `${t("action.creating_folder")}: ${name}`;
    await runOperation(createFolderLabel, (operationId) => createFolderCallable(resolvedParentDir, name, operationId), {
      showProgress: false,
      onError: (e) => {
          setError(e?.message ?? t("error.could_not_create_folder"));
      },
    });
    setCreateFolderRequested(false);
    setCreateFolderName("");
  }, [createFolderCallable, getPanePath, isSplitView, runOperation, selectedPane]);

  const handleConflictChoice = useCallback(async (strategy: string, applyToAll = false) => {
    if (!conflictModal) return;

    setConflictModal(null);
    const pasteLabel = `${t("action.pasting")}: ${conflictModal.itemName || t("common.item")}`;
    const moveLabel = `${t("action.moving")}: ${conflictModal.itemName || t("common.item")}`;
    await runOperation(pasteLabel, (operationId) => pastePathWithOptions(conflictModal.targetDir, strategy, applyToAll, pasteLabel, moveLabel, operationId), {
      showBackground: true,
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

  const openContextMenuForDropdown = useCallback(
    (label: string, options: Array<{ label: React.ReactNode; data: string }>, onSelect: (data: string) => void) => {
      clearContextMenu();

      const anchor = (typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null)
        ?? listContainerRef.current
        ?? (typeof document !== "undefined" ? document.body : undefined);

      contextMenuInstance.current = showContextMenu(
        <Menu label={label}>
          {options.map((option) => (
            <MenuItem
              key={String(option.data)}
              onClick={() => {
                clearContextMenu();
                onSelect(option.data);
              }}
              onSelected={() => {
                clearContextMenu();
                onSelect(option.data);
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>{option.label}</span>
            </MenuItem>
          ))}
        </Menu>,
        anchor as EventTarget | undefined,
      );
    },
    [clearContextMenu],
  );

  const openContextMenu = useCallback(
    async (item: FileEntry | null) => {
      if (isSelectionMode) {
        return;
      }

      if (isAnyModalOrMenuOpen()) {
        return;
      }

      clearContextMenu();

      let menuClipboardHas = clipboardHasRef.current;
      try {
        const res = await hasClipboard();
        menuClipboardHas = Boolean(res.has);
        clipboardHasRef.current = menuClipboardHas;
        setClipboardHas(menuClipboardHas);
      } catch (e) {
        console.warn("Clipboard refresh before context menu failed:", e);
        menuClipboardHas = false;
        clipboardHasRef.current = false;
        setClipboardHas(false);
      }

      const focusedItem = getCurrentFocusedItemRef.current();
      const effectiveItem = item ?? focusedItem;
      const panePathForEffectiveItem = (() => {
        if (effectiveItem && typeof document !== "undefined") {
          const activePaneSide = (document.activeElement as HTMLElement | null)?.closest("[data-pane-side]") as HTMLElement | null;
          const detectedPaneSide = activePaneSide?.getAttribute("data-pane-side") as "left" | "right" | null;
          if (detectedPaneSide === "left") return getPanePath("left");
          if (detectedPaneSide === "right") return getPanePath("right");
        }
        return getGlobalPath();
      })();

      const createMenuAction = (action: () => void) => {
        let invoked = false;
        return () => {
          if (invoked) return;
          invoked = true;
          try {
            action();
          } finally {
            window.setTimeout(() => {
              invoked = false;
            }, 150);
          }
        };
      };

      let parentEl: EventTarget | undefined;
      if (effectiveItem) {
        const activePaneSide = (typeof document !== "undefined" ? (document.activeElement as HTMLElement | null)?.closest("[data-pane-side]") : null) as HTMLElement | null;
        const detectedPaneSide = activePaneSide?.getAttribute("data-pane-side") as "left" | "right" | null;
        const panePrefixedKey = detectedPaneSide ? `${detectedPaneSide}:${effectiveItem.path}` : null;
        parentEl =
          (panePrefixedKey ? (itemRefs.current[panePrefixedKey] as EventTarget | undefined) : undefined)
          ?? (itemRefs.current[effectiveItem.path] as EventTarget | undefined)
          ?? (typeof document !== "undefined" ? document.activeElement as EventTarget : undefined);
      } else {
        parentEl = listContainerRef.current ?? (typeof document !== "undefined" ? document.activeElement as EventTarget : undefined);
      }

      if (isParentNavigationItem(effectiveItem, panePathForEffectiveItem)) {
        const paste = createMenuAction(() => {
          clearContextMenu();
          void handlePaste(getPanePathForSelection());
        });
        const createFolder = createMenuAction(() => setCreateFolderRequested(true));

        contextMenuInstance.current = showContextMenu(
          <Menu label={t("menu.options")}>
            {menuClipboardHas ? <MenuItem onClick={paste} onSelected={paste}>{t("menu.paste")}</MenuItem> : null}
            <MenuItem onClick={createFolder} onSelected={createFolder}>{t("menu.newFolder")}</MenuItem>
          </Menu>,
          parentEl,
        );
        return;
      }

      if (!effectiveItem) {
        const paste = createMenuAction(() => {
          clearContextMenu();
          void handlePaste(getPanePathForSelection());
        });
        const createFolder = createMenuAction(() => setCreateFolderRequested(true));

        contextMenuInstance.current = showContextMenu(
          <Menu label={t("menu.options")}>
            {menuClipboardHas ? <MenuItem onClick={paste} onSelected={paste}>{t("menu.paste")}</MenuItem> : null}
            <MenuItem onClick={createFolder} onSelected={createFolder}>{t("menu.newFolder")}</MenuItem>
          </Menu>,
          parentEl,
        );
        return;
      }

      const openInTextEditor = createMenuAction(async () => {
        clearContextMenu();
        try {
          const result = await readFileContent(effectiveItem.path);
          const content = result.success && result.content !== undefined ? result.content : "";
          sessionStorage.setItem("_decky_text_editor_selection_mode", "true");
          (window as any).__decky_manager_text_editor_path = effectiveItem.path;
          (window as any).__decky_manager_text_editor_content = content;
          localStorage.setItem("_text_editor_selected_file_path", effectiveItem.path);
          window.dispatchEvent(new CustomEvent("decky-manager-text-editor-file-selected", {
            detail: { path: effectiveItem.path, content },
          }));
          Router.CloseSideMenus?.();
          Router.Navigate?.("/decky-manager/text-editor");
        } catch (e: any) {
          setError(e?.message ?? t("error.could_not_open_file"));
        }
      });
      const copy = createMenuAction(async () => {
        clearContextMenu();
        try {
          await copyPath(effectiveItem.path);
          await refreshClipboard();
        } catch (e: any) {
          setError(e?.message ?? t("error.could_not_copy"));
        }
      });
      const copyToOtherPanel = createMenuAction(async () => {
        clearContextMenu();
        try {
          const otherSide = selectedPane === "left" ? "right" : "left";
          const sourceDir = selectedPane === "left" ? (leftPath || path || "/") : (rightPath || path || "/");
          const destinationDir = otherSide === "left" ? (leftPath || path || "/") : (rightPath || path || "/");

          if (sourceDir === destinationDir) {
            setSameDirectoryModal(t("error.same_directory"));
            return;
          }

          await copyPath(effectiveItem.path);
          await refreshClipboard();
          await handlePaste(destinationDir, true);
        } catch (e: any) {
          setError(e?.message ?? t("error.could_not_copy"));
        }
      });
      const cut = createMenuAction(async () => {
        clearContextMenu();
        try {
          await cutPath(effectiveItem.path);
          await refreshClipboard();
        } catch (e: any) {
          setError(e?.message ?? t("error.could_not_cut"));
        }
      });
      const moveToOtherPanel = createMenuAction(async () => {
        clearContextMenu();
        try {
          const otherSide = selectedPane === "left" ? "right" : "left";
          const sourceDir = selectedPane === "left" ? (leftPath || path || "/") : (rightPath || path || "/");
          const destinationDir = otherSide === "left" ? (leftPath || path || "/") : (rightPath || path || "/");

          if (sourceDir === destinationDir) {
            setSameDirectoryModal(t("error.same_directory"));
            return;
          }

          await cutPath(effectiveItem.path);
          await refreshClipboard();
          await handlePaste(destinationDir, true);
        } catch (e: any) {
          setError(e?.message ?? t("error.could_not_cut"));
        }
      });
      const extract = createMenuAction(async () => {
        clearContextMenu();
        try {
          const targetDir = getPanePathForSelection();
          const extractLabel = `${t("action.extracting")}: ${effectiveItem.name}`;
          await runOperation(extractLabel, (operationId) => extractArchive(effectiveItem.path, targetDir, extractLabel, operationId), {
            showBackground: true,
            onError: (e) => {
              const message = String(e?.message ?? t("error.could_not_extract"));
              if (message.toLowerCase().includes("permissão")) {
                setPermissionModal({ message: t("permission.denied") });
              } else {
                setError(message);
              }
            },
          });
        } catch (e: any) {
          setError(e?.message ?? t("error.could_not_extract"));
        }
      });
      const paste = createMenuAction(() => {
        clearContextMenu();
        void handlePaste(getPanePathForSelection());
      });
      const rename = createMenuAction(() => {
        clearContextMenu();
        setRenameTarget(effectiveItem.path);
        setRenameValue(effectiveItem.name);
        setRenameRequested(true);
      });
      const remove = createMenuAction(() => {
        clearContextMenu();
        setDeleteTarget(effectiveItem.path);
        setDeleteName(effectiveItem.name);
        setDeleteRequested(true);
      });
      const addToSteam = createMenuAction(() => {
        clearContextMenu();
        openAddGameModal(effectiveItem);
      });
      const properties = createMenuAction(() => {
        void (async () => {
          try {
            const props = await getProperties(effectiveItem.path);

            setPropertiesData(props);
            setPropertiesRequested(true);

            if (props.type === "folder") {
              setIsCalculatingFolderSize(true);
            } else {
              setIsCalculatingFolderSize(false);
            }

            if (props.type === "folder") {
              getDirectorySize(effectiveItem.path)
                .then((sizeResult) => {
                  if (sizeResult.size !== null) {
                    setPropertiesData((prev) =>
                      prev
                        ? {
                            ...prev,
                            size: sizeResult.size,
                          }
                        : prev,
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
      });
      const createFolder = createMenuAction(() => setCreateFolderRequested(true));

      contextMenuInstance.current = showContextMenu(
        <Menu label={`${t("menu.options")} : ${effectiveItem.name}`}>
          <MenuItem onClick={copy} onSelected={copy}>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}><CopyIcon />{t("menu.copy")}</span>
          </MenuItem>

          {menuClipboardHas ? (
            <MenuItem onClick={paste} onSelected={paste}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}><PasteIcon />{t("menu.paste")}</span>
            </MenuItem>
          ) : null}

          <MenuItem onClick={cut} onSelected={cut}>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}><CutIcon />{t("menu.cut")}</span>
          </MenuItem>

          {isArchiveFile(effectiveItem.name) ? (
            <MenuItem onClick={extract} onSelected={extract}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}><ExtractIcon />{t("menu.extract")}</span>
            </MenuItem>
          ) : null}

          {isSplitView ? (
            <>
              <MenuSeparator />
              <MenuItem onClick={copyToOtherPanel} onSelected={copyToOtherPanel}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}><CopyIcon />{selectedPane === "left" ? t("panel.copy_to_right") : t("panel.copy_to_left")}</span>
              </MenuItem>
              <MenuItem onClick={moveToOtherPanel} onSelected={moveToOtherPanel}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}><CutIcon />{selectedPane === "left" ? t("panel.move_to_right") : t("panel.move_to_left")}</span>
              </MenuItem>
            </>
          ) : null}

          <MenuSeparator />

          <MenuItem onClick={createFolder} onSelected={createFolder}>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}><NewFolderIcon />{t("menu.newFolder")}</span>
          </MenuItem>

          <MenuSeparator />

          {!effectiveItem.is_dir ? (
            <MenuItem onClick={openInTextEditor} onSelected={openInTextEditor}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}><DocumentIcon />{t("menu.openInTextEditor")}</span>
            </MenuItem>
          ) : null}

          {!effectiveItem.is_dir ? (
            <MenuItem onClick={addToSteam} onSelected={addToSteam}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}><SteamIcon />{t("menu.addToSteam")}</span>
            </MenuItem>
          ) : null}

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
    },
    [
      clipboardHas,
      clearContextMenu,
      hasClipboard,
      copyPath,
      cutPath,
      deletePath,
      getProperties,
      loadPath,
      leftPath,
      path,
      refreshClipboard,
      renamePath,
      rightPath,
      runOperation,
      handlePaste,
      isSelectionMode,
      isSplitView,
      selectedPane,
    ],
  );

  const getCurrentFocusedItem = useCallback(() => {
    if (typeof document === "undefined") return null;

    const active = document.activeElement as HTMLElement | null;
    const panePreference = (active?.closest('[data-pane-side]') as HTMLElement | null)?.getAttribute('data-pane-side') as "left" | "right" | null;
    const preferredPane = panePreference ?? selectedPane;
    const paneItems = isSplitView ? (preferredPane === "left" ? leftItems : rightItems) : items;

    if (active) {
      try {
        const closest = active.closest('[data-item-path]') as HTMLElement | null;
        if (closest) {
          const p = closest.getAttribute('data-item-path');
          if (p) {
            const found = paneItems.find((it) => it.path === p);
            if (found) return found;

            const fallback = items.find((it) => it.path === p) ?? leftItems.find((it) => it.path === p) ?? rightItems.find((it) => it.path === p);
            if (fallback) return fallback;
          }
        }
      } catch (e) {
      }
    }

    if (focusPath) {
      const focusedItem = paneItems.find((item) => item.path === focusPath)
        ?? items.find((item) => item.path === focusPath)
        ?? leftItems.find((item) => item.path === focusPath)
        ?? rightItems.find((item) => item.path === focusPath);
      if (focusedItem) {
        return focusedItem;
      }
    }

    return null;
  }, [focusPath, isSplitView, items, leftItems, rightItems, selectedPane]);

  useEffect(() => {
    openContextMenuRef.current = openContextMenu;
    getCurrentFocusedItemRef.current = getCurrentFocusedItem;
    goBackRef.current = goBack;
    exitPluginRef.current = exitPlugin;
  }, [openContextMenu, getCurrentFocusedItem, goBack, exitPlugin, clearContextMenu]);

  useEffect(() => {
    const refreshCurrentPath = (targetDir?: string) => {
      if (targetDir) {
        void refreshFileManagerAfterOperation(true, targetDir);
        return;
      }

      if (isOperationRunning.current) {
        return;
      }

      if (isSplitView) {
        const panePath = getPanePath(selectedPane);
        if (!panePath) return;
        void loadPanePath(selectedPane, panePath);
        return;
      }

      const currentPath = pathRef.current ?? path;
      if (!currentPath) return;
      void loadPathRef.current(currentPath, undefined, false, focusPath);
    };

    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const targetDir = typeof detail?.targetDir === "string" ? detail.targetDir : undefined;
      refreshCurrentPath(targetDir);
    };

    window.addEventListener("decky-manager-refresh-file-manager", handler as EventListener);
    return () => {
      window.removeEventListener("decky-manager-refresh-file-manager", handler as EventListener);
    };
  }, [focusPath, getPanePath, isSplitView, loadPanePath, path, refreshFileManagerAfterOperation, selectedPane]);

  const resolveSelectionTarget = useCallback(() => {
    const focusedItem = getCurrentFocusedItemRef.current();
    if (focusedItem) return focusedItem;

    const paneItems = isSplitView ? (selectedPane === "left" ? leftItems : rightItems) : items;

    if (focusPath) {
      const fallbackItem = paneItems.find((item) => item.path === focusPath)
        ?? items.find((item) => item.path === focusPath)
        ?? leftItems.find((item) => item.path === focusPath)
        ?? rightItems.find((item) => item.path === focusPath);
      if (fallbackItem) return fallbackItem;
    }

    if (typeof document !== "undefined") {
      const activeElement = document.activeElement as HTMLElement | null;
      const itemPath = activeElement?.closest<HTMLElement>("[data-item-path]")?.getAttribute("data-item-path");
      if (itemPath) {
        return paneItems.find((item) => item.path === itemPath)
          ?? items.find((item) => item.path === itemPath)
          ?? leftItems.find((item) => item.path === itemPath)
          ?? rightItems.find((item) => item.path === itemPath)
          ?? null;
      }
    }

    return null;
  }, [focusPath, isSplitView, items, leftItems, rightItems, selectedPane]);

  const handleSelectionAction = useCallback(async () => {
    if (!isSelectionMode) return;

    const item = resolveSelectionTarget();
    if (!item || item.is_dir) return;

    const isTextEditorSelection = fileSelectionModeRef.current === "text-editor"
      || new URLSearchParams(window.location.search).get("textEditorMode") === "true"
      || sessionStorage.getItem("_decky_text_editor_selection_mode") === "true";

    if (isTextEditorSelection) {
      const selectedPath = item.path;
      const finalizeSelection = (content: string) => {
        sessionStorage.setItem("_decky_text_editor_selection_mode", "true");
        (window as any).__decky_manager_text_editor_path = selectedPath;
        (window as any).__decky_manager_text_editor_content = content;
        localStorage.setItem("_text_editor_selected_file_path", selectedPath);
        window.dispatchEvent(new CustomEvent("decky-manager-text-editor-file-selected", {
          detail: { path: selectedPath, content },
        }));

        try {
          Router.CloseSideMenus?.();
          Navigation.NavigateBack?.();
        } catch {
        }
      };

      try {
        const result = await readFileContent(selectedPath);
        finalizeSelection(result.success && result.content !== undefined ? result.content : "");
      } catch (error) {
        console.error("Erro ao abrir arquivo no editor:", error);
        finalizeSelection("");
      }
      return;
    }

    if (fileSelectionModeRef.current === "file") {
      openAddGameModal(item);
      return;
    }

    try {
      await setFileSelection(item.path, resultFileRef.current);
      
      exitPlugin();
    } catch (e) {
      console.error("Erro ao salvar seleção:", e);
      setError(t("error.could_not_select_file"));
    }
  }, [exitPlugin, isSelectionMode, openAddGameModal, resolveSelectionTarget, setError]);

  const shouldSuppressGoBack = useCallback(() => {
    if (typeof document === "undefined") {
      return false;
    }

    return isSteamQuickAccessMenuOpenInDom() || isSteamMainMenuOpenInDom() || isQuickAccessVisible;
  }, [isAnyModalOrMenuOpen, isQuickAccessVisible]);

  const handleFooterTriangle = useCallback(() => {
    if (isSelectionMode) {
      return;
    }

    const activeElement = document.activeElement as HTMLElement | null;
    const textFieldActive = isTextInputElement(activeElement);
    if (textFieldActive || isAnyModalOrMenuOpen()) {
      return;
    }

    const item = getCurrentFocusedItemRef.current();
    openContextMenuRef.current(item);
  }, [isAnyModalOrMenuOpen, isSelectionMode]);

  const handleFooterCross = useCallback(() => {
    if (isSelectionMode) {
      void handleSelectionAction();
      return;
    }
    const item = getCurrentFocusedItemRef.current();
    if (item && item.is_dir) {
      void loadPath(item.path, undefined, true, item.path);
    }
  }, [handleSelectionAction, isSelectionMode, loadPath]);

  const handleFooterCircle = useCallback(() => {
    if (shouldSuppressGoBack()) {
      return;
    }

    const closedOverlay = closeActiveModalOrContextMenu();
    if (closedOverlay) {
      return;
    }
    goBack();
  }, [closeActiveModalOrContextMenu, goBack, shouldSuppressGoBack]);

  const handleFooterSquare = useCallback(() => {
    setIsSplitView((value) => !value);
  }, []);

  useLayoutEffect(() => {
    isPluginActive.current = true;
    return () => {
      isPluginActive.current = false;
    };
  }, []);

  const getFilteredItems = useCallback((sourceItems: FileEntry[], currentPath: string | null = path) => {
    let filtered = sourceItems;

    if (!showHidden) {
      filtered = filtered.filter((item) => !item.name.startsWith("."));
    }

    if (fileTypeFilter === "folders") {
      filtered = filtered.filter((item) => item.is_dir);
    } else if (fileTypeFilter === "files") {
      filtered = filtered.filter((item) => !item.is_dir);
    }

    const sortedItems = [...filtered].sort((a, b) => {
      const directoryPriority = Number(b.is_dir) - Number(a.is_dir);
      if (directoryPriority !== 0) {
        return directoryPriority;
      }

      const comparison = a.name.localeCompare(b.name);
      return sortOrder === "asc" ? comparison : -comparison;
    });

    const parentItem = getParentNavigationItemForPath(currentPath);
    if (parentItem) {
      return [parentItem, ...sortedItems];
    }

    return sortedItems;
  }, [fileTypeFilter, getParentNavigationItemForPath, path, showHidden, sortOrder]);

  const filteredItems = useMemo(() => getFilteredItems(items), [getFilteredItems, items]);

  const getPanePathForSelection = useCallback(() => getPanePath(selectedPane), [getPanePath, selectedPane]);

  const activePanePath = useMemo(() => getPanePathForSelection(), [getPanePathForSelection]);

  useEffect(() => {
    if (pathInputFocusedRef.current) {
      return;
    }

    setEditedPath(activePanePath);
  }, [activePanePath]);

  const renderPaneRows = useCallback((paneItems: FileEntry[], paneSide: "left" | "right", paneLoading: boolean, paneError: string | null) => {
    const panePath = paneSide === "left" ? (leftPath || path || "/") : (rightPath || path || "/");
    const paneFiltered = getFilteredItems(paneItems, panePath);

    if (paneLoading) return <PanelSectionRow>{t("action.loading")}</PanelSectionRow>;
    if (paneError) return <PanelSectionRow>{paneError}</PanelSectionRow>;
    if (!paneFiltered.length) return <PanelSectionRow>{t("error.directory_empty")}</PanelSectionRow>;

    return (
      <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_Y}>
        {paneFiltered.map((item) => (
          <div
            key={`${paneSide}-${item.path}`}
            data-item-path={item.path}
            data-pane-side={paneSide}
            ref={(el) => {
              itemRefs.current[`${paneSide}:${item.path}`] = el;
            }}
          >
            <PanelSectionRow>
              <Focusable
                onActivate={() => {
                  setSelectedPane(paneSide);
                  setEditedPath(item.path);
                  if (item.is_dir) {
                    void loadPanePath(paneSide, item.path);
                    return;
                  }

                  if (isSelectionMode) {
                    const isTextEditorSelection = fileSelectionModeRef.current === "text-editor"
                      || new URLSearchParams(window.location.search).get("textEditorMode") === "true"
                      || sessionStorage.getItem("_decky_text_editor_selection_mode") === "true";

                    if (isTextEditorSelection) {
                      void handleSelectionAction();
                      return;
                    }

                    if (fileSelectionModeRef.current === "file") {
                      openAddGameModal(item);
                      return;
                    }

                    void (async () => {
                      try {
                        await setFileSelection(item.path, resultFileRef.current);
                        exitPlugin();
                      } catch (e) {
                        console.error("Erro ao salvar seleção:", e);
                        setError(t("error.could_not_select_file") || "Erro ao selecionar arquivo");
                      }
                    })();
                  }
                }}
                onFocus={() => {
                  setSelectedPane(paneSide);
                  setFocusPath(item.path);
                }}
              >
                <ButtonItem
                  onClick={() => {
                    setSelectedPane(paneSide);
                    setEditedPath(item.path);
                    if (item.is_dir) {
                      void loadPanePath(paneSide, item.path);
                      return;
                    }

                    if (isSelectionMode) {
                      const isTextEditorSelection = fileSelectionModeRef.current === "text-editor"
                        || new URLSearchParams(window.location.search).get("textEditorMode") === "true"
                        || sessionStorage.getItem("_decky_text_editor_selection_mode") === "true";

                      if (isTextEditorSelection) {
                        void handleSelectionAction();
                        return;
                      }

                      if (fileSelectionModeRef.current === "file") {
                        openAddGameModal(item);
                        return;
                      }

                      void (async () => {
                        try {
                          await setFileSelection(item.path, resultFileRef.current);
                          exitPlugin();
                        } catch (e) {
                          console.error("Erro ao salvar seleção:", e);
                          setError(t("error.could_not_select_file") || "Erro ao selecionar arquivo");
                        }
                      })();
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
      </Focusable>
    );
  }, [exitPlugin, getFilteredItems, isSelectionMode, loadPanePath, openAddGameModal, readFileContent, setError, setFocusPath, t, handleSelectionAction]);

  const fileRows = useMemo(() => {
    if (loading) return <PanelSectionRow>{t("action.loading")}</PanelSectionRow>;
    if (error) return <PanelSectionRow>{error}</PanelSectionRow>;

    if (!filteredItems.length) {
      return <PanelSectionRow>{isSelectionMode && fileSelectionModeRef.current === "file" ? t("error.no_compatible_files") : t("error.directory_empty")}</PanelSectionRow>;
    }

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
                    return;
                  }

                  if (isSelectionMode) {
                    const isTextEditorSelection = fileSelectionModeRef.current === "text-editor"
                      || new URLSearchParams(window.location.search).get("textEditorMode") === "true"
                      || sessionStorage.getItem("_decky_text_editor_selection_mode") === "true";

                    if (isTextEditorSelection) {
                      void handleSelectionAction();
                      return;
                    }

                    if (fileSelectionModeRef.current === "file") {
                      openAddGameModal(item);
                      return;
                    }

                    void (async () => {
                      try {
                        await setFileSelection(item.path, resultFileRef.current);
                        exitPlugin();
                      } catch (e) {
                        console.error("Erro ao salvar seleção:", e);
                        setError(t("error.could_not_select_file") || "Erro ao selecionar arquivo");
                      }
                    })();
                  }
                }}
                onFocus={() => setFocusPath(item.path)}
              >
                <ButtonItem
                  onClick={() => {
                    if (item.is_dir) {
                      loadPath(item.path, undefined, true, item.path);
                      return;
                    }

                    if (isSelectionMode) {
                      const isTextEditorSelection = fileSelectionModeRef.current === "text-editor"
                        || new URLSearchParams(window.location.search).get("textEditorMode") === "true"
                        || sessionStorage.getItem("_decky_text_editor_selection_mode") === "true";

                      if (isTextEditorSelection) {
                        void handleSelectionAction();
                        return;
                      }

                      if (fileSelectionModeRef.current === "file") {
                        openAddGameModal(item);
                        return;
                      }

                      void (async () => {
                        try {
                          await setFileSelection(item.path, resultFileRef.current);
                          exitPlugin();
                        } catch (e) {
                          console.error("Erro ao salvar seleção:", e);
                          setError(t("error.could_not_select_file") || "Erro ao selecionar arquivo");
                        }
                      })();
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
  }, [loading, error, filteredItems, visibleItemCount, focusPath, loadPath, isSelectionMode, openAddGameModal]);

  const activeModalContent = useMemo(() => {
    const dismissModal = (closeFn: () => void) => {
      closeFn();
      lastOverlayRemovedAt.current = Date.now();
    };

    if (renameRequested) {
      return (
        <ModalRoot
          show={true}
          bDisableBackgroundDismiss={true}
          bHideMainWindowForPopouts={true}
          onCancel={() => dismissModal(() => {
            setRenameRequested(false);
            setRenameTarget(null);
            setRenameValue("");
          })}
        >
          <DialogBody>
            <ModalFocusScope>
              <Focusable
                navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
                onCancel={() => dismissModal(() => { setRenameRequested(false); setRenameTarget(null); setRenameValue(""); })}
                onCancelButton={() => dismissModal(() => { setRenameRequested(false); setRenameTarget(null); setRenameValue(""); })}
                style={{ outline: "none", display: "flex", flexDirection: "column", alignItems: "stretch" }}
              >
                <div style={{ textAlign: "center", padding: "6px 0 12px" }}>
                  <h1 style={{ margin: 0 }}>{t("modal.rename")}</h1>
                </div>

                <div ref={renameModalRef} style={{ padding: "6px 0" }}>
                  <TextField
                    value={renameValue}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRenameValue(e.currentTarget.value)}
                    onFocus={() => {
                      renameInputFocusedRef.current = true;
                      renameInputKeyboardOpenRef.current = true;
                    }}
                    onBlur={() => {
                      renameInputFocusedRef.current = false;
                      renameInputKeyboardOpenRef.current = false;
                    }}
                    bShowCopyAction={false}
                    autoFocus
                  />
                </div>

                <Focusable
                  navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
                  style={{ display: "flex", gap: 12, width: "100%", marginTop: 16 }}
                >
                  <DialogButton ref={renameSaveRef as any} onClick={async () => {
                    if (!renameTarget) return;
                    if (!renameValue) return setError(t("error.invalid_name"));
                    const renameLabel = `${t("action.renaming")}: ${renameValue || renameTarget || t("common.item")}`;
                    await runOperation(renameLabel, (operationId) => renamePath(renameTarget, renameValue, operationId), {
                      showProgress: false,
                      onError: (e) => {
                        setError(e?.message ?? t("error.could_not_rename"));
                      },
                    });
                    setRenameRequested(false);
                    setRenameTarget(null);
                    setRenameValue("");
                  }} style={{ flex: 1 }}>
                    {t("action.save")}
                  </DialogButton>
                  <DialogButton onClick={() => dismissModal(() => { setRenameRequested(false); setRenameTarget(null); setRenameValue(""); })} style={{ flex: 1 }}>
                    {t("action.cancel")}
                  </DialogButton>
                </Focusable>
              </Focusable>
            </ModalFocusScope>
          </DialogBody>
        </ModalRoot>
      );
    }

    if (createFolderRequested) {
      return (
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
                onCancel={() => dismissModal(() => { setCreateFolderRequested(false); setCreateFolderName(""); })}
                onCancelButton={() => dismissModal(() => { setCreateFolderRequested(false); setCreateFolderName(""); })}
                style={{ outline: "none", display: "flex", flexDirection: "column", alignItems: "stretch" }}
              >
                <div style={{ textAlign: "center", padding: "6px 0 12px" }}>
                  <h1 style={{ margin: 0 }}>{t("modal.new_folder")}</h1>
                </div>
                <div ref={createFolderRef} style={{ padding: "6px 0" }}>
                  <div ref={createFolderInputScopeRef}>
                    <TextField
                      value={createFolderName}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCreateFolderName(e.currentTarget.value)}
                      onFocus={() => {
                        createFolderInputFocusedRef.current = true;
                        createFolderInputKeyboardOpenRef.current = true;
                      }}
                      onBlur={() => {
                        createFolderInputFocusedRef.current = false;
                        createFolderInputKeyboardOpenRef.current = false;
                      }}
                      bShowCopyAction={false}
                      autoFocus
                    />
                  </div>
                </div>

                <Focusable
                  navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
                  style={{ display: "flex", gap: 12, width: "100%", marginTop: 16 }}
                >
                  <DialogButton ref={createFolderConfirmRef as any} onClick={async () => {
                    await handleCreateFolder(isSplitView ? getPanePath(selectedPane) : pathRef.current, createFolderName);
                  }} style={{ flex: 1 }}>
                    {t("action.create")}
                  </DialogButton>
                  <DialogButton onClick={() => dismissModal(() => { setCreateFolderRequested(false); setCreateFolderName(""); })} style={{ flex: 1 }}>
                    {t("action.cancel")}
                  </DialogButton>
                </Focusable>
              </Focusable>
            </ModalFocusScope>
          </DialogBody>
        </ModalRoot>
      );
    }

    if (deleteRequested && deleteTarget) {
      return (
        <ModalRoot
          show={true}
          bDisableBackgroundDismiss={true}
          bHideMainWindowForPopouts={true}
          onCancel={() => dismissModal(() => {
            setDeleteRequested(false);
            setDeleteTarget(null);
            setDeleteName(null);
          })}
        >
          <DialogBody>
            <ModalFocusScope>
              <Focusable
                navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
                onCancel={() => dismissModal(() => { setDeleteRequested(false); setDeleteTarget(null); setDeleteName(null); })}
                onCancelButton={() => dismissModal(() => { setDeleteRequested(false); setDeleteTarget(null); setDeleteName(null); })}
                style={{ outline: "none", display: "flex", flexDirection: "column", alignItems: "stretch" }}
              >
                <div style={{ textAlign: "center", padding: "6px 0 12px" }}>
                  <h1 style={{ margin: 0 }}>{t("modal.confirm_delete")}</h1>
                </div>
                <div ref={deleteModalRef} style={{ padding: "6px 0", textAlign: "center" }}>
                  <div>{t("modal.delete_question").replace("{name}", String(deleteName))}</div>
                </div>
                <Focusable
                  navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
                  style={{ display: "flex", gap: 12, width: "100%", marginTop: 16 }}
                >
                  <DialogButton ref={deleteConfirmRef as any} onClick={() => {
                    if (!deleteTarget) return;

                    const targetToDelete = deleteTarget;
                    setDeleteRequested(false);
                    setDeleteTarget(null);
                    setDeleteName(null);

                    const deleteLabel = `${t("action.deleting")}: ${deleteName || t("common.item")}`;
                    void runOperation(deleteLabel, (operationId) => deletePath(targetToDelete, deleteLabel, operationId), {
                      onError: (e) => {
                        const message = String(e?.message ?? t("error.could_not_delete"));
                        if (message.toLowerCase().includes("permissão")) {
                          setPermissionModal({ message: t("permission.denied") });
                        } else {
                          setError(message);
                        }
                      },
                    });
                  }} style={{ flex: 1 }}>
                    {t("action.yes")}
                  </DialogButton>
                  <DialogButton onClick={() => dismissModal(() => { setDeleteRequested(false); setDeleteTarget(null); setDeleteName(null); })} style={{ flex: 1 }}>
                    {t("action.no")}
                  </DialogButton>
                </Focusable>
              </Focusable>
            </ModalFocusScope>
          </DialogBody>
        </ModalRoot>
      );
    }

    if (conflictModal) {
      return (
        <ModalRoot
          show={true}
          bDisableBackgroundDismiss={true}
          bHideMainWindowForPopouts={true}
          onCancel={() => dismissModal(() => setConflictModal(null))}
        >
          <DialogBody>
            <ModalFocusScope>
              <Focusable
                navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
                onCancel={() => dismissModal(() => setConflictModal(null))}
                onCancelButton={() => dismissModal(() => setConflictModal(null))}
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
                      <DialogButton onClick={() => void handleConflictChoice("replace")}>{t("conflict.replace")}</DialogButton>
                      <DialogButton onClick={() => void handleConflictChoice("ignore")}>{t("conflict.ignore")}</DialogButton>
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
      );
    }

    if (permissionModal) {
      return (
        <ModalRoot
          show={true}
          bDisableBackgroundDismiss={true}
          bHideMainWindowForPopouts={true}
          onCancel={() => dismissModal(() => setPermissionModal(null))}
        >
          <DialogBody>
            <ModalFocusScope>
              <Focusable
                navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
                onCancel={() => dismissModal(() => setPermissionModal(null))}
                onCancelButton={() => dismissModal(() => setPermissionModal(null))}
                style={{ outline: "none", display: "flex", flexDirection: "column", alignItems: "stretch" }}
              >
                <div style={{ textAlign: "center", padding: "6px 0 12px" }}>
                  <h1 style={{ margin: 0 }}>{t("modal.permission_denied")}</h1>
                </div>
                <div style={{ padding: "6px 0", textAlign: "center" }}>
                  <div>{permissionModal.message}</div>
                </div>
                <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
                  <DialogButton ref={permissionPrimaryRef as any} onClick={() => dismissModal(() => setPermissionModal(null))}>{t("action.cancel")}</DialogButton>
                </div>
              </Focusable>
            </ModalFocusScope>
          </DialogBody>
        </ModalRoot>
      );
    }

    if (sameDirectoryModal) {
      return (
        <ModalRoot
          show={true}
          bDisableBackgroundDismiss={true}
          bHideMainWindowForPopouts={true}
          onCancel={() => dismissModal(() => setSameDirectoryModal(null))}
        >
          <DialogBody>
            <ModalFocusScope>
              <Focusable
                navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
                onCancel={() => dismissModal(() => setSameDirectoryModal(null))}
                onCancelButton={() => dismissModal(() => setSameDirectoryModal(null))}
                style={{ outline: "none", display: "flex", flexDirection: "column", alignItems: "stretch" }}
              >
                <div style={{ textAlign: "center", padding: "6px 0 12px" }}>
                  <h1 style={{ margin: 0 }}>{t("modal.warning")}</h1>
                </div>
                <div style={{ padding: "6px 0", textAlign: "center" }}>
                  <div>{sameDirectoryModal}</div>
                </div>
                <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
                  <DialogButton ref={permissionPrimaryRef as any} onClick={() => dismissModal(() => setSameDirectoryModal(null))}>{t("action.cancel")}</DialogButton>
                </div>
              </Focusable>
            </ModalFocusScope>
          </DialogBody>
        </ModalRoot>
      );
    }

    if (operationModal) {
      return (
        <ModalRoot
          show={true}
          bDisableBackgroundDismiss={true}
          bHideMainWindowForPopouts={true}
          onCancel={() => dismissModal(() => {
            void requestOperationCancel();
          })}
        >
          <DialogBody>
            <ModalFocusScope>
              <div style={{ minWidth: 280, padding: "8px 0" }}>
                <div style={{ textAlign: "center", marginBottom: 8 }}>
                  <strong>{operationModal.label}</strong>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
                  <div style={{ height: 12, borderRadius: 999, background: "#2b2b2b", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, operationModal.progress))}%`, background: "#4e8ad9", transition: "width 0.2s linear" }} />
                  </div>
                  <div style={{ textAlign: "left", fontSize: 12 }}>{Math.max(0, Math.min(100, Math.floor(operationModal.progress)))}%</div>
                  <Focusable style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
                    {operationModal.showBackground ? (
                      <DialogButton
                        style={{ flex: 1, minWidth: 0 }}
                        onClick={() => dismissModal(() => {
                          if (operationModal?.operationId) {
                            addBackgroundOperation({
                              label: operationModal.label,
                              progress: operationModal.progress,
                              operationId: operationModal.operationId,
                              paused: false,
                            });
                          }
                          setOperationModal(null);
                        })}
                      >
                        {t("action.continue_in_background")}
                      </DialogButton>
                    ) : null}
                    <DialogButton
                      style={{ flex: 1, minWidth: 0 }}
                      onClick={() => dismissModal(() => {
                        void requestOperationCancel();
                      })}
                    >
                      {t("action.cancel")}
                    </DialogButton>
                  </Focusable>
                </div>
              </div>
            </ModalFocusScope>
          </DialogBody>
        </ModalRoot>
      );
    }

    if (propertiesRequested && propertiesData) {
      return (
        <ModalRoot
          show={true}
          bHideMainWindowForPopouts={true}
          onCancel={() => dismissModal(() => {
            setPropertiesRequested(false);
            setPropertiesData(null);
            setIsCalculatingFolderSize(false);
          })}
        >
          <DialogBody>
            <ModalFocusScope>
              <div style={{ textAlign: "center", paddingBottom: 8 }}>
                <h1 style={{ margin: 0 }}>{t("menu.properties")}</h1>
              </div>
              <Focusable
                onCancel={() => dismissModal(() => {setPropertiesRequested(false);setPropertiesData(null);setIsCalculatingFolderSize(false);})}
                onCancelButton={() => dismissModal(() => {setPropertiesRequested(false);setPropertiesData(null);setIsCalculatingFolderSize(false);})}
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
                      : t("state.not_available")}</div>
                  <div><strong>{t("properties.created")}</strong> {formatLocaleDate(propertiesData.created)}</div>
                  <div><strong>{t("properties.modified")}</strong> {formatLocaleDate(propertiesData.modified)}</div>
                  <div><strong>{t("properties.permissions")}</strong> {formatPropertyPermissions(propertiesData.permissions)}</div>
                </div>
                <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 12 }}>
                  <DialogButton ref={propertiesCloseRef as any} onClick={() => dismissModal(() => { setPropertiesRequested(false); setPropertiesData(null); setIsCalculatingFolderSize(false); })}>
                    {t("action.close")}
                  </DialogButton>
                </div>
              </Focusable>
            </ModalFocusScope>
          </DialogBody>
        </ModalRoot>
      );
    }

    if (addGameRequested && addGamePath) {
      return <FileSelector isOpen={addGameRequested} path={addGamePath} name={addGameName} error={addGameError} onChangeName={setAddGameName} onCancel={resetAddGameModal} onConfirm={handleAddGame} confirmRef={addGameConfirmRef} inputScopeRef={addGameInputScopeRef} inputFocusedRef={addGameInputFocusedRef} inputKeyboardOpenRef={addGameInputKeyboardOpenRef} />;
    }

    return null;
  }, [
    addGameError,
    addGameInputFocusedRef,
    addGameInputKeyboardOpenRef,
    addGameInputScopeRef,
    addGameName,
    addGamePath,
    addGameRequested,
    conflictModal,
    createFolderName,
    createFolderRequested,
    deleteName,
    deleteRequested,
    deleteTarget,
    handleAddGame,
    handleConflictChoice,
    isCalculatingFolderSize,
    operationModal,
    permissionModal,
    propertiesData,
    propertiesRequested,
    renameRequested,
    renameTarget,
    renameValue,
    resetAddGameModal,
    pathRef,
    setError,
    t,
    createFolderRef,
    createFolderConfirmRef,
    deleteConfirmRef,
    deleteModalRef,
    propertiesCloseRef,
    propertiesModalRef,
    renameModalRef,
    renameSaveRef,
    permissionPrimaryRef,
    conflictPrimaryRef,
    addGameConfirmRef,
    runOperation,
    deletePath,
    handleCreateFolder,
    setCreateFolderRequested,
    setCreateFolderName,
    setDeleteRequested,
    setDeleteTarget,
    setDeleteName,
    setRenameRequested,
    setRenameTarget,
    setRenameValue,
    setPermissionModal,
    setConflictModal,
    setOperationCancelRequested,
    setPropertiesRequested,
    setPropertiesData,
    setIsCalculatingFolderSize,
    setAddGameRequested,
    setAddGamePath,
    setAddGameName,
    setAddGameError,
  ]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (!activeModalContent) {
        clearContextMenu();
        modalShowResultRef.current?.Close();
        modalShowResultRef.current = null;
        lastOverlayRemovedAt.current = Date.now();
        return;
      }

      const existing = modalShowResultRef.current;
      if (existing) {
        if (typeof existing.Update === "function") {
          existing.Update(activeModalContent);
        } else {
          existing.Close();
          modalShowResultRef.current = showModal(activeModalContent);
        }
        return;
      }

      modalShowResultRef.current = showModal(activeModalContent);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeModalContent, clearContextMenu]);

  useEffect(() => {
    return () => {
      clearContextMenu();
      modalShowResultRef.current?.Close();
      modalShowResultRef.current = null;
    };
  }, [clearContextMenu]);

  const showOptionsAction = !(isSelectionMode && fileSelectionModeRef.current === "file");

  const forceFullWidthControl = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;

    const root = node.firstElementChild as HTMLElement | null;
    if (!root) return;

    const applyTo = (element: HTMLElement | null) => {
      if (!element) return;
      element.style.width = "100%";
      element.style.maxWidth = "100%";
      element.style.minWidth = "0";
      element.style.flex = "1";
      element.style.boxSizing = "border-box";
    };

    applyTo(root);
    const nested = root.querySelector<HTMLElement>("[role='button'], button, input, div, span");
    applyTo(nested);
  }, []);

  return (
    <>
      <div
        ref={backgroundFileManagerRef}
        data-file-manager-background
        style={{
          minHeight: "100vh",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <Focusable
          style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
          navEntryPreferPosition={NavEntryPositionPreferences.FIRST}
          onCancel={handleCancel}
          onCancelButton={handleCancel}
          onCancelActionDescription={t("action.back")}
          onOKActionDescription={t("action.select")}
          onOptionsActionDescription={showOptionsAction ? t("action.options") : undefined}
        >
          <div ref={fileManagerScopeRef} data-file-manager-scope style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: `56px ${FILE_MANAGER_HORIZONTAL_INSET}px 60px`, boxSizing: "border-box" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div ref={pathInputScopeRef} data-path-input style={{ width: "calc(100% - 30px)", boxSizing: "border-box", margin: "0 15px", padding: 0 }}>
                <TextField
                  tabIndex={-1}
                  onFocus={() => {
                    if (pathInputSuppressFocusRef.current) {
                      const input = pathInputScopeRef.current?.querySelector<HTMLInputElement>("input");
                      safeBlur(input);
                      focusFirstListItem();
                      return;
                    }
                    pathInputFocusedRef.current = true;
                    pathInputKeyboardOpenRef.current = true;
                    pathInputSuppressFocusRef.current = false;
                    pathInputLastFocusRef.current = Date.now();
                    if (pathInputBlurTimerRef.current !== null) {
                      window.clearTimeout(pathInputBlurTimerRef.current);
                      pathInputBlurTimerRef.current = null;
                    }
                  }}
                  onClick={() => {
                    if (pathInputSuppressFocusRef.current) {
                      const input = pathInputScopeRef.current?.querySelector<HTMLInputElement>("input");
                      safeBlur(input);
                      focusFirstListItem();
                      return;
                    }
                    pathInputFocusedRef.current = true;
                    pathInputKeyboardOpenRef.current = true;
                    pathInputSuppressFocusRef.current = false;
                  }}
                  onBlur={() => {
                    if (pathInputBlurTimerRef.current !== null) {
                      window.clearTimeout(pathInputBlurTimerRef.current);
                    }
                    pathInputFocusedRef.current = false;
                    pathInputKeyboardOpenRef.current = false;
                    pathInputBlurTimerRef.current = window.setTimeout(() => {
                      pathInputBlurTimerRef.current = null;
                    }, 350);
                  }}
                  value={editedPath}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditedPath(e.currentTarget.value)}
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (isSplitView) {
                        void loadPanePath(selectedPane, editedPath);
                        return;
                      }
                      void loadPath(editedPath);
                    }
                  }}
                  bShowCopyAction={false}
                  tooltip={t("tooltip.currentPath")}
                />
              </div>

              <div style={{ ...FILE_MANAGER_OUTER_STYLE, padding: "8px 0", minWidth: 0, paddingLeft: FILE_MANAGER_HORIZONTAL_INSET, paddingRight: FILE_MANAGER_HORIZONTAL_INSET }}>
                <Focusable
                  navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
                  style={{ display: "flex", gap: "12px", width: "100%", maxWidth: "100%", boxSizing: "border-box", margin: 0 }}
                >
                  <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X} style={{ flex: "1 1 0", minWidth: 0, display: "flex" }}>
                    <div ref={forceFullWidthControl} style={{ width: "100%", maxWidth: "100%", minWidth: 0, display: "flex" }}>
                      <ToggleField
                        label={t("label.hidden")}
                        checked={showHidden}
                        onChange={(v: boolean) => setShowHidden(v)}
                      />
                    </div>
                  </Focusable>
                  {!isSelectionMode && (
                    <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X} style={{ flex: "1 1 0", minWidth: 0, display: "flex" }}>
                      <div ref={forceFullWidthControl} style={{ width: "100%", maxWidth: "100%", minWidth: 0, display: "flex" }}>
                        <ToggleField
                          label={t("toggle.split")}
                          checked={isSplitView}
                          onChange={(v: boolean) => setIsSplitView(v)}
                        />
                      </div>
                    </Focusable>
                  )}
                  <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X} style={{ flex: "1 1 0", minWidth: 0, display: "flex" }}>
                    <div ref={forceFullWidthControl} style={{ width: "100%", maxWidth: "100%", minWidth: 0, display: "flex" }}>
                      <DropdownItem
                        label={t("label.order")}
                        rgOptions={[
                          { label: t("option.az"), data: "asc" },
                          { label: t("option.za"), data: "desc" },
                        ]}
                        selectedOption={sortOrder}
                        onChange={(option) => setSortOrder(option.data as "asc" | "desc")}
                        onMenuWillOpen={() => {
                          openContextMenuForDropdown(
                            t("label.order"),
                            [
                              { label: t("option.az"), data: "asc" },
                              { label: t("option.za"), data: "desc" },
                            ],
                            (data) => setSortOrder(data as "asc" | "desc"),
                          );
                        }}
                      />
                    </div>
                  </Focusable>
                  <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X} style={{ flex: "1 1 0", minWidth: 0, display: "flex" }}>
                    <div ref={forceFullWidthControl} style={{ width: "100%", maxWidth: "100%", minWidth: 0, display: "flex" }}>
                      <DropdownItem
                        label={t("label.type")}
                        rgOptions={[
                          { label: t("option.all"), data: "all" },
                          { label: t("option.folders"), data: "folders" },
                          { label: t("option.files"), data: "files" },
                        ]}
                        selectedOption={fileTypeFilter}
                        onChange={(option) => setFileTypeFilter(option.data as string)}
                        onMenuWillOpen={() => {
                          openContextMenuForDropdown(
                            t("label.type"),
                            [
                              { label: t("option.all"), data: "all" },
                              { label: t("option.folders"), data: "folders" },
                              { label: t("option.files"), data: "files" },
                            ],
                            (data) => setFileTypeFilter(data as string),
                          );
                        }}
                      />
                    </div>
                  </Focusable>
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
                style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingBottom: 60, boxSizing: "border-box" }}
              >
                <DrivesBar onSelectPath={async (p) => {
                  const resolvedTargetPath = p.startsWith("/dev/") ? await (async () => {
                    try {
                      const result = await mountDrive(p);
                      if (result.ok && result.path) {
                        return result.path;
                      }
                      setError(result.error || t("error.could_not_mount_drive") || "Não foi possível montar o dispositivo");
                      return result.path || p;
                    } catch (e: any) {
                      setError(e?.message || t("error.could_not_mount_drive") || "Não foi possível montar o dispositivo");
                      return p;
                    }
                  })() : p;

                  if (isSplitView) {
                    setSelectedPane((current) => {
                      const targetPane = current;
                      const nextPath = resolvedTargetPath;
                      if (targetPane === "left") {
                        setLeftPath(nextPath);
                      } else {
                        setRightPath(nextPath);
                      }
                      setEditedPath(nextPath);
                      pathRef.current = nextPath;
                      void loadPanePath(targetPane, nextPath);
                      return targetPane;
                    });
                    return;
                  }

                  setPath(resolvedTargetPath);
                  pathRef.current = resolvedTargetPath;
                  setEditedPath(resolvedTargetPath);
                  void loadPath(resolvedTargetPath);
                }} />
                {isSplitView ? (
                  <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X} style={{ display: "flex", gap: 12, minWidth: 0 }}>
                    {[
                      {
                        side: "left" as const,
                        pathValue: leftPath || path || "/",
                        items: leftItems,
                        loading: leftLoading,
                        error: leftError,
                        label: "L1",
                      },
                      {
                        side: "right" as const,
                        pathValue: rightPath || path || "/",
                        items: rightItems,
                        loading: rightLoading,
                        error: rightError,
                        label: "R1",
                      },
                    ].map((pane) => (
                      <Focusable
                        key={pane.side}
                        navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_Y}
                        style={{ flex: 1, minWidth: 0 }}
                        onFocus={() => {
                          setSelectedPane(pane.side);
                          setEditedPath(pane.pathValue);
                        }}
                      >
                        <div data-pane-side={pane.side} style={{ flex: 1, minWidth: 0, marginTop: 10 }}>
                          <PanelSection title={pane.pathValue.toUpperCase()}>
                            {renderPaneRows(pane.items, pane.side, pane.loading, pane.error)}
                          </PanelSection>
                        </div>
                      </Focusable>
                    ))}
                  </Focusable>
                ) : (
                  <div style={{ marginTop: 10 }}>
                    <PanelSection title={t("panel.files")}>
                      {fileRows}
                    </PanelSection>
                  </div>
                )}
                <div style={{ height: 50, flexShrink: 0 }} />
              </div>
            </div>
          </div>
        </Focusable>
      </div>

      <div
        style={{
          position: "sticky",
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
          background: "transparent",
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
            display: isSelectionMode ? "none" : "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: isSelectionMode ? "default" : "pointer",
            pointerEvents: isSelectionMode ? "none" : "auto",
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
          onClick={handleFooterSquare}
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

export default FileManagerPage;
