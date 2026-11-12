import { useCallback } from "react";
import { showContextMenu } from "@decky/ui";
import { BackgroundMenu, ItemMenu, ItemMenuActions } from "../components/ContextMenus";
import { isArchiveFile } from "../utils/file";
import { ListEntry } from "../utils/filterItems";
import { PaneSide } from "./usePanes";
import { OverlayState } from "./useOverlayState";
import { useClipboardActions } from "./useClipboardActions";
import { useItemActions } from "./useItemActions";

type FocusedItem = { item: ListEntry | null; side: PaneSide | null };

type Params = {
  overlay: OverlayState;
  isSelectionMode: () => boolean;
  isSplit: boolean;
  activeSide: PaneSide;
  setSelectedSide: (side: PaneSide) => void;
  getPath: (side: PaneSide) => string;
  getFocusedItem: () => FocusedItem;
  clipboard: ReturnType<typeof useClipboardActions>;
  itemActions: ReturnType<typeof useItemActions>;
  addToSteam: (item: ListEntry) => void;
  getFallbackAnchor: () => HTMLElement | null;
};

const once = (action: () => void | Promise<void>) => {
  let invoked = false;
  return () => {
    if (invoked) return;
    invoked = true;
    void action();
    window.setTimeout(() => {
      invoked = false;
    }, 150);
  };
};

export function useContextMenu({ overlay, isSelectionMode, isSplit, activeSide, setSelectedSide, getPath, getFocusedItem, clipboard, itemActions, addToSteam, getFallbackAnchor }: Params) {
  const { clearContextMenu, contextMenuRef, isAnyOverlayOpen } = overlay;

  return useCallback(async (requested: ListEntry | null = null) => {
    if (isSelectionMode() || isAnyOverlayOpen()) return;
    clearContextMenu();

    const clipboardHas = await clipboard.refreshClipboard();
    const focused = getFocusedItem();
    const entry = requested ?? focused.item;
    const side = focused.side ?? activeSide;
    const target = entry && !entry.isParent ? entry : null;
    const dir = getPath(side);
    if (isSplit) setSelectedSide(side);

    const anchor = (target && document.querySelector<HTMLElement>(`[data-item-path="${CSS.escape(target.path)}"][data-pane-side="${side}"]`))
      || (document.activeElement as HTMLElement | null)
      || getFallbackAnchor()
      || undefined;

    const close = (action: () => void | Promise<void>) => once(() => {
      clearContextMenu();
      return action();
    });

    const background = {
      paste: close(() => clipboard.paste(dir)),
      newFolder: close(() => itemActions.openCreateFolder(dir)),
    };

    if (!target) {
      contextMenuRef.current = showContextMenu(<BackgroundMenu clipboardHas={clipboardHas} actions={background} />, anchor);
      return;
    }

    const otherSide: PaneSide = side === "left" ? "right" : "left";
    const actions: ItemMenuActions = {
      ...background,
      copy: close(() => clipboard.copy(target)),
      cut: close(() => clipboard.cut(target)),
      extract: close(() => itemActions.extract(target, dir)),
      copyToOther: close(() => clipboard.transferToOtherPane(target, "copy", dir, getPath(otherSide))),
      moveToOther: close(() => clipboard.transferToOtherPane(target, "cut", dir, getPath(otherSide))),
      openInEditor: close(() => itemActions.openInTextEditor(target)),
      addToSteam: close(() => addToSteam(target)),
      rename: close(() => itemActions.openRename(target)),
      remove: close(() => itemActions.openDelete(target)),
      properties: close(() => itemActions.showProperties(target)),
    };

    contextMenuRef.current = showContextMenu(
      <ItemMenu
        itemName={target.name}
        isDir={target.is_dir}
        isArchive={isArchiveFile(target.name)}
        clipboardHas={clipboardHas}
        isSplit={isSplit}
        side={side}
        actions={actions}
      />,
      anchor,
    );
  }, [activeSide, addToSteam, clearContextMenu, clipboard, contextMenuRef, getFallbackAnchor, getFocusedItem, getPath, isAnyOverlayOpen, isSelectionMode, isSplit, itemActions, setSelectedSide]);
}
