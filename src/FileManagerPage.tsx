import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Focusable, Navigation, NavEntryPositionPreferences, PanelSection, Router } from "@decky/ui";
import { useQuickAccessVisible } from "@decky/api";
import { DialogState } from "./dialogs";
import { t } from "./i18n";
import DrivesBar from "./DrivesBar";
import FileList from "./components/FileList";
import FooterButtons from "./components/FooterButtons";
import PathBar, { usePathBarControl } from "./components/PathBar";
import Toolbar from "./components/Toolbar";
import { useAddShortcut } from "./hooks/useAddShortcut";
import { useClipboardActions } from "./hooks/useClipboardActions";
import { useContextMenu } from "./hooks/useContextMenu";
import { useDialogContent } from "./hooks/useDialogContent";
import { useDriveActions } from "./hooks/useDriveActions";
import { useDrives } from "./hooks/useDrives";
import { useGamepadButtons } from "./hooks/useGamepadButtons";
import { useInputGuards } from "./hooks/useInputGuards";
import { useItemActions } from "./hooks/useItemActions";
import { readLaunchParams, useLaunchParams, useSelectionAction } from "./hooks/useLaunchParams";
import { useModalHost } from "./hooks/useModalHost";
import { useOperationRunner } from "./hooks/useOperationRunner";
import { useOverlayState } from "./hooks/useOverlayState";
import { PaneSide, usePanes } from "./hooks/usePanes";
import { subscribeFileManagerRefresh } from "./utils/backgroundStore";
import PickBar from "./components/PickBar";
import { PickSession } from "./fileDialog/pickerSession";
import { ListEntry, SortOrder, TypeFilter, buildListEntries } from "./utils/filterItems";
import { isTextInputElement, safeFocus } from "./utils/focus";

const HORIZONTAL_INSET = 12;
const FOCUSABLE = "button:not([disabled]), [role='button']:not([disabled]), [tabindex]:not([tabindex='-1']):not([disabled])";

