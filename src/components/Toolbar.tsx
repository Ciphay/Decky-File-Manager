import { ReactNode, useCallback } from "react";
import { DropdownItem, Focusable, Menu, MenuItem, NavEntryPositionPreferences, ToggleField, showContextMenu } from "@decky/ui";
import { t } from "../i18n";
import { SortOrder, TypeFilter } from "../utils/filterItems";
import { OverlayState } from "../hooks/useOverlayState";

type Option = { label: string; data: string };

const forceFullWidth = (node: HTMLDivElement | null) => {
  const root = node?.firstElementChild as HTMLElement | null;
  if (!root) return;
  const apply = (element: HTMLElement | null) => {
    if (!element) return;
    Object.assign(element.style, { width: "100%", maxWidth: "100%", minWidth: "0", flex: "1", boxSizing: "border-box" });
  };
  apply(root);
  apply(root.querySelector<HTMLElement>("[role='button'], button, input, div, span"));
};

const Cell = ({ children }: { children: ReactNode }) => (
  <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X} style={{ flex: "1 1 0", minWidth: 0, display: "flex" }}>
    <div ref={forceFullWidth} style={{ width: "100%", maxWidth: "100%", minWidth: 0, display: "flex" }}>{children}</div>
  </Focusable>
);

type Props = {
  overlay: OverlayState;
  showHidden: boolean;
  onShowHidden: (value: boolean) => void;
  isSplit: boolean;
  canSplit: boolean;
  onSplit: (value: boolean) => void;
  sortOrder: SortOrder;
  onSortOrder: (value: SortOrder) => void;
  typeFilter: TypeFilter;
  onTypeFilter: (value: TypeFilter) => void;
  filterToggle?: { label: string; checked: boolean; onChange: (value: boolean) => void };
};

export default function Toolbar({ overlay, showHidden, onShowHidden, isSplit, canSplit, onSplit, sortOrder, onSortOrder, typeFilter, onTypeFilter, filterToggle }: Props) {
  const { clearContextMenu, contextMenuRef } = overlay;

  const openMenu = useCallback((label: string, options: Option[], onSelect: (data: string) => void) => {
    clearContextMenu();
    const choose = (data: string) => () => {
      clearContextMenu();
      onSelect(data);
    };
    contextMenuRef.current = showContextMenu(
      <Menu label={label}>
        {options.map((option) => (
          <MenuItem key={option.data} onClick={choose(option.data)} onSelected={choose(option.data)}>{option.label}</MenuItem>
        ))}
      </Menu>,
      (document.activeElement as HTMLElement | null) ?? undefined,
    );
  }, [clearContextMenu, contextMenuRef]);

  const orderOptions: Option[] = [{ label: t("option.az"), data: "asc" }, { label: t("option.za"), data: "desc" }];
  const typeOptions: Option[] = [
    { label: t("option.all"), data: "all" },
    { label: t("option.folders"), data: "folders" },
    { label: t("option.files"), data: "files" },
  ];

  return (
    <div style={{ width: "calc(100% - 6px)", margin: "0 3px", boxSizing: "border-box", padding: "8px 12px", minWidth: 0 }}>
      <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X} style={{ display: "flex", gap: 12, width: "100%", boxSizing: "border-box" }}>
        <Cell>
          <ToggleField label={t("label.hidden")} checked={showHidden} onChange={onShowHidden} />
        </Cell>
        {canSplit ? (
          <Cell>
            <ToggleField label={t("toggle.split")} checked={isSplit} onChange={onSplit} />
          </Cell>
        ) : null}
        {filterToggle ? (
          <Cell>
            <ToggleField label={filterToggle.label} checked={filterToggle.checked} onChange={filterToggle.onChange} />
          </Cell>
        ) : null}
        <Cell>
          <DropdownItem
            label={t("label.order")}
            rgOptions={orderOptions}
            selectedOption={sortOrder}
            onChange={(option) => onSortOrder(option.data as SortOrder)}
            onMenuWillOpen={() => openMenu(t("label.order"), orderOptions, (data) => onSortOrder(data as SortOrder))}
          />
        </Cell>
        <Cell>
          <DropdownItem
            label={t("label.type")}
            rgOptions={typeOptions}
            selectedOption={typeFilter}
            onChange={(option) => onTypeFilter(option.data as TypeFilter)}
            onMenuWillOpen={() => openMenu(t("label.type"), typeOptions, (data) => onTypeFilter(data as TypeFilter))}
          />
        </Cell>
      </Focusable>
    </div>
  );
}
