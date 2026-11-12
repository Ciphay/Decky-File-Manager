import { useCallback, useEffect, useRef, useState } from "react";
import { cancelOperation, getOperationProgress, pauseOperation, resumeOperation } from "../api";
import { OperationModalState } from "../dialogs";
import { t } from "../i18n";
import {
  addBackgroundOperation,
  getBackgroundOperations,
  isOperationCanceled,
  markOperationCanceled,
  patchBackgroundOperation,
  removeBackgroundOperation,
  unmarkOperationCanceled,
} from "../utils/backgroundStore";
import { composeOperationLabel, isCancellationError, sanitizeOperationText } from "../utils/operationText";
import { showErrorToast } from "../utils/operationToast";
import { messageOf } from "../utils/paths";

const POLL_INTERVAL_MS = 150;
const START_GRACE_ATTEMPTS = 5;

export type RunOptions = {
  onError?: (error: unknown) => void;
  showProgress?: boolean;
  showBackground?: boolean;
};

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const newOperationId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function useOperationRunner(onFinished: () => Promise<void>) {
  const [operationModal, setOperationModal] = useState<OperationModalState>(null);
  const modalRef = useRef(operationModal);
  modalRef.current = operationModal;
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const updateModal = useCallback((operationId: string, patch: (modal: NonNullable<OperationModalState>) => OperationModalState) => {
    if (!mountedRef.current) return;
    setOperationModal((prev) => (prev && prev.operationId === operationId ? patch(prev) : prev));
  }, []);

  const runOperation = useCallback(async <T,>(label: string, action: (operationId: string) => Promise<T>, options: RunOptions = {}): Promise<T | null> => {
    const operationId = newOperationId();
    const showProgress = options.showProgress ?? true;
    let stopped = false;

    const pollProgress = async () => {
      let graceAttempts = START_GRACE_ATTEMPTS;
      while (!stopped && mountedRef.current) {
        await sleep(POLL_INTERVAL_MS);
        if (stopped || !mountedRef.current) return;
        try {
          const status = await getOperationProgress(operationId);
          if (stopped) return;
          if (!status.active) {
            if (status.known === false && graceAttempts-- > 0) continue;
            return;
          }
          const progress = Math.max(0, Math.min(100, Number(status.progress ?? 0)));
          const display = composeOperationLabel(status.label || label, status.detail);
          const paused = Boolean(status.paused);
          updateModal(operationId, (modal) =>
            modal.progress === progress && modal.label === display && modal.paused === paused ? modal : { ...modal, progress, label: display, paused },
          );
          patchBackgroundOperation(operationId, { progress, label: display, paused });
        } catch (e) {
          console.warn("getOperationProgress failed", e);
        }
      }
    };

    if (showProgress) {
      setOperationModal({ label: sanitizeOperationText(label), progress: 0, operationId, showBackground: options.showBackground ?? false, paused: false });
      void pollProgress();
    }

    try {
      const result = await action(operationId);
      const outcome = result as { success?: boolean; cancelled?: boolean; error?: string } | null;
      if (outcome && typeof outcome === "object") {
        if (outcome.cancelled) return null;
        if (outcome.success === false) throw new Error(outcome.error || t("action.failed"));
      }
      return result;
    } catch (e) {
      if (isCancellationError(e) || isOperationCanceled(operationId)) return null;
      const inBackground = getBackgroundOperations().some((op) => op.operationId === operationId);
      if (!inBackground) {
        if (options.onError) options.onError(e);
        else showErrorToast(messageOf(e, t("action.failed")));
      }
      return null;
    } finally {
      stopped = true;
      updateModal(operationId, () => null);
      await onFinishedRef.current();
    }
  }, [updateModal]);

  const requestCancel = useCallback(async (operationId?: string) => {
    const id = operationId ?? modalRef.current?.operationId;
    if (!id) return;

    markOperationCanceled(id);
    try {
      await cancelOperation(id);
    } catch (e) {
      unmarkOperationCanceled(id);
      console.warn("cancelOperation failed", e);
    }
    removeBackgroundOperation(id);
    updateModal(id, () => null);
  }, [updateModal]);

  const requestPauseToggle = useCallback(async (operationId?: string) => {
    const id = operationId ?? modalRef.current?.operationId;
    if (!id) return;

    const paused = modalRef.current?.operationId === id
      ? modalRef.current.paused
      : getBackgroundOperations().find((op) => op.operationId === id)?.paused ?? false;
    try {
      await (paused ? resumeOperation : pauseOperation)(id);
      updateModal(id, (modal) => ({ ...modal, paused: !paused }));
      patchBackgroundOperation(id, { paused: !paused });
    } catch (e) {
      console.warn("operation pause toggle failed", e);
    }
  }, [updateModal]);

  const moveToBackground = useCallback(() => {
    const modal = modalRef.current;
    if (!modal) return;
    addBackgroundOperation({ label: modal.label, progress: modal.progress, operationId: modal.operationId, paused: modal.paused });
    setOperationModal(null);
  }, []);

  return { operationModal, runOperation, requestCancel, requestPauseToggle, moveToBackground };
}

export type RunOperation = ReturnType<typeof useOperationRunner>["runOperation"];
