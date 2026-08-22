import { callable } from "@decky/api";
import { Router } from "@decky/ui";
import { t } from "./i18n";

const DEFAULT_MANAGER_PATH = "";

const getGameInstallDir = callable<[number, string | null], { success: boolean; path?: string; error?: string }>("get_game_install_dir");
const getNonSteamGameInstallDir = callable<[string | null], { success: boolean; path?: string; error?: string }>("get_nonsteam_game_install_dir");

const openNormalFileManager = (targetPath: string = DEFAULT_MANAGER_PATH) => {
  Router.CloseSideMenus?.();
  Router.Navigate?.(`/steam-os-file-manager?path=${encodeURIComponent(targetPath)}&mode=normal`);
};

const gameInstallPathCache = new Map<string, string | null>();
const gameInstallPathPromiseCache = new Map<string, Promise<string | null>>();
const registeredGameContexts = new Map<string, { appid?: number; name?: string }>();

const getInstallCacheKey = (appid?: number, name?: string) => {
  return `${typeof appid === "number" ? appid : 0}:${name?.trim() ?? ""}`;
};

const registerGameContext = (appid?: number, name?: string) => {
  if (typeof appid !== "number" && (!name || !name.trim())) {
    return;
  }

  const cacheKey = getInstallCacheKey(appid, name);
  if (registeredGameContexts.has(cacheKey)) {
    return;
  }
  registeredGameContexts.set(cacheKey, { appid, name });
};

const startInstallPathPrefetch = () => {
  if ((window as any).__deckyManagerInstallPrefetchStarted) {
    return;
  }
  (window as any).__deckyManagerInstallPrefetchStarted = true;

  window.setInterval(() => {
    for (const { appid, name } of registeredGameContexts.values()) {
      getRegisteredGameInstallPath(appid, name).catch(() => undefined);
    }
  }, 1000);
};

const getRegisteredGameInstallPathSync = (appid?: number, name?: string): string | null | undefined => {
  const cacheKey = getInstallCacheKey(appid, name);
  if (!gameInstallPathCache.has(cacheKey)) {
    return undefined;
  }
  return gameInstallPathCache.get(cacheKey) ?? null;
};

const getRegisteredGameInstallPath = async (appid?: number, name?: string): Promise<string | null> => {
  const cacheKey = getInstallCacheKey(appid, name);
  if (gameInstallPathCache.has(cacheKey)) {
    return gameInstallPathCache.get(cacheKey) ?? null;
  }
  if (gameInstallPathPromiseCache.has(cacheKey)) {
    return gameInstallPathPromiseCache.get(cacheKey)!;
  }

  const promise = (async () => {
    const normalizedName = typeof name === "string" ? name.trim() : "";

    if (normalizedName) {
      const shortcutResult = await getNonSteamGameInstallDir(normalizedName || null);
      if (shortcutResult?.success && shortcutResult.path) {
        gameInstallPathCache.set(cacheKey, shortcutResult.path);
        return shortcutResult.path;
      }
    }

    if (typeof appid === "number" && appid !== 0) {
      const backendResult = await getGameInstallDir(appid, normalizedName || null);
      if (backendResult?.success && backendResult.path) {
        gameInstallPathCache.set(cacheKey, backendResult.path);
        return backendResult.path;
      }
    }

    if (normalizedName) {
      const backendResult = await getGameInstallDir(0, normalizedName || null);
      if (backendResult?.success && backendResult.path) {
        gameInstallPathCache.set(cacheKey, backendResult.path);
        return backendResult.path;
      }
    }

    if (typeof appid !== "number" || appid === 0) {
      if (normalizedName) {
        return null;
      }
      gameInstallPathCache.set(cacheKey, null);
      return null;
    }

    const steamClient = (window as any).SteamClient;
    if (!steamClient?.Apps?.GetAppInstallDir) {
      gameInstallPathCache.set(cacheKey, null);
      return null;
    }

    const path = await new Promise<string | null>((resolve) => {
      try {
        steamClient.Apps.GetAppInstallDir(appid, (installPath: string | null | undefined) => {
          resolve(typeof installPath === "string" && installPath.trim() ? installPath.trim() : null);
        });
      } catch {
        resolve(null);
      }
    });

    gameInstallPathCache.set(cacheKey, path);
    return path;
  })();

  gameInstallPathPromiseCache.set(cacheKey, promise);
  const result = await promise;
  gameInstallPathPromiseCache.delete(cacheKey);
  return result;
};

