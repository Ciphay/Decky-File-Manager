import { useCallback, useRef, useState } from "react";
import { FileEntry, listDir } from "../api";
import { getParentDirectory, messageOf } from "../utils/paths";

export type PaneSide = "left" | "right";

export type PaneState = {
  path: string;
  items: FileEntry[];
  loading: boolean;
  error: string | null;
};

type Panes = Record<PaneSide, PaneState>;
type FocusRequest = { side: PaneSide; path: string };

const EMPTY_PANE: PaneState = { path: "", items: [], loading: false, error: null };

export function usePanes() {
  const [panes, setPanes] = useState<Panes>({ left: { ...EMPTY_PANE, loading: true }, right: EMPTY_PANE });
  const [isSplit, setIsSplit] = useState(false);
  const [selectedSide, setSelectedSide] = useState<PaneSide>("left");

  const panesRef = useRef(panes);
  panesRef.current = panes;
  const requestIds = useRef<Record<PaneSide, number>>({ left: 0, right: 0 });
  const focusRequestRef = useRef<FocusRequest | null>(null);

  const patchPane = useCallback((side: PaneSide, patch: Partial<PaneState>) => {
    setPanes((current) => ({ ...current, [side]: { ...current[side], ...patch } }));
  }, []);

  const loadPane = useCallback(async (side: PaneSide, target: string, focusPath: string | null = null): Promise<boolean> => {
    const requestId = ++requestIds.current[side];
    patchPane(side, { loading: true, error: null });
    try {
      const res = await listDir(target);
      if (!res || res.success === false || !Array.isArray(res.items)) {
        throw new Error(res?.error || "Error");
      }
      if (requestIds.current[side] !== requestId) return false;
      focusRequestRef.current = focusPath ? { side, path: focusPath } : null;
      patchPane(side, { path: res.path, items: res.items, loading: false, error: null });
      return true;
    } catch (e) {
      if (requestIds.current[side] === requestId) {
        patchPane(side, { loading: false, error: messageOf(e, "Error") });
      }
      return false;
    }
  }, [patchPane]);

  const activeSide: PaneSide = isSplit ? selectedSide : "left";

  const getPath = useCallback((side: PaneSide): string => panesRef.current[side].path || panesRef.current.left.path || "/", []);

  const refresh = useCallback(async (side: PaneSide) => {
    const path = panesRef.current[side].path;
    if (path) await loadPane(side, path);
  }, [loadPane]);

  const refreshVisible = useCallback(async (targetDir?: string) => {
    const sides: PaneSide[] = isSplit ? ["left", "right"] : ["left"];
    const normalizedTarget = targetDir ? targetDir.replace(/\/+$/, "") || "/" : undefined;
    const matching = sides.filter((side) => !normalizedTarget || panesRef.current[side].path === normalizedTarget);
    await Promise.all(matching.map((side) => refresh(side)));
  }, [isSplit, refresh]);

  const goUp = useCallback((side: PaneSide): boolean => {
    const current = panesRef.current[side].path;
    if (!current || current === "/") return false;
    void loadPane(side, getParentDirectory(current), current);
    return true;
  }, [loadPane]);

  const setSplit = useCallback((enabled: boolean) => {
    setPanes((current) => {
      if (enabled) {
        return { ...current, right: { ...current.left, loading: false } };
      }
      return selectedSide === "right" ? { ...current, left: { ...current.right } } : current;
    });
    if (!enabled) setSelectedSide("left");
    setIsSplit(enabled);
  }, [selectedSide]);

  const consumeFocusRequest = useCallback((side: PaneSide): string | null => {
    const request = focusRequestRef.current;
    if (request && request.side === side) {
      focusRequestRef.current = null;
      return request.path;
    }
    return null;
  }, []);

  return { panes, isSplit, setSplit, selectedSide, setSelectedSide, activeSide, loadPane, getPath, refresh, refreshVisible, goUp, consumeFocusRequest };
}

export type PanesApi = ReturnType<typeof usePanes>;
