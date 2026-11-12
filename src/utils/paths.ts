export const getParentDirectory = (currentPath: string): string => {
  const parts = (currentPath || "").split("/").filter(Boolean);
  if (parts.length <= 1) return "/";
  parts.pop();
  return `/${parts.join("/")}`;
};

export const getDirectoryOf = (filePath: string): string => getParentDirectory(filePath);


export const stripExtension = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
};

export const messageOf = (error: unknown, fallback = ""): string => {
  if (error instanceof Error && error.message) return error.message;
  const text = typeof error === "string" ? error : (error as { message?: string } | null)?.message;
  return text || fallback;
};
