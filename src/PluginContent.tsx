import { useCallback, useEffect, useRef, useState, Fragment } from "react";
import { t } from "./i18n";
import { PanelSection, PanelSectionRow, ButtonItem, DialogButton, Router, Focusable, NavEntryPositionPreferences } from "@decky/ui";
import { callable, toaster } from "@decky/api";
import { PlusSquareFillIcon, PluginIcon, PauseIcon, PlayIcon, StopIcon } from "./Icons";

const DEFAULT_MANAGER_PATH = "~";

type BackgroundOperationState = {
  label: string;
  progress: number;
  operationId: string;
  paused: boolean;
  detail?: string;
};

const sanitizeOperationText = (value: string) => String(value ?? "").replace(/(?:\s*[.]{1,3}\s*)(?=(?:[:\-]|$))/g, "").replace(/\s{2,}/g, " ").trim();

const getBackgroundOperationDisplayLabel = (label: string, detail?: string) => {
  const safeLabel = sanitizeOperationText(label);
  const safeDetail = sanitizeOperationText(typeof detail === "string" ? detail : "");
  const normalizedBaseLabel = typeof safeLabel === "string" && safeLabel.includes(":")
    ? safeLabel.split(":", 1)[0].trim()
    : safeLabel;

  if (safeDetail && !isGenericOperationText(safeDetail)) {
    return `${normalizedBaseLabel || safeLabel}: ${safeDetail}`;
  }

  return safeLabel || label;
};

const isGenericOperationText = (value: string) => {
  const normalized = String(value || "").trim().toLowerCase();
  return /^(all ok|all is ok|ok|done|success|successfully|sucesso|concluído|concluida|concluída|operation|operacao)$/i.test(normalized);
};

const isGenericOperationLabel = isGenericOperationText;

const normalizePathLikeName = (value: string) => {
  const raw = String(value || "").trim();
  if (!raw || isGenericOperationText(raw)) {
    return "";
  }
  const normalized = raw.replace(/\\/g, "/");
  const lastSegment = normalized.split("/").filter(Boolean).pop();
  return lastSegment || raw;
};

const extractFilenameFromLabel = (label: string) => {
  const rawLabel = String(label || "").trim();
  if (!rawLabel) {
    return "";
  }

  if (rawLabel.includes(":")) {
    const [, afterColon] = rawLabel.split(":", 2).map((part) => part.trim());
    if (afterColon) {
      return normalizePathLikeName(afterColon);
    }
  }

  if (rawLabel.includes("/") || rawLabel.includes("\\")) {
    return normalizePathLikeName(rawLabel);
  }

  const operationVerbMatch = rawLabel.match(/^(.+?)\s+(.+)$/);
  if (operationVerbMatch) {
    const remainder = operationVerbMatch[2].trim();
    if (remainder && /[^\s]+/.test(remainder)) {
      return normalizePathLikeName(remainder);
    }
  }

  return "";
};

const normalizeOperationLabelAndDetail = (label: string, detail: string) => {
  const rawLabel = sanitizeOperationText(String(label || ""));
  const rawDetail = sanitizeOperationText(String(detail || ""));
  let baseLabel = rawLabel;
  let fileName = normalizePathLikeName(rawDetail);

  if (!fileName) {
    const extracted = extractFilenameFromLabel(rawLabel);
    if (extracted) {
      fileName = extracted;
      if (rawLabel.includes(":")) {
        baseLabel = rawLabel.split(":", 2)[0].trim() || rawLabel;
      } else {
        const operationVerbMatch = rawLabel.match(/^(.+?)\s+(.+)$/);
        if (operationVerbMatch) {
          baseLabel = operationVerbMatch[1].trim() || rawLabel;
        }
      }
    }
  }

  return { baseLabel, fileName };
};

const dispatchFileManagerRefresh = (targetDir?: string) => {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent("decky-manager-refresh-file-manager", {
    detail: targetDir ? { targetDir } : undefined,
  }));
};

