import { Focusable, NavEntryPositionPreferences } from "@decky/ui";
import DriveChip from "./DriveChip";
import { DriveInfo } from "./utils/drives";

type Props = {
  drives: DriveInfo[];
  onActivate: (drive: DriveInfo) => void;
  onFocusChange: (drivePath: string | null) => void;
};

export default function DrivesBar({ drives, onActivate, onFocusChange }: Props) {
  return (
    <div style={{ width: "calc(100% - 6px)", paddingLeft: 12, paddingRight: 12, boxSizing: "border-box", margin: "0 3px" }}>
      <Focusable
        navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
        style={{ display: "flex", gap: 10, overflowX: "auto", padding: "4px 0", margin: 0, width: "100%", boxSizing: "border-box", minHeight: 70 }}
      >
        {drives.map((drive) => (
          <DriveChip key={drive.device ?? drive.path} drive={drive} onActivate={onActivate} onFocusChange={onFocusChange} />
        ))}
      </Focusable>
    </div>
  );
}