const resolveGameInstallPath = async (appid?: number, name?: string) => {
  const path = await getRegisteredGameInstallPath(appid, name);
  return path ?? DEFAULT_MANAGER_PATH;
};

const openGameFileManager = async (appid?: number, name?: string) => {
  const targetPath = await resolveGameInstallPath(appid, name);
  openNormalFileManager(targetPath);
};

const getMenuOwnerComponent = (menuItems: unknown) => {
  if (!Array.isArray(menuItems)) {
    return null;
  }

  const found = (window as any).DFL?.findInReactTree(menuItems, (x: any) => {
    return x?.stateNode && typeof x.stateNode.forceUpdate === "function";
  }, { walkable: ["props", "children", "_owner"] });

  return found?.stateNode ?? null;
};

const isOpeningAppContextMenu = (items: unknown) => {
  if (!Array.isArray(items) || !items.length) {
    return false;
  }

  return !!(window as any).DFL?.findInReactTree(items, (x: any) => {
    const selectedHandler = x?.onSelected ?? x?.props?.onSelected;
    if (typeof selectedHandler !== "function") {
      return false;
    }

    const handlerText = selectedHandler.toString();
    return handlerText.includes("launchSource") || handlerText.includes("AppProperties") || handlerText.includes("RemoveShortcut") || handlerText.includes("ManageShortcut");
  });
};

const handleItemDupes = (items: unknown[]) => {
  const duplicateKeys = ["decky-manager-explore-local-files"];
  duplicateKeys.forEach((key) => {
    const deckyManagerIdx = items.findIndex((item: any) => item?.key === key);
    if (deckyManagerIdx !== -1) {
      items.splice(deckyManagerIdx, 1);
    }
  });
};

