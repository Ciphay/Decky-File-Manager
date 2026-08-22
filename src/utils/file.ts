export function isArchiveFile(name: string): boolean {
  const lower = name.toLowerCase();
  const archiveExtensions = [
    ".zip",
    ".tar",
    ".tar.gz",
    ".tgz",
    ".tar.bz2",
    ".tar.xz",
    ".tar.zst",
    ".rar",
    ".7z",
    ".gz",
    ".bz2",
    ".xz",
    ".zst",
    ".iso",
  ];
  return archiveExtensions.some((ext) => lower.endsWith(ext));
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(value < 10 && i > 0 ? 2 : 0)} ${sizes[i]}`;
}
