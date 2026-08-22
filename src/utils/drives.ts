import { callable } from "@decky/api";
import { t } from "../i18n";

export type DriveInfo = {
  name: string;
  path: string;
  kind: string;
  device?: string | null;
  total?: number | null;
  free?: number | null;
  mounted?: boolean;
};

export function getDriveDisplayName(drive: Pick<DriveInfo, "name" | "path">): string {
  const normalizedPath = (drive.path || "").trim();
  const normalizedName = (drive.name || "").trim();

  if (normalizedPath === "/home/deck" || normalizedName.toLowerCase() === "deck") {
    return t("drive.home");
  }

  if (normalizedPath === "/" || normalizedName === "/") {
    return t("drive.system");
  }

  return drive.name || t("drive.default");
}

const listDrivesCallable = callable<[], { drives: DriveInfo[] } | null>("list_drives");

export async function listDrives(): Promise<DriveInfo[]> {
  try {
    const res = await listDrivesCallable();
    if (!res || !Array.isArray((res as any).drives)) return [];
    return (res as any).drives as DriveInfo[];
  } catch (e) {
    return [];
  }
}
