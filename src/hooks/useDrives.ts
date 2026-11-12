import { useCallback, useEffect, useRef, useState } from "react";
import { DriveInfo, listDrives } from "../utils/drives";

const REFRESH_INTERVAL_MS = 3000;

const signature = (drives: DriveInfo[]) =>
  drives.map((drive) => `${drive.path}|${drive.name}|${drive.mounted ? 1 : 0}|${drive.free ?? ""}|${drive.device ?? ""}`).join(";");

export function useDrives() {
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const lastSignature = useRef("");
  const loading = useRef(false);
  const active = useRef(true);

  const refresh = useCallback(async () => {
    if (loading.current || document.hidden) return;
    loading.current = true;
    try {
      const next = await listDrives();
      const nextSignature = signature(next);
      if (active.current && nextSignature !== lastSignature.current) {
        lastSignature.current = nextSignature;
        setDrives(next);
      }
    } finally {
      loading.current = false;
    }
  }, []);

  useEffect(() => {
    active.current = true;
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => {
      active.current = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  return { drives, refresh };
}
