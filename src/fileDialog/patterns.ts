import { PickFilter } from "./pickerSession";

const globToRegExp = (glob: string): RegExp => {
  const escaped = glob.trim().replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
};

export const patternsForDefaultFilter = (filters: PickFilter[]): RegExp[] | null => {
  const active = filters.find((filter) => filter.isDefault) ?? filters[0];
  if (!active || active.patterns.length === 0 || active.patterns.some((pattern) => pattern.trim() === "*")) {
    return null;
  }
  return active.patterns.map(globToRegExp);
};
