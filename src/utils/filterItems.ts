import { FileEntry } from "../api";
import { t } from "../i18n";
import { getParentDirectory } from "./paths";

export type ListEntry = FileEntry & { isParent?: boolean };
export type SortOrder = "asc" | "desc";
export type TypeFilter = "all" | "folders" | "files";

export type ListOptions = {
  showHidden: boolean;
  typeFilter: TypeFilter;
  sortOrder: SortOrder;
  namePatterns?: RegExp[] | null;
};

export const getParentEntry = (currentPath: string | null): ListEntry | null => {
  if (!currentPath || currentPath === "/") return null;
  return { name: t("nav.parent"), path: getParentDirectory(currentPath), is_dir: true, size: null, modified: 0, isParent: true };
};

export const buildListEntries = (items: FileEntry[], currentPath: string | null, options: ListOptions): ListEntry[] => {
  const visible = items.filter((item) => {
    if (!options.showHidden && item.name.startsWith(".")) return false;
    if (options.namePatterns && !item.is_dir && !options.namePatterns.some((pattern) => pattern.test(item.name))) return false;
    if (options.typeFilter === "folders") return item.is_dir;
    if (options.typeFilter === "files") return !item.is_dir;
    return true;
  });

  const sorted = visible.sort((a, b) => {
    const directoryPriority = Number(b.is_dir) - Number(a.is_dir);
    if (directoryPriority !== 0) return directoryPriority;
    const comparison = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    return options.sortOrder === "asc" ? comparison : -comparison;
  });

  const parent = getParentEntry(currentPath);
  return parent ? [parent, ...sorted] : sorted;
};
