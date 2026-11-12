import { toaster } from "@decky/api";
import { t } from "../i18n";
import { isGenericOperationText, normalizeOperationLabelAndDetail } from "./operationText";

const VERB_PATTERNS: Array<[string, string[]]> = [
  ["toast.success_extracted", ["extra", "extract", "descompact", "unzip", "解压"]],
  ["toast.success_copied", ["cop", "paste", "colar", "pegar", "coller", "einfüg", "粘贴"]],
  ["toast.success_moved", ["mov", "move", "mover", "déplac", "versch", "移动"]],
  ["toast.success_deleted", ["delet", "excluir", "remover", "supprim", "lösch", "删除", "eliminar"]],
  ["toast.success_renamed", ["renom", "rename", "renomb", "umbenenn", "重命名"]],
  ["toast.success_created", ["cri", "create", "folder", "pasta", "crear", "créer", "erstell", "创建"]],
];

const OWN_LABELS: Array<[string, string]> = [
  ["action.extracting", "toast.success_extracted"],
  ["action.pasting", "toast.success_copied"],
  ["action.moving", "toast.success_moved"],
  ["action.deleting", "toast.success_deleted"],
  ["action.renaming", "toast.success_renamed"],
  ["action.creating_folder", "toast.success_created"],
];

const successKey = (baseLabel: string): string => {
  const lower = baseLabel.toLowerCase();
  const own = OWN_LABELS.find(([labelKey]) => lower.startsWith(t(labelKey).toLowerCase()));
  if (own) return own[1];
  const match = VERB_PATTERNS.find(([, words]) => words.some((word) => lower.includes(word)));
  return match ? match[0] : "toast.success_completed";
};

export type OperationOutcome = "success" | "failed" | "cancelled";

export const showOperationToast = (label: string, detail: string, outcome: OperationOutcome = "success", error?: string) => {
  const cleanDetail = isGenericOperationText(detail) ? "" : detail;
  const { baseLabel, fileName } = normalizeOperationLabelAndDetail(label, cleanDetail);
  const subject = fileName || baseLabel || t("common.item");

  let title = t("toast.completed");
  let body: string;

  if (outcome === "cancelled") {
    title = t("toast.cancelled");
    body = subject;
  } else if (outcome === "failed") {
    title = t("toast.failed");
    body = error ? `${subject}: ${error}` : subject;
  } else if (fileName) {
    body = `${fileName} ${t(successKey(baseLabel))}`;
  } else if (!baseLabel || isGenericOperationText(baseLabel)) {
    body = t("toast.generic_success");
  } else {
    body = `${baseLabel} ${t(successKey(baseLabel))}`;
  }

  toaster.toast({ title, body, duration: 5000, showToast: true });
};

export const showErrorToast = (message: string) => {
  toaster.toast({ title: t("toast.failed"), body: message, duration: 5000, showToast: true });
};
