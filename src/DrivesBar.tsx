import { useEffect, useRef, useState } from "react";
import { Focusable, NavEntryPositionPreferences } from "@decky/ui";
import DriveChip from "./DriveChip";
import { listDrives, DriveInfo, getDriveDisplayName } from "./utils/drives";

type Props = {
  onSelectPath?: (path: string) => void;
};

function getDriveSignature(drives: DriveInfo[]) {
  return drives
    .map((drive) => `${drive.path}|${drive.name}|${drive.mounted ? 1 : 0}`)
    .join(";");
}

export default function DrivesBar({ onSelectPath }: Props) {
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const lastSignatureRef = useRef<string>("");

  useEffect(() => {
    let active = true;

    const loadDrives = async () => {
      try {
        const nextDrives = (await listDrives()) || [];
        if (!active) return;

        const nextSignature = getDriveSignature(nextDrives);
        if (lastSignatureRef.current !== nextSignature) {
          lastSignatureRef.current = nextSignature;
          setDrives(nextDrives);
        }
      } catch {
        if (!active) return;

        const emptySignature = getDriveSignature([]);
        if (lastSignatureRef.current !== emptySignature) {
          lastSignatureRef.current = emptySignature;
          setDrives([]);
        }
      }
    };

    void loadDrives();
    const interval = window.setInterval(() => {
      void loadDrives();
    }, 1500);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <div style={{ width: "calc(100% - 6px)", paddingLeft: 12, paddingRight: 12, boxSizing: "border-box", margin: "0 3px" }}>
      <Focusable
        navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
        style={{ display: "flex", gap: 4, overflowX: "auto", padding: 0, margin: 0, width: "100%", boxSizing: "border-box" }}
      >
        {drives && drives.length > 0 ? (
          drives.map((drv) => (
            <DriveChip
              key={drv.path}
              name={getDriveDisplayName(drv)}
              path={drv.path}
              free={drv.free ?? null}
              mounted={drv.mounted ?? true}
              onSelect={onSelectPath}
            />
          ))
        ) : (
          <div style={{ minHeight: 52, display: "flex", alignItems: "center", padding: "8px 12px", opacity: 0.7 }}>
            {"" /* placeholder vazio para manter a sessão visível */}
          </div>
        )}
      </Focusable>
    </div>
  );
}
