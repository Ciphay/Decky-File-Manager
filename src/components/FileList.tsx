import { useCallback, useEffect, useRef, useState } from "react";
import { ButtonItem, Focusable, NavEntryPositionPreferences, PanelSectionRow } from "@decky/ui";
import { t, tf } from "../i18n";
import { ListEntry } from "../utils/filterItems";
import { safeFocus } from "../utils/focus";
import { PaneSide } from "../hooks/usePanes";
import FileRow from "./FileRow";

const PAGE_SIZE = 150;
const FOCUSABLE = "button:not([disabled]), [role='button']:not([disabled]), [tabindex]:not([tabindex='-1']):not([disabled])";

type Props = {
  side: PaneSide;
  path: string;
  items: ListEntry[];
  loading: boolean;
  error: string | null;
  isActive: boolean;
  emptyText: string;
  consumeFocusRequest: (side: PaneSide) => string | null;
  shouldAutoFocus: () => boolean;
  onOpen: (item: ListEntry, side: PaneSide) => void;
  onFocusItem: (item: ListEntry, side: PaneSide) => void;
};

export default function FileList({ side, path, items, loading, error, isActive, emptyText, consumeFocusRequest, shouldAutoFocus, onOpen, onFocusItem }: Props) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const focusedPathRef = useRef<string | null>(null);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [path]);

  const focusWrapper = useCallback((wrapper: Element | null | undefined) => {
    const target = wrapper?.querySelector<HTMLElement>(FOCUSABLE) ?? (wrapper as HTMLElement | null | undefined);
    if (target && document.activeElement !== target) safeFocus(target);
  }, []);

  useEffect(() => {
    if (loading || !isActive || items.length === 0 || !shouldAutoFocus()) return;

    const pathChanged = focusedPathRef.current !== path;
    const focusPath = consumeFocusRequest(side);
    const lostFocus = document.activeElement === document.body || !document.activeElement;
    if (!pathChanged && !focusPath && !lostFocus) return;
    focusedPathRef.current = path;

    const index = focusPath ? items.findIndex((item) => item.path === focusPath) : -1;
    if (index >= visibleCount) {
      setVisibleCount(index + PAGE_SIZE);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      const wanted = focusPath ? container.querySelector(`[data-item-path="${CSS.escape(focusPath)}"]`) : null;
      focusWrapper(wanted ?? container.querySelector("[data-item-path]"));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [consumeFocusRequest, focusWrapper, isActive, items, loading, path, shouldAutoFocus, side, visibleCount]);

  const handleFocusItem = useCallback((item: ListEntry, itemSide: PaneSide) => {
    const index = items.indexOf(item);
    if (index >= 0 && index >= visibleCount - 5) {
      setVisibleCount((count) => count + PAGE_SIZE);
    }
    onFocusItem(item, itemSide);
  }, [items, onFocusItem, visibleCount]);

  if (loading && items.length === 0) return <PanelSectionRow>{t("action.loading")}</PanelSectionRow>;
  if (items.length === 0) return <PanelSectionRow>{error ?? emptyText}</PanelSectionRow>;

  const visible = items.slice(0, visibleCount);
  const remaining = items.length - visible.length;

  return (
    <div ref={containerRef}>
      {error ? <PanelSectionRow><span style={{ color: "#f55" }}>{error}</span></PanelSectionRow> : null}
      <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_Y}>
        {visible.map((item) => (
          <FileRow key={`${side}:${item.path}`} item={item} side={side} onOpen={onOpen} onFocusItem={handleFocusItem} />
        ))}
        {remaining > 0 ? (
          <PanelSectionRow>
            <ButtonItem onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
              {tf("action.show_more", { count: remaining })}
            </ButtonItem>
          </PanelSectionRow>
        ) : null}
      </Focusable>
    </div>
  );
}
