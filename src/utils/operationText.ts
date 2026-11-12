export const sanitizeOperationText = (value: unknown): string =>
  String(value ?? "")
    .replace(/(?:\s*[.]{1,3}\s*)(?=(?:[:\-]|$))/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

export const isGenericOperationText = (value: unknown): boolean =>
  /^(all ok|all is ok|ok|done|success|successfully|sucesso|concluído|concluida|concluída|operation|operacao)$/i.test(String(value ?? "").trim());

export const normalizePathLikeName = (value: string): string => {
  const raw = String(value || "").trim();
  if (!raw || isGenericOperationText(raw)) {
    return "";
  }
  return raw.replace(/\\/g, "/").split("/").filter(Boolean).pop() || raw;
};

export const normalizeOperationLabelAndDetail = (label: string, detail: string) => {
  const rawLabel = sanitizeOperationText(label);
  let baseLabel = rawLabel;
  let fileName = normalizePathLikeName(sanitizeOperationText(detail));

  if (!fileName) {
    const colon = rawLabel.indexOf(":");
    if (colon >= 0) {
      fileName = normalizePathLikeName(rawLabel.slice(colon + 1).trim());
      baseLabel = rawLabel.slice(0, colon).trim() || rawLabel;
    }
  }
  return { baseLabel, fileName };
};

export const composeOperationLabel = (label: string, detail?: string): string => {
  const safeLabel = sanitizeOperationText(label);
  const safeDetail = sanitizeOperationText(detail);
  const baseLabel = safeLabel.includes(":") ? safeLabel.split(":", 1)[0].trim() : safeLabel;

  if (safeDetail && !isGenericOperationText(safeDetail)) {
    return `${baseLabel || safeLabel}: ${safeDetail}`;
  }
  return baseLabel || safeLabel;
};

export const isCancellationError = (error: unknown): boolean => {
  const message = String((error as { message?: string } | null)?.message ?? error ?? "").toLowerCase();
  return message.includes("cancelad") || message.includes("cancelled") || message.includes("canceled");
};

export const isPermissionError = (error: unknown): boolean => {
  const message = String((error as { message?: string } | null)?.message ?? error ?? "").toLowerCase();
  return message.includes("permissão") || message.includes("permission denied") || message.includes("sem permiss");
};
