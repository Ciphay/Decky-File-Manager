import { ButtonItem, Focusable, PanelSectionRow } from "@decky/ui";
import { ArchiveIcon, DocumentIcon, FolderIcon } from "../Icons";
import { isArchiveFile } from "../utils/file";
import { ListEntry } from "../utils/filterItems";
import { PaneSide } from "../hooks/usePanes";

const ROW_STYLE = { width: "100%", display: "flex", justifyContent: "flex-start", textAlign: "left", alignItems: "center", gap: 10 } as const;

export default function FileRow({ item, side, onOpen, onFocusItem }: {
  item: ListEntry;
  side: PaneSide;
  onOpen: (item: ListEntry, side: PaneSide) => void;
  onFocusItem: (item: ListEntry, side: PaneSide) => void;
}) {
  const icon = item.is_dir ? <FolderIcon /> : isArchiveFile(item.name) ? <ArchiveIcon /> : <DocumentIcon />;

  return (
    <div data-item-path={item.path} data-pane-side={side}>
      <PanelSectionRow>
        <Focusable onFocus={() => onFocusItem(item, side)}>
          <ButtonItem onClick={() => onOpen(item, side)} layout="below">
            <div style={ROW_STYLE}>
              {icon}
              <span style={{ color: "currentColor", opacity: 0.95 }}>{item.name}</span>
            </div>
          </ButtonItem>
        </Focusable>
      </PanelSectionRow>
    </div>
  );
}