const showBackgroundOperationToast = (label: string, detail: string, cancelled = false) => {
  const sanitizedDetail = isGenericOperationText(detail) ? "" : detail;
  const { baseLabel, fileName } = normalizeOperationLabelAndDetail(label, sanitizedDetail);
  const normalizedBaseLabel = baseLabel.toLowerCase();
  const genericLabel = isGenericOperationLabel(normalizedBaseLabel);

  let verbKey = "toast.success_completed";
  if (normalizedBaseLabel.includes("extra") || normalizedBaseLabel.includes("extract") || normalizedBaseLabel.includes("descompact") || normalizedBaseLabel.includes("unzip") || normalizedBaseLabel.includes("解压")) {
    verbKey = "toast.success_extracted";
  } else if (normalizedBaseLabel.includes("cop") || normalizedBaseLabel.includes("copy") || normalizedBaseLabel.includes("paste") || normalizedBaseLabel.includes("colar") || normalizedBaseLabel.includes("copiando")) {
    verbKey = "toast.success_copied";
  } else if (normalizedBaseLabel.includes("mov") || normalizedBaseLabel.includes("move") || normalizedBaseLabel.includes("mover")) {
    verbKey = "toast.success_moved";
  } else if (normalizedBaseLabel.includes("delet") || normalizedBaseLabel.includes("delete") || normalizedBaseLabel.includes("excluir") || normalizedBaseLabel.includes("remover")) {
    verbKey = "toast.success_deleted";
  } else if (normalizedBaseLabel.includes("renom") || normalizedBaseLabel.includes("rename") || normalizedBaseLabel.includes("renome")) {
    verbKey = "toast.success_renamed";
  } else if (normalizedBaseLabel.includes("cri") || normalizedBaseLabel.includes("create") || normalizedBaseLabel.includes("folder") || normalizedBaseLabel.includes("pasta")) {
    verbKey = "toast.success_created";
  }

  const successMsg = t(verbKey);

  const body = cancelled
    ? fileName || baseLabel
      ? fileName || baseLabel
      : t("common.item")
    : fileName
      ? `${fileName} ${successMsg}`
      : genericLabel
        ? t("toast.generic_success")
        : `${baseLabel || t("common.operation")} ${successMsg}`;

  toaster.toast({
    title: cancelled ? t("toast.cancelled") : t("toast.completed"),
    body,
    duration: 5000,
    showToast: true,
  });
};

