export type BackgroundOperationState = {
  label: string;
  progress: number;
  operationId: string;
  paused: boolean;
  detail?: string;
};

type Listener = () => void;

let operations: BackgroundOperationState[] = [];
const listeners = new Set<Listener>();
const canceledIds = new Set<string>();

const notify = () => listeners.forEach((listener) => listener());

export const getBackgroundOperations = (): BackgroundOperationState[] => operations;

export const subscribeBackgroundOperations = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const updateBackgroundOperations = (updater: (current: BackgroundOperationState[]) => BackgroundOperationState[]) => {
  const next = updater(operations);
  if (next !== operations) {
    operations = next;
    notify();
  }
};

export const addBackgroundOperation = (operation: BackgroundOperationState) =>
  updateBackgroundOperations((current) =>
    current.some((op) => op.operationId === operation.operationId)
      ? current.map((op) => (op.operationId === operation.operationId ? operation : op))
      : [...current, operation],
  );

export const patchBackgroundOperation = (operationId: string, patch: Partial<BackgroundOperationState>) =>
  updateBackgroundOperations((current) => {
    const target = current.find((op) => op.operationId === operationId);
    if (!target) return current;
    const changed = (Object.keys(patch) as Array<keyof BackgroundOperationState>).some((key) => target[key] !== patch[key]);
    return changed ? current.map((op) => (op.operationId === operationId ? { ...op, ...patch } : op)) : current;
  });

export const removeBackgroundOperation = (operationId: string) =>
  updateBackgroundOperations((current) => (current.some((op) => op.operationId === operationId) ? current.filter((op) => op.operationId !== operationId) : current));

export const markOperationCanceled = (operationId: string) => {
  canceledIds.add(operationId);
};
export const unmarkOperationCanceled = (operationId: string) => {
  canceledIds.delete(operationId);
};
export const isOperationCanceled = (operationId: string) => canceledIds.has(operationId);

const REFRESH_EVENT = "decky-manager-refresh-file-manager";

export const dispatchFileManagerRefresh = (targetDir?: string) => {
  window.dispatchEvent(new CustomEvent(REFRESH_EVENT, { detail: targetDir ? { targetDir } : undefined }));
};

export const subscribeFileManagerRefresh = (handler: (targetDir?: string) => void): (() => void) => {
  const listener = (event: Event) => {
    const targetDir = (event as CustomEvent).detail?.targetDir;
    handler(typeof targetDir === "string" ? targetDir : undefined);
  };
  window.addEventListener(REFRESH_EVENT, listener);
  return () => window.removeEventListener(REFRESH_EVENT, listener);
};
