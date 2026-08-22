import React, { useCallback, useEffect, useRef, useState } from "react";

export type PaneSide = "left" | "right";

type PaneEntry = {
  name: string;
  path: string;
  is_dir: boolean;
  size: number | null;
  modified: number;
};

type PaneListDirResult = {
  path: string;
  items: PaneEntry[];
};

type UsePaneOptions = {
  listDir?: (path: string) => Promise<PaneListDirResult>;
  currentPath?: string;
};

export function usePane({ listDir, currentPath = "/" }: UsePaneOptions = {}) {
  const [selectedPane, setSelectedPane] = useState<PaneSide>("left");
  const [isSplitView, setIsSplitView] = useState(false);
  const [leftPath, setLeftPath] = useState("");
  const [rightPath, setRightPath] = useState("");
  const [leftItems, setLeftItems] = useState<PaneEntry[]>([]);
  const [rightItems, setRightItems] = useState<PaneEntry[]>([]);
  const [leftLoading, setLeftLoading] = useState(false);
  const [rightLoading, setRightLoading] = useState(false);
  const [leftError, setLeftError] = useState<string | null>(null);
  const [rightError, setRightError] = useState<string | null>(null);
  const lastLoadedPanePathRef = useRef<{ left: string | null; right: string | null }>({ left: null, right: null });
  const currentPathRef = useRef(currentPath || "/");

  useEffect(() => {
    currentPathRef.current = currentPath || "/";
  }, [currentPath]);

  const getPanePath = useCallback((paneSide: PaneSide = selectedPane) => {
    const globalPath = currentPathRef.current || "/";
    if (!isSplitView) {
      return globalPath;
    }

    return paneSide === "left" ? (leftPath || globalPath) : (rightPath || globalPath);
  }, [isSplitView, leftPath, rightPath, selectedPane]);

  const loadPanePath = useCallback(async (side: PaneSide, newPath: string) => {
    if (!listDir) {
      return;
    }

    const loader = side === "left" ? setLeftLoading : setRightLoading;
    const errorSetter = side === "left" ? setLeftError : setRightError;
    const itemSetter = side === "left" ? setLeftItems : setRightItems;
    const pathSetter = side === "left" ? setLeftPath : setRightPath;
    const previousPath = side === "left" ? leftPath || currentPathRef.current || "/" : rightPath || currentPathRef.current || "/";
    const previousItems = side === "left" ? leftItems : rightItems;

    loader(true);
    errorSetter(null);

    try {
      const res = await listDir(newPath);
      pathSetter(res.path);
      itemSetter(res.items);
      lastLoadedPanePathRef.current[side] = res.path;
    } catch (error) {
      pathSetter(previousPath);
      itemSetter(previousItems);
      lastLoadedPanePathRef.current[side] = previousPath;
      errorSetter(null);
    } finally {
      loader(false);
    }
  }, [leftItems, leftPath, listDir, rightItems, rightPath]);

  const syncPanePair = useCallback((nextPath: string, nextItems: PaneEntry[]) => {
    setLeftPath(nextPath);
    setLeftItems(nextItems);
    setRightPath(nextPath);
    setRightItems(nextItems);
  }, []);

  return {
    isSplitView,
    setIsSplitView,
    selectedPane,
    setSelectedPane,
    leftPath,
    setLeftPath,
    rightPath,
    setRightPath,
    leftItems,
    setLeftItems,
    rightItems,
    setRightItems,
    leftLoading,
    rightLoading,
    leftError,
    rightError,
    lastLoadedPanePathRef,
    getPanePath,
    loadPanePath,
    syncPanePair,
  };
}

export function PaneView({
  children,
  listDir,
  currentPath,
}: {
  children?: React.ReactNode | ((pane: ReturnType<typeof usePane>) => React.ReactNode);
  listDir?: (path: string) => Promise<PaneListDirResult>;
  currentPath?: string;
}) {
  const pane = usePane({ listDir, currentPath });

  return (
    <div style={{ width: "100%" }}>
      {typeof children === "function" ? children(pane) : children}
    </div>
  );
}
