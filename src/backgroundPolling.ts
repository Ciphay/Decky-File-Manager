import { getOperationProgress } from "./api";
import {
  BackgroundOperationState,
  dispatchFileManagerRefresh,
  getBackgroundOperations,
  isOperationCanceled,
  markOperationCanceled,
  updateBackgroundOperations,
} from "./utils/backgroundStore";
import { composeOperationLabel, isGenericOperationText } from "./utils/operationText";
import { showOperationToast } from "./utils/operationToast";

const POLL_INTERVAL_MS = 400;

type PollResult = { keep?: BackgroundOperationState; drop?: boolean };

async function pollOperation(operation: BackgroundOperationState, refreshDispatched: Set<string>): Promise<PollResult> {
  if (isOperationCanceled(operation.operationId)) {
    return { drop: true };
  }

  const status = await getOperationProgress(operation.operationId);
  if (status.cancel_requested) {
    markOperationCanceled(operation.operationId);
    return { drop: true };
  }
  if (status.known === false) {
    return { drop: true };
  }

  const statusLabel = status.label?.trim() && !isGenericOperationText(status.label) ? status.label.trim() : operation.label;
  const statusDetail = status.detail?.trim() && !isGenericOperationText(status.detail) ? status.detail.trim() : operation.detail;
  const targetDir = typeof status.target_dir === "string" ? status.target_dir.trim() : "";

  if (status.active) {
    if (status.first_item_processed && targetDir && !refreshDispatched.has(operation.operationId)) {
      refreshDispatched.add(operation.operationId);
      dispatchFileManagerRefresh(targetDir);
    }
    return {
      keep: {
        operationId: operation.operationId,
        label: composeOperationLabel(statusLabel, statusDetail),
        detail: statusDetail,
        progress: Math.max(0, Math.min(100, Number(status.progress ?? 0))),
        paused: Boolean(status.paused),
      },
    };
  }

  const label = composeOperationLabel(statusLabel, "");
  showOperationToast(label, statusDetail ?? "", status.failed ? "failed" : "success", status.error);
  dispatchFileManagerRefresh(targetDir || undefined);
  return { drop: true };
}

export function startBackgroundPolling(): () => void {
  const refreshDispatched = new Set<string>();
  let running = false;

  const poll = async () => {
    const live = getBackgroundOperations();
    if (running || live.length === 0) {
      return;
    }
    running = true;
    try {
      const results = await Promise.all(
        live.map(async (operation): Promise<[BackgroundOperationState, PollResult]> => {
          try {
            return [operation, await pollOperation(operation, refreshDispatched)];
          } catch (e) {
            console.warn("Decky File Manager: background poll failed", e);
            return [operation, { keep: operation }];
          }
        }),
      );

      const next = new Map(results.map(([operation, result]) => [operation.operationId, result]));
      updateBackgroundOperations((current) =>
        current.flatMap((operation) => {
          const result = next.get(operation.operationId);
          if (!result) return [operation];
          return result.keep ? [result.keep] : [];
        }),
      );
    } finally {
      running = false;
    }
  };

  const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
  return () => window.clearInterval(timer);
}
