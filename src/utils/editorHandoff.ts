export type EditorFile = { path: string; content: string };

type Listener = (file: EditorFile) => void;

let pending: EditorFile | null = null;
const listeners = new Set<Listener>();

export const handOffToEditor = (file: EditorFile) => {
  pending = file;
  listeners.forEach((listener) => listener(file));
};

export const takePendingEditorFile = (): EditorFile | null => {
  const file = pending;
  pending = null;
  return file;
};

export const subscribeEditorFile = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