function FileManagerPage({ pick }: { pick?: PickSession } = {}) {
  const urlLaunch = useLaunchParams();
  const launch = useMemo(
    () => (pick ? { selectionKind: "pick" as const, resultFile: null, startPath: pick.startPath } : urlLaunch),
    [pick, urlLaunch],
  );
  const panesApi = usePanes();
  const { panes, isSplit, activeSide, loadPane, getPath, refreshVisible, goUp, setSelectedSide, setSplit, consumeFocusRequest } = panesApi;
  const isQuickAccessVisible = useQuickAccessVisible();
  const isSelectionMode = launch.selectionKind !== null;
  const isPickerNow = useCallback(() => isSelectionMode || readLaunchParams().selectionKind !== null, [isSelectionMode]);

  const [dialog, setDialog] = useState<DialogState>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [editedPath, setEditedPath] = useState("");

  const backgroundRef = useRef<HTMLDivElement | null>(null);
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const lastFocusRef = useRef<{ side: PaneSide; path: string } | null>(null);
  const focusedDriveRef = useRef<string | null>(null);
  const afterOperationRef = useRef<() => Promise<void>>(async () => undefined);

  const { guardsRef, bind, isKeyboardOpen, consumeKeyboardBack } = useInputGuards();
  const runner = useOperationRunner(useCallback(() => afterOperationRef.current(), []));
  const { operationModal, runOperation } = runner;
  const hasDialog = dialog !== null || operationModal !== null;
  const overlay = useOverlayState(hasDialog);
  const overlayContextMenuRef = overlay.contextMenuRef;

  const closeDialog = useCallback(() => {
    setDialog(null);
    overlay.markOverlayRemoved();
  }, [overlay]);

  const exitPlugin = useCallback(() => {
    if (pick) {
      pick.cancel();
      return;
    }
    Router.CloseSideMenus();
    Navigation.NavigateBack?.();
  }, [pick]);

  const clipboard = useClipboardActions({ runOperation, setDialog });
  const itemActions = useItemActions({ runOperation, setDialog });
  const shortcut = useAddShortcut({ setDialog, onAdded: exitPlugin });
  const selectItem = useSelectionAction({ params: launch, openAddShortcut: shortcut.openAddShortcut, exitPlugin, pick });

  afterOperationRef.current = async () => {
    await Promise.all([clipboard.refreshClipboard(), refreshVisible()]);
  };

  useEffect(() => {
    void loadPane("left", launch.startPath).then((loaded) => {
      if (!loaded && pick) void loadPane("left", "~");
    });
  }, [launch.startPath, loadPane, pick]);

  const [showAllFiles, setShowAllFiles] = useState(false);

  useEffect(() => subscribeFileManagerRefresh((targetDir) => {
    void refreshVisible(targetDir);
    void clipboard.refreshClipboard();
  }), [clipboard.refreshClipboard, refreshVisible]);

  const activePath = panes[activeSide].path;
  useEffect(() => {
    if (!guardsRef.current.path.focused) setEditedPath(activePath);
  }, [activePath, guardsRef]);

  useEffect(() => {
    if (!dialog) {
      for (const name of ["rename", "createFolder", "addShortcut", "drive"] as const) {
        guardsRef.current[name] = { focused: false, keyboardOpen: false };
      }
    }
  }, [dialog, guardsRef]);

  useEffect(() => {
    const background = backgroundRef.current;
    if (!background) return;
    if (hasDialog) {
      background.setAttribute("inert", "");
      background.setAttribute("aria-hidden", "true");
    } else {
      background.removeAttribute("inert");
      background.removeAttribute("aria-hidden");
    }
  }, [hasDialog]);

  const namePatterns = pick && !showAllFiles ? pick.patterns : null;
  const listOptions = useMemo(() => ({ showHidden, typeFilter, sortOrder, namePatterns }), [showHidden, typeFilter, sortOrder, namePatterns]);
  const leftEntries = useMemo(() => buildListEntries(panes.left.items, panes.left.path, listOptions), [panes.left.items, panes.left.path, listOptions]);
  const rightEntries = useMemo(() => buildListEntries(panes.right.items, panes.right.path, listOptions), [panes.right.items, panes.right.path, listOptions]);
  const entries = useMemo(() => ({ left: leftEntries, right: rightEntries }), [leftEntries, rightEntries]);

  const getFocusedItem = useCallback((): { item: ListEntry | null; side: PaneSide | null } => {
    const wrapper = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-item-path]");
    const path = wrapper?.getAttribute("data-item-path") ?? lastFocusRef.current?.path;
    const side = (wrapper?.getAttribute("data-pane-side") as PaneSide | null) ?? lastFocusRef.current?.side ?? null;
    if (!path) return { item: null, side };
    const item = entries[side ?? activeSide].find((entry) => entry.path === path) ?? null;
    return { item, side };
  }, [activeSide, entries]);

  const focusActiveList = useCallback(() => {
    const wrapper = listContainerRef.current?.querySelector(`[data-pane-side="${activeSide}"]`);
    const target = wrapper?.querySelector<HTMLElement>(FOCUSABLE);
    if (target) safeFocus(target);
  }, [activeSide]);

  const pathBar = usePathBarControl(focusActiveList);
  const { suppressFor: suppressPathFocus } = pathBar;
  useEffect(() => {
    suppressPathFocus(150);
  }, [suppressPathFocus]);

  const hasDialogRef = useRef(false);
  hasDialogRef.current = hasDialog;
  const shouldAutoFocus = useCallback(
    () => !hasDialogRef.current && !overlayContextMenuRef.current && !guardsRef.current.path.focused && !isTextInputElement(document.activeElement as HTMLElement | null),
    [guardsRef],
  );

  const handleOpen = useCallback((item: ListEntry, side: PaneSide) => {
    if (isSplit) setSelectedSide(side);
    if (item.is_dir) {
      if (item.isParent) goUp(side);
      else void loadPane(side, item.path);
      return;
    }
    if (isSelectionMode) void selectItem(item);
  }, [goUp, isSelectionMode, isSplit, loadPane, selectItem, setSelectedSide]);

  const handleFocusItem = useCallback((item: ListEntry, side: PaneSide) => {
    focusedDriveRef.current = null;
    lastFocusRef.current = { side, path: item.path };
    if (isSplit) setSelectedSide(side);
  }, [isSplit, setSelectedSide]);

  const { drives, refresh: refreshDrives } = useDrives();
  const openDrivePath = useCallback((path: string) => void loadPane(activeSide, path), [activeSide, loadPane]);
  const leaveUnmounted = useCallback((mountPath: string) => {
    for (const side of ["left", "right"] as const) {
      const current = getPath(side);
      if (current === mountPath || current.startsWith(`${mountPath}/`)) void loadPane(side, "~");
    }
  }, [getPath, loadPane]);
  const driveActions = useDriveActions({ drives, setDialog, overlay, refreshDrives, openPath: openDrivePath, onUnmounted: leaveUnmounted });

  const openContextMenu = useContextMenu({
    overlay,
    isSelectionMode: isPickerNow,
    isSplit,
    activeSide,
    setSelectedSide,
    getPath,
    getFocusedItem,
    clipboard,
    itemActions,
    addToSteam: shortcut.openAddShortcut,
    getFallbackAnchor: () => listContainerRef.current,
  });

  const goBack = useCallback(() => {
    goUp(activeSide);
  }, [activeSide, goUp]);

  const closeTopOverlay = useCallback((): boolean => {
    if (overlay.contextMenuRef.current) {
      overlay.clearContextMenu();
      return true;
    }
    if (operationModal) {
      void runner.requestCancel();
    } else if (dialog) {
      setDialog(null);
    } else {
      return false;
    }
    overlay.markOverlayRemoved();
    return true;
  }, [dialog, operationModal, overlay, runner]);

  const openMenuForFocused = useCallback(() => {
    if (isPickerNow() || isTextInputElement(document.activeElement as HTMLElement | null) || overlay.isAnyOverlayOpen()) return;
    const drivePath = focusedDriveRef.current;
    if (drivePath) {
      driveActions.openDriveMenu(drivePath);
      return;
    }
    void openContextMenu(getFocusedItem().item);
  }, [driveActions, getFocusedItem, isPickerNow, openContextMenu, overlay]);

  useGamepadButtons({
    isQuickAccessVisible,
    hasDialog,
    isAnyOverlayOpen: overlay.isAnyOverlayOpen,
    isKeyboardOpen,
    consumeKeyboardBack,
    lastOverlayRemovedAt: () => overlay.lastRemovedAtRef.current,
    closeTopOverlay,
    openContextMenu: openMenuForFocused,
    goBack,
    exitPlugin,
    getScope: () => scopeRef.current ?? backgroundRef.current,
    getPathInput: pathBar.getInput,
    suppressPathFocus: () => suppressPathFocus(220),
  });

  const handleFooterBack = useCallback(() => {
    if (!closeTopOverlay()) goBack();
  }, [closeTopOverlay, goBack]);

  const handleFooterSelect = useCallback(() => {
    const { item } = getFocusedItem();
    if (!item) return;
    handleOpen(item, activeSide);
  }, [activeSide, getFocusedItem, handleOpen]);

  const dialogContent = useDialogContent({
    dialog,
    operationModal,
    setDialog,
    closeDialog,
    bind,
    clipboard,
    itemActions,
    shortcut,
    runner,
    drives: driveActions,
  });
  useModalHost(dialogContent);
  useEffect(() => () => overlay.clearContextMenu(), [overlay.clearContextMenu]);

  const renderList = (side: PaneSide) => (
    <FileList
      side={side}
      path={panes[side].path}
      items={entries[side]}
      loading={panes[side].loading}
      error={panes[side].error}
      isActive={side === activeSide}
      emptyText={t("error.directory_empty")}
      consumeFocusRequest={consumeFocusRequest}
      shouldAutoFocus={shouldAutoFocus}
      onOpen={handleOpen}
      onFocusItem={handleFocusItem}
    />
  );

  return (
    <>
      <div
        ref={backgroundRef}
        data-file-manager-background
        style={{ minHeight: "100vh", height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}
      >
        <Focusable
          style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
          navEntryPreferPosition={NavEntryPositionPreferences.FIRST}
          onCancel={() => undefined}
          onCancelButton={() => undefined}
          onCancelActionDescription={t("action.back")}
          onOKActionDescription={t("action.select")}
          onOptionsActionDescription={isSelectionMode ? undefined : t("action.options")}
        >
          <div ref={scopeRef} data-file-manager-scope style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: `56px ${HORIZONTAL_INSET}px 60px`, boxSizing: "border-box" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
              {pick ? <PickBar session={pick} currentPath={activePath} /> : null}
              <PathBar
                value={editedPath}
                control={pathBar}
                focusHandlers={bind("path")}
                onChange={setEditedPath}
                onSubmit={(value) => void loadPane(activeSide, value)}
              />
              <Toolbar
                overlay={overlay}
                showHidden={showHidden}
                onShowHidden={setShowHidden}
                isSplit={isSplit}
                canSplit={!isSelectionMode}
                onSplit={setSplit}
                sortOrder={sortOrder}
                onSortOrder={setSortOrder}
                typeFilter={typeFilter}
                onTypeFilter={setTypeFilter}
                filterToggle={pick?.canShowAll && pick.patterns ? { label: t("picker.all_files"), checked: showAllFiles, onChange: setShowAllFiles } : undefined}
              />
              <div ref={listContainerRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingBottom: 60, boxSizing: "border-box" }}>
                <DrivesBar drives={drives} onActivate={driveActions.activate} onFocusChange={(path) => { focusedDriveRef.current = path; }} />
                {isSplit ? (
                  <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X} style={{ display: "flex", gap: 12, minWidth: 0 }}>
                    {(["left", "right"] as const).map((side) => (
                      <Focusable key={side} navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_Y} style={{ flex: 1, minWidth: 0 }} onFocus={() => setSelectedSide(side)}>
                        <div style={{ flex: 1, minWidth: 0, marginTop: 10 }}>
                          <PanelSection title={(panes[side].path || "/").toUpperCase()}>{renderList(side)}</PanelSection>
                        </div>
                      </Focusable>
                    ))}
                  </Focusable>
                ) : (
                  <div style={{ marginTop: 10 }}>
                    <PanelSection title={t("panel.files")}>{renderList("left")}</PanelSection>
                  </div>
                )}
                <div style={{ height: 50, flexShrink: 0 }} />
              </div>
            </div>
          </div>
        </Focusable>
      </div>

      <FooterButtons
        showOptions={!isSelectionMode}
        onBack={handleFooterBack}
        onOptions={openMenuForFocused}
        onSplit={() => !isSelectionMode && setSplit(!isSplit)}
        onSelect={handleFooterSelect}
      />
    </>
  );
}

export default FileManagerPage;