const startBackgroundOperationGlobalPolling = () => {
  if (typeof window === "undefined") {
    return;
  }

  if ((window as any).__deckyManagerBackgroundGlobalPollingStarted) {
    return;
  }

  (window as any).__deckyManagerBackgroundGlobalPollingStarted = true;

  const getOperationProgress = callable<[string], {
    progress: number;
    active: boolean;
    label: string;
    detail?: string;
    paused: boolean;
    cancel_requested?: boolean;
    first_item_processed?: boolean;
    target_dir?: string | null;
  }>("get_operation_progress");

  const syncBackgroundOperationsStore = (operations: BackgroundOperationState[]) => {
    const store = (window as any).__deckyManagerBackgroundOperation__ || {};
    (window as any).__deckyManagerBackgroundOperation__ = {
      ...store,
      operations,
      active: operations.length > 0,
    };
    window.dispatchEvent(new CustomEvent("decky-manager-background-operation", {
      detail: { operations, active: operations.length > 0 },
    }));
  };

  const toastHistory = new Set<string>();
  const canceledOperationIds = new Set<string>();
  const firstItemRefreshDispatched = new Set<string>();

  const poll = async () => {
    const store = (window as any).__deckyManagerBackgroundOperation__ || {};
    const liveOperations = Array.isArray(store.operations) ? store.operations as BackgroundOperationState[] : [];

    if (liveOperations.length === 0) {
      return;
    }

    const refreshed: BackgroundOperationState[] = [];
    const completedOperationIds = new Set<string>();
    const globalCanceledOperationIds = (window as any).__deckyManagerBackgroundCanceledOperationIds || new Set<string>();

    for (const operation of liveOperations) {
      if (canceledOperationIds.has(operation.operationId) || globalCanceledOperationIds.has(operation.operationId)) {
        continue;
      }
      try {
        const status = await getOperationProgress(operation.operationId);
        if (status && typeof status === "object" && status.cancel_requested) {
          canceledOperationIds.add(operation.operationId);
          globalCanceledOperationIds.add(operation.operationId);
          (window as any).__deckyManagerBackgroundCanceledOperationIds = globalCanceledOperationIds;
          continue;
        }

        if (status && typeof status === "object" && status.active) {
          const nextProgress = Math.max(0, Math.min(100, Number(status.progress ?? 0)));
          const statusLabel = typeof status.label === "string" ? status.label.trim() : "";
          const statusDetail = typeof status.detail === "string" ? status.detail.trim() : "";
          const effectiveLabel = statusLabel && !isGenericOperationText(statusLabel) ? statusLabel : operation.label;
          const effectiveDetail = statusDetail && !isGenericOperationText(statusDetail) ? statusDetail : operation.detail;
          const nextDisplayLabel = getBackgroundOperationDisplayLabel(effectiveLabel, effectiveDetail);
          const targetDir = typeof status.target_dir === "string" ? status.target_dir.trim() : "";
          const firstItemProcessed = Boolean(status.first_item_processed);

          if (firstItemProcessed && targetDir && !firstItemRefreshDispatched.has(operation.operationId)) {
            firstItemRefreshDispatched.add(operation.operationId);
            dispatchFileManagerRefresh(targetDir);
          }

          refreshed.push({
            operationId: operation.operationId,
            label: nextDisplayLabel,
            progress: nextProgress,
            paused: Boolean(status.paused),
            detail: effectiveDetail ? String(effectiveDetail).trim() : undefined,
          });
        } else {
          completedOperationIds.add(operation.operationId);
        }
      } catch (e) {
        refreshed.push(operation);
      }
    }

    if (completedOperationIds.size > 0) {
      const completed = liveOperations.filter((op) => completedOperationIds.has(op.operationId));
      for (const operation of completed) {
        if (toastHistory.has(operation.operationId) || canceledOperationIds.has(operation.operationId) || globalCanceledOperationIds.has(operation.operationId)) {
          continue;
        }

        try {
          const finalStatus = await getOperationProgress(operation.operationId);
          if (finalStatus && typeof finalStatus === "object" && finalStatus.cancel_requested) {
            canceledOperationIds.add(operation.operationId);
            globalCanceledOperationIds.add(operation.operationId);
            (window as any).__deckyManagerBackgroundCanceledOperationIds = globalCanceledOperationIds;
            continue;
          }

          let finalDetail = typeof finalStatus?.detail === "string" ? finalStatus.detail.trim() : "";
          if (isGenericOperationText(finalDetail)) {
            finalDetail = "";
          }
          let finalLabel = typeof finalStatus?.label === "string" ? finalStatus.label.trim() : operation.label;
          const genericLabel = isGenericOperationLabel(finalLabel);

          const operationLabelBase = typeof operation.label === "string" ? operation.label.split(":", 1)[0].trim() : "";
          const operationIsFolderCopy = /copy|colar|copiar|paste|mover|move|mov/i.test(operationLabelBase || finalLabel || "");
          const rootFolderName = typeof finalStatus?.detail === "string" && finalStatus.detail.trim() && !isGenericOperationText(finalStatus.detail) ? normalizePathLikeName(finalStatus.detail) : "";

          if (!finalDetail) {
            if (rootFolderName) {
              finalDetail = rootFolderName;
            } else if (operation.detail) {
              finalDetail = normalizePathLikeName(operation.detail);
            }

            if (!finalDetail && operationIsFolderCopy) {
              const fallback = normalizeOperationLabelAndDetail(operation.label, "");
              if (fallback.fileName) {
                finalDetail = fallback.fileName;
              }
            }

            if (!finalDetail) {
              const fallback = normalizeOperationLabelAndDetail(operation.label, "");
              if (fallback.fileName) {
                finalDetail = fallback.fileName;
                if (genericLabel) {
                  finalLabel = fallback.baseLabel || finalLabel;
                }
              }
            }
          }

          dispatchFileManagerRefresh();
          if (!toastHistory.has(operation.operationId)) {
            showBackgroundOperationToast(finalLabel, finalDetail);
            toastHistory.add(operation.operationId);
          }
        } catch (e) {
          console.warn("toast resolution failed", e);
        }
      }
    }

    syncBackgroundOperationsStore(refreshed);
  };

  window.setInterval(() => {
    void poll();
  }, 250);
};

