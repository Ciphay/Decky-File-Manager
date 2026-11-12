export type PickFilter = { name: string; patterns: string[]; isDefault: boolean };

export type PickRequest = {
  title: string;
  initialPath: string;
  chooseDirectory: boolean;
  filters: PickFilter[];
};

export type PickSession = {
  request: PickRequest;
  startPath: string;
  patterns: RegExp[] | null;
  canShowAll: boolean;
  resolve: (path: string) => void;
  cancel: () => void;
  abandon: () => void;
};

type Listener = () => void;

let active: PickSession | null = null;
const listeners = new Set<Listener>();

export const getActivePickSession = (): PickSession | null => active;

export const setActivePickSession = (session: PickSession | null) => {
  active = session;
  listeners.forEach((listener) => listener());
};

export const subscribeActivePickSession = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