const getAppContextFromNode = (node: any): { appid?: number; name?: string } | null => {
  if (!node || typeof node !== "object") {
    return null;
  }

  const appidCandidates = [
    node?.overview?.appid,
    node?.app?.appid,
    node?.props?.overview?.appid,
    node?.props?.app?.appid,
    node?._owner?.pendingProps?.overview?.appid,
    node?._owner?.pendingProps?.app?.appid,
    node?._owner?.memoizedProps?.overview?.appid,
    node?._owner?.memoizedProps?.app?.appid,
  ];

  const nameCandidates = [
    node?.overview?.name,
    node?.overview?.displayName,
    node?.overview?.display_name,
    node?.overview?.title,
    node?.app?.name,
    node?.app?.displayName,
    node?.app?.display_name,
    node?.app?.title,
    node?.props?.overview?.name,
    node?.props?.overview?.displayName,
    node?.props?.overview?.display_name,
    node?.props?.overview?.title,
    node?.props?.app?.name,
    node?.props?.app?.displayName,
    node?.props?.app?.display_name,
    node?.props?.app?.title,
    node?._owner?.pendingProps?.overview?.name,
    node?._owner?.pendingProps?.overview?.displayName,
    node?._owner?.pendingProps?.overview?.display_name,
    node?._owner?.pendingProps?.overview?.title,
    node?._owner?.pendingProps?.app?.name,
    node?._owner?.pendingProps?.app?.displayName,
    node?._owner?.pendingProps?.app?.display_name,
    node?._owner?.pendingProps?.app?.title,
    node?._owner?.memoizedProps?.overview?.name,
    node?._owner?.memoizedProps?.overview?.displayName,
    node?._owner?.memoizedProps?.overview?.display_name,
    node?._owner?.memoizedProps?.overview?.title,
    node?._owner?.memoizedProps?.app?.name,
    node?._owner?.memoizedProps?.app?.displayName,
    node?._owner?.memoizedProps?.app?.display_name,
    node?._owner?.memoizedProps?.app?.title,
  ];

  const foundAppid = appidCandidates.find((candidate) => typeof candidate === "number");
  const foundName = nameCandidates.find((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0);

  if (typeof foundAppid === "number") {
    return {
      appid: Number(foundAppid),
      name: typeof foundName === "string" && foundName.trim() ? foundName.trim() : undefined,
    };
  }

  if (typeof foundName === "string" && foundName.trim()) {
    return {
      name: foundName.trim(),
    };
  }

  return null;
};

const getAppContextScore = (node: unknown, context: { appid?: number; name?: string } | null) => {
  if (!context) {
    return 0;
  }

  let score = 0;
  if (typeof context.appid === "number") {
    score += 200;
  }
  if (typeof context.name === "string" && context.name.trim()) {
    score += 80;
  }

  if (!node || typeof node !== "object") {
    return score;
  }

  const hasGameShape = !!(
    (node as any)?.overview ||
    (node as any)?.app ||
    (node as any)?.props?.overview ||
    (node as any)?.props?.app ||
    (node as any)?._owner?.pendingProps?.overview ||
    (node as any)?._owner?.pendingProps?.app ||
    (node as any)?._owner?.memoizedProps?.overview ||
    (node as any)?._owner?.memoizedProps?.app
  );

  if (hasGameShape) {
    score += 100;
  }

  return score;
};

const collectAppContext = (value: unknown): { appid?: number; name?: string } | null => {
  const candidates: Array<{ context: { appid?: number; name?: string }; score: number }> = [];

  const visit = (current: unknown) => {
    if (Array.isArray(current)) {
      for (const entry of current) {
        visit(entry);
      }
      return;
    }

    if (!current || typeof current !== "object") {
      return;
    }

    const directContext = getAppContextFromNode(current);
    if (directContext) {
      candidates.push({ context: directContext, score: getAppContextScore(current, directContext) });
    }

    for (const child of Object.values(current as Record<string, unknown>)) {
      if (child && typeof child === "object") {
        visit(child);
      }
    }
  };

  visit(value);

  if (!candidates.length) {
    return null;
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0].context;
};

const getMenuAppContext = (menuItems: unknown[]) => {
  if (!Array.isArray(menuItems)) {
    return { appid: undefined as number | undefined, name: undefined as string | undefined };
  }

  const foundContext = collectAppContext(menuItems);
  return {
    appid: foundContext?.appid,
    name: foundContext?.name,
  };
};

const getComponentAppContext = (component: any) => {
  const directContext = getAppContextFromNode(component);
  if (directContext) {
    return directContext;
  }

  const pendingProps = component?._owner?.pendingProps ?? component?.props ?? {};
  const memoizedProps = component?._owner?.memoizedProps ?? {};
  const overview = pendingProps?.overview ?? memoizedProps?.overview ?? pendingProps?.app ?? memoizedProps?.app ?? component?.props?.overview ?? component?.props?.app ?? {};

  const resolvedAppid = typeof overview?.appid === "number" ? Number(overview.appid) : undefined;
  const resolvedName = typeof overview?.name === "string" && overview.name.trim() ? overview.name.trim() : undefined;

  return { appid: resolvedAppid, name: resolvedName };
};

const spliceExploreLocalFilesItem = (children: unknown[], appid?: number, name?: string) => {
  if (!Array.isArray(children)) {
    return false;
  }

  if (children.some((item: any) => item?.key === "decky-manager-explore-local-files")) {
    return true;
  }

  const propertiesMenuItemIdx = children.findIndex((item: any) => {
    return (window as any).DFL?.findInReactTree(item, (x: any) => {
      return x?.onSelected && x.onSelected.toString().includes("AppProperties");
    });
  });

  const fallbackMenuItemIdx = propertiesMenuItemIdx === -1 ? children.findIndex((item: any) => {
    return (window as any).DFL?.findInReactTree(item, (x: any) => {
      const label = typeof x?.label === "string" ? x.label.toLowerCase() : "";
      const title = typeof x?.title === "string" ? x.title.toLowerCase() : "";
      return label === "properties" || title === "properties" || x?.key === "properties";
    });
  }) : -1;

  const insertIndex = propertiesMenuItemIdx !== -1
    ? propertiesMenuItemIdx
    : fallbackMenuItemIdx !== -1
      ? fallbackMenuItemIdx
      : children.length;

  handleItemDupes(children);
  const isTopLevelMenu = children.some((item: any) => {
    try {
      const label = typeof item?.props?.label === "string" ? item.props.label.toLowerCase() : "";
      const title = typeof item?.props?.title === "string" ? item.props.title.toLowerCase() : "";
      return label.includes("manage") || label.includes("gerenciar") || title.includes("manage") || title.includes("gerenciar");
    } catch (e) {
      return false;
    }
  });

  children.splice(insertIndex, 0, (
    (window as any).SP_REACT.createElement((window as any).DFL.MenuItem, {
      key: "decky-manager-explore-local-files",
      style: isTopLevelMenu ? { display: "none" } : undefined,
      role: isTopLevelMenu ? "presentation" : undefined,
      "aria-hidden": isTopLevelMenu ? true : undefined,
      tabIndex: isTopLevelMenu ? -1 : undefined,
      inert: isTopLevelMenu ? true : undefined,
      focusable: isTopLevelMenu ? false : undefined,
      disabled: isTopLevelMenu ? true : undefined,
      onClick: async () => {
        const resolvedAppid = typeof appid === "number" && appid !== 0 ? appid : undefined;
        const resolvedName = typeof name === "string" && name.trim() ? name.trim() : undefined;
        const context = getMenuAppContext(children);
        await openGameFileManager(resolvedAppid ?? context.appid, resolvedName || context.name);
      },
    }, t("action.explore_local_files"))
  ));

  return true;
};

const patchMenuItems = (menuItems: unknown[], appid?: number, name?: string) => {
  let updatedAppid = appid;
  let updatedName = name;

  const context = getMenuAppContext(menuItems);
  if (updatedAppid === undefined && context.appid !== undefined) {
    updatedAppid = context.appid;
  }
  if (!updatedName && context.name) {
    updatedName = context.name;
  }

  if (updatedAppid === appid && updatedAppid !== undefined) {
    const foundApp = (window as any).DFL?.findInTree(menuItems, (x: any) => typeof x?.app?.appid === "number", { walkable: ["props", "children"] });
    if (foundApp) {
      updatedAppid = Number(foundApp.app.appid);
      updatedName = foundApp.app?.name ?? updatedName;
    }
  }

  const parentOverview = menuItems.find((x: any) => {
    return x?._owner?.pendingProps?.overview?.appid && x._owner.pendingProps.overview.appid !== updatedAppid;
  }) as any;

  if (parentOverview) {
    updatedAppid = Number(parentOverview._owner?.pendingProps?.overview?.appid ?? updatedAppid);
    updatedName = parentOverview._owner?.pendingProps?.overview?.name ?? updatedName;
  }

  if (updatedAppid === undefined && updatedName) {
    updatedAppid = 0;
  }

  if (updatedAppid === undefined && !updatedName) {
    return false;
  }

  registerGameContext(updatedAppid, updatedName);

  const isSteamContext = typeof updatedAppid === "number" && updatedAppid !== 0;
  if (!isSteamContext) {
    const inserted = spliceExploreLocalFilesItem(menuItems, updatedAppid, updatedName);
    if (inserted) {
      const ownerComponent = getMenuOwnerComponent(menuItems);
      if (ownerComponent && typeof ownerComponent.forceUpdate === "function") {
        ownerComponent.forceUpdate();
      }
    }
    return inserted;
  }

  const cachedPath = getRegisteredGameInstallPathSync(updatedAppid, updatedName);
  if (cachedPath === null) {
    return false;
  }

  if (typeof cachedPath === "string" && cachedPath.trim()) {
    return spliceExploreLocalFilesItem(menuItems, updatedAppid, updatedName);
  }

  const cacheKey = getInstallCacheKey(updatedAppid, updatedName);
  if (!gameInstallPathPromiseCache.has(cacheKey)) {
    getRegisteredGameInstallPath(updatedAppid, updatedName).then((path) => {
      if (typeof path === "string" && path.trim()) {
        try {
          spliceExploreLocalFilesItem(menuItems, updatedAppid, updatedName);
          const ownerComponent = getMenuOwnerComponent(menuItems);
          if (ownerComponent && typeof ownerComponent.forceUpdate === "function") {
            ownerComponent.forceUpdate();
          }
        } catch (e) {
          console.warn("Decky Manager: failed to update library context menu after install check", e);
        }
      }
    });
  }

  return false;
};

const scheduleMenuPatch = (menuItems: unknown[], appid?: number, name?: string, attempt = 0) => {
  if (!Array.isArray(menuItems)) {
    return;
  }

  const didPatch = patchMenuItems(menuItems, appid, name);
  if (!didPatch && attempt < 3) {
    const delay = attempt === 0 ? 0 : 50;
    window.setTimeout(() => {
      scheduleMenuPatch(menuItems, appid, name, attempt + 1);
    }, delay);
  }
};

const patchLibraryContextMenu = () => {
  startInstallPathPrefetch();
  const DFL = (window as any).DFL;
  if (!DFL?.afterPatch || !DFL?.fakeRenderComponent || !DFL?.findModuleByExport || !DFL?.findInTree || !DFL?.findInReactTree) {
    return;
  }

  if ((window as any).__deckyManagerLibraryContextMenuPatched) {
    return;
  }
  (window as any).__deckyManagerLibraryContextMenuPatched = true;

  const LibraryContextMenu = DFL.fakeRenderComponent(
    Object.values(DFL.findModuleByExport((entry: any) => entry?.toString && entry.toString().includes("().LibraryContextMenu")))
      .find((sibling: any) => sibling?.toString?.().includes("navigator:"))
  )?.type;

  if (!LibraryContextMenu) {
    return;
  }

  const patches: { outer?: any; inner?: any; unpatch?: () => void } = { unpatch: () => undefined };

  patches.outer = DFL.afterPatch(LibraryContextMenu.prototype, "render", (_: unknown, component: any) => {
    const componentContext = getComponentAppContext(component);
    let appid: number | undefined = componentContext.appid;

    if (!appid && component._owner) {
      appid = component._owner.pendingProps?.overview?.appid;
    } else if (!appid) {
      const foundApp = DFL.findInTree(component.props.children, (x: any) => x?.app?.appid, { walkable: ["props", "children"] });
      if (foundApp) {
        appid = foundApp.app.appid;
      }
    }

    if (!patches.inner) {
      patches.inner = DFL.afterPatch(component, "type", (_: unknown, ret: any) => {
        DFL.afterPatch(ret?.type?.prototype, "render", function (this: any, _: unknown, ret2: any) {
          const menuItems = ret2?.props?.children?.[0];
          if (!isOpeningAppContextMenu(menuItems)) {
            return ret2;
          }

          try {
            handleItemDupes(menuItems);
            const menuContext = getMenuAppContext(menuItems);
            const resolvedAppid = componentContext.appid ?? menuContext.appid ?? appid;
            const resolvedName = componentContext.name ?? menuContext.name ?? component?._owner?.pendingProps?.overview?.name;
            scheduleMenuPatch(menuItems, resolvedAppid, resolvedName);
          } catch (e) {
            console.warn("Decky Manager: failed to patch library context menu", e);
          }

          return ret2;
        });

        DFL.afterPatch(ret?.type?.prototype, "shouldComponentUpdate", function (this: any, [nextProps]: [any], shouldUpdate: boolean) {
          try {
            handleItemDupes(nextProps?.children || []);
          } catch (e) {
            return shouldUpdate;
          }

          if (shouldUpdate === true) {
            const nextOwner = (nextProps?.children?.[0] as any)?._owner;
            const nextAppid = nextOwner?.pendingProps?.overview?.appid ?? appid;
            const nextName = nextOwner?.pendingProps?.overview?.name;
            const menuContext = getMenuAppContext(nextProps?.children || []);
            const resolvedAppid = nextAppid ?? menuContext.appid;
            const resolvedName = nextName ?? menuContext.name;
            scheduleMenuPatch(nextProps?.children || [], resolvedAppid, resolvedName);
          }

          return shouldUpdate;
        });

        return ret;
      });
    } else {
      try {
        const menuContext = getMenuAppContext(component?.props?.children || []);
        const resolvedAppid = componentContext.appid ?? menuContext.appid;
        const resolvedName = componentContext.name ?? menuContext.name ?? component?._owner?.pendingProps?.overview?.name;
        scheduleMenuPatch(component?.props?.children, resolvedAppid, resolvedName);
      } catch (e) {
        console.warn("Decky Manager: failed to update library context menu", e);
      }
    }

    return component;
  });

  patches.unpatch = () => {
    patches.outer?.unpatch?.();
    patches.inner?.unpatch?.();
  };

  return patches;
};

export default patchLibraryContextMenu;