function Content() {
  const openFullScreen = useCallback(() => {
    Router.CloseSideMenus();
    Router.Navigate?.(`/steam-os-file-manager?path=${encodeURIComponent(DEFAULT_MANAGER_PATH)}&mode=normal`);
  }, []);

  const openGamePicker = useCallback(async () => {
    Router.CloseSideMenus();
    Router.Navigate?.(`/steam-os-file-manager/select-file?path=${encodeURIComponent(DEFAULT_MANAGER_PATH)}`);
  }, []);

  const cancelOperation = callable<[string], { ok: boolean }>("cancel_operation");
  const pauseOperation = callable<[string], { ok: boolean }>("pause_operation");
  const resumeOperation = callable<[string], { ok: boolean }>("resume_operation");

  type BackgroundOperationState = {
    label: string;
    progress: number;
    operationId: string;
    paused: boolean;
  };

  const [backgroundOperations, setBackgroundOperations] = useState<BackgroundOperationState[]>([]);
  const backgroundOperationsRef = useRef<BackgroundOperationState[]>([]);

  useEffect(() => {
    const updateState = (detail: { operations: BackgroundOperationState[]; active: boolean }) => {
      setBackgroundOperations(Array.isArray(detail.operations) ? detail.operations : []);
    };

    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      updateState(detail);
    };

    window.addEventListener("decky-manager-background-operation", handler as EventListener);

    const store = (window as any).__deckyManagerBackgroundOperation__;
    if (Array.isArray(store?.operations)) {
      updateState(store);
    }

    return () => {
      window.removeEventListener("decky-manager-background-operation", handler as EventListener);
    };
  }, []);

  const syncBackgroundOperationsStore = useCallback((operations: BackgroundOperationState[]) => {
    const store = (window as any).__deckyManagerBackgroundOperation__ || {};
    (window as any).__deckyManagerBackgroundOperation__ = {
      ...store,
      operations,
      active: operations.length > 0,
    };
    backgroundOperationsRef.current = operations;
    window.dispatchEvent(new CustomEvent("decky-manager-background-operation", {
      detail: { operations, active: operations.length > 0 },
    }));
  }, []);

  const handleBackgroundCancel = useCallback(async (operationId: string) => {
    const operation = backgroundOperations.find((op) => op.operationId === operationId);
    const canceledOperationIds = (window as any).__deckyManagerBackgroundCanceledOperationIds || new Set<string>();

    canceledOperationIds.add(operationId);
    (window as any).__deckyManagerBackgroundCanceledOperationIds = canceledOperationIds;

    try {
      const result = await cancelOperation(operationId);
      if (result.ok) {
        const nextOperations = backgroundOperations.filter((op) => op.operationId !== operationId);
        setBackgroundOperations(nextOperations);
        syncBackgroundOperationsStore(nextOperations);
        if (operation) {
          dispatchFileManagerRefresh();
        }
      } else {
        canceledOperationIds.delete(operationId);
        (window as any).__deckyManagerBackgroundCanceledOperationIds = canceledOperationIds;
      }
    } catch (e) {
      canceledOperationIds.delete(operationId);
      (window as any).__deckyManagerBackgroundCanceledOperationIds = canceledOperationIds;
      console.warn("background cancel failed", e);
    }
  }, [backgroundOperations, cancelOperation, syncBackgroundOperationsStore]);

  const handleBackgroundPauseToggle = useCallback(async (operationId: string) => {
    try {
      const operation = backgroundOperations.find((op) => op.operationId === operationId);
      if (!operation) {
        return;
      }
      if (operation.paused) {
        await resumeOperation(operationId);
      } else {
        await pauseOperation(operationId);
      }
      const nextOperations = backgroundOperations.map((op) =>
        op.operationId === operationId ? { ...op, paused: !op.paused } : op,
      );
      setBackgroundOperations(nextOperations);
      syncBackgroundOperationsStore(nextOperations);
    } catch (e) {
      console.warn("background pause toggle failed", e);
    }
  }, [backgroundOperations, pauseOperation, resumeOperation, syncBackgroundOperationsStore]);

  return (
    <PanelSection>
      <PanelSectionRow>
        <ButtonItem
          onClick={openFullScreen}
          layout="below"
        >
          <div style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <PluginIcon />
            <span style={{ marginLeft: "auto", textAlign: "right", width: "100%" }}>{t("action.open_file_manager")}</span>
          </div>
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem
          onClick={openGamePicker}
          layout="below"
        >
          <div style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <PlusSquareFillIcon />
            <span style={{ marginLeft: "auto", textAlign: "right", width: "100%" }}>{t("action.add_shortcut")}</span>
          </div>
        </ButtonItem>
      </PanelSectionRow>
      {backgroundOperations.length > 0 ? (
        <>
          <PanelSectionRow>
            <div style={{ width: "100%", fontWeight: 700, opacity: 0.9, color: "#fff", textAlign: "center", marginTop: 3 }}>{t("panel.background.title")}</div>
          </PanelSectionRow>
          {backgroundOperations.map((operation, index) => (
            <Fragment key={operation.operationId}>
              <PanelSectionRow>
                <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {operation.label}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ fontSize: 12, color: "#aaa", flexShrink: 0 }}>
                          {Math.max(0, Math.min(100, Math.floor(operation.progress)))}%
                        </div>
                        <div style={{ flex: 1, height: 8, borderRadius: 999, background: "#2b2b2b", overflow: "hidden" }}>
                          <div style={{ width: `${Math.max(0, Math.min(100, operation.progress))}%`, height: "100%", background: "#4e8ad9", transition: "width 0.2s linear" }} />
                        </div>
                      </div>
                    </div>
                    <Focusable
                      navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
                      style={{ display: "flex", gap: 8, flexShrink: 0 }}
                    >
                      <DialogButton
                        focusable
                        onClick={() => handleBackgroundPauseToggle(operation.operationId)}
                        aria-label={operation.paused ? t("action.resume") : t("action.pause")}
                        style={{ width: 40, height: 40, minWidth: 40, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                      >
                        {operation.paused ? <PlayIcon /> : <PauseIcon />}
                      </DialogButton>
                      <DialogButton
                        focusable
                        onClick={() => handleBackgroundCancel(operation.operationId)}
                        aria-label={t("action.cancel")}
                        style={{ width: 40, height: 40, minWidth: 40, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                      >
                        <StopIcon />
                      </DialogButton>
                    </Focusable>
                  </div>
                </div>
              </PanelSectionRow>
              {index < backgroundOperations.length - 1 ? (
                <PanelSectionRow>
                  <div style={{ width: "100%", height: 1, background: "rgba(255,255,255,0.08)", margin: "4px 0" }} />
                </PanelSectionRow>
              ) : null}
            </Fragment>
          ))}
        </>
      ) : (
        <PanelSectionRow>
          <div style={{ width: "100%", opacity: 0.9, color: "#fff", fontWeight: 700, textAlign: "center", paddingTop: 3 }}>{t("panel.background.none")}</div>
        </PanelSectionRow>
      )}
    </PanelSection>
  );
}

startBackgroundOperationGlobalPolling();

export default Content;
