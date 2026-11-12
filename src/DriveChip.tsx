import { ReactNode } from "react";
import { DialogButton, Focusable, NavEntryPositionPreferences } from "@decky/ui";
import { t } from "./i18n";
import { HardDriveIcon, HomeFolderIcon, SdCardIcon, UsbDriveIcon } from "./Icons";
import { DriveInfo, getDriveDisplayName } from "./utils/drives";
import { formatBytes } from "./utils/file";

const iconFor = (drive: DriveInfo): ReactNode => {
  if (drive.kind === "home") return <HomeFolderIcon />;
  if (drive.kind === "usb") return <UsbDriveIcon />;
  if (drive.kind === "sdcard") return <SdCardIcon />;
  return <HardDriveIcon />;
};

const usedFraction = (drive: DriveInfo): number => {
  if (!drive.mounted || !drive.total || drive.free == null) return 0;
  return Math.max(0, Math.min(1, (drive.total - drive.free) / drive.total));
};

const statusText = (drive: DriveInfo): string => {
  if (!drive.mounted) return drive.encrypted ? t("drive.encrypted") : t("drive.not_mounted");
  if (drive.read_only) return t("drive.read_only");
  return drive.free != null ? t("drive.free_space").replace("{value}", formatBytes(drive.free)) : t("drive.free_space_available");
};

export default function DriveChip({ drive, onActivate, onFocusChange }: {
  drive: DriveInfo;
  onActivate: (drive: DriveInfo) => void;
  onFocusChange: (drivePath: string | null) => void;
}) {
  const fraction = usedFraction(drive);
  const mounted = drive.mounted !== false;
  const readOnly = mounted && Boolean(drive.read_only);
  const barColor = readOnly ? "rgba(150,160,175,0.85)" : fraction > 0.9 ? "#d9534f" : "#4e8ad9";

  return (
    <div data-drive-path={drive.path} data-drive-system={drive.system ? "1" : "0"} style={{ flex: "0 0 auto" }}>
      <Focusable
        navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
        style={{ display: "flex" }}
        onFocus={() => onFocusChange(drive.path)}
        onBlur={() => onFocusChange(null)}
      >
        <DialogButton
          focusable
          onClick={() => onActivate(drive)}
          style={{
            width: 260,
            minWidth: 260,
            height: 62,
            padding: "8px 22px 8px 16px",
            borderRadius: 999,
            display: "flex",
            alignItems: "center",
            gap: 12,
            textAlign: "left",
            boxSizing: "border-box",
            margin: 0,
            opacity: mounted ? 1 : 0.75,
          }}
        >
          {iconFor(drive)}
          <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {getDriveDisplayName(drive)}
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.85, lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {statusText(drive)}
            </span>
            <div style={{ height: 5, borderRadius: 3, background: "rgba(120,130,145,0.4)", overflow: "hidden" }}>
              <div style={{ width: `${(readOnly ? 1 : fraction) * 100}%`, height: "100%", background: barColor, opacity: mounted ? 1 : 0 }} />
            </div>
          </div>
        </DialogButton>
      </Focusable>
    </div>
  );
}
