import { Router, afterPatch, fakeRenderComponent, findInTree, findModuleByExport } from "@decky/ui";
import { setSelectionIntent } from "../utils/launchIntent";
import { AppContext, getComponentAppContext, getMenuAppContext } from "./appContext";
import { fetchInstallPath, getCachedInstallPath, isInstallPathLoading } from "./installPath";
import { forceMenuUpdate, isOpeningAppContextMenu, removeExploreItem, spliceExploreLocalFilesItem } from "./menuItems";

type Unpatchable = { unpatch: () => void };

const openGameFileManager = async (appid?: number, name?: string) => {
  const path = (await fetchInstallPath(appid, name)) ?? "";
  setSelectionIntent(null);
  Router.CloseSideMenus?.();
  Router.Navigate?.(`/steam-os-file-manager?path=${encodeURIComponent(path)}&mode=normal`);
};

const resolveMenuContext = (menuItems: unknown[], appid?: number, name?: string): AppContext => {
  let resolvedAppid = appid;
  let resolvedName = name;

  const context = getMenuAppContext(menuItems);
  resolvedAppid ??= context.appid;
  resolvedName ||= context.name;

  if (resolvedAppid !== undefined && resolvedAppid === appid) {
    const foundApp = findInTree(menuItems, (x: any) => typeof x?.app?.appid === "number", { walkable: ["props", "children"] });
    if (foundApp) {
      resolvedAppid = Number(foundApp.app.appid);
      resolvedName = foundApp.app?.name ?? resolvedName;
    }
  }

  const parentOverview = menuItems.find((x: any) => {
    const overviewAppid = x?._owner?.pendingProps?.overview?.appid;
    return overviewAppid && overviewAppid !== resolvedAppid;
  }) as any;
  if (parentOverview) {
    const overview = parentOverview._owner.pendingProps.overview;
    resolvedAppid = Number(overview.appid ?? resolvedAppid);
    resolvedName = overview.name ?? resolvedName;
  }

  if (resolvedAppid === undefined && resolvedName) {
    resolvedAppid = 0;
  }
  return { appid: resolvedAppid, name: resolvedName };
};

const insertItem = (menuItems: unknown[], appid?: number, name?: string): boolean =>
  spliceExploreLocalFilesItem(menuItems, () => {
    const context = getMenuAppContext(menuItems);
    const resolvedAppid = typeof appid === "number" && appid !== 0 ? appid : context.appid;
    void openGameFileManager(resolvedAppid, name?.trim() || context.name);
  });

const patchMenuItems = (menuItems: unknown[], appid?: number, name?: string): boolean => {
  const { appid: finalAppid, name: finalName } = resolveMenuContext(menuItems, appid, name);
  if (finalAppid === undefined && !finalName) {
    return false;
  }

  const isSteamApp = typeof finalAppid === "number" && finalAppid !== 0;
  if (!isSteamApp) {
    const inserted = insertItem(menuItems, finalAppid, finalName);
    if (inserted) forceMenuUpdate(menuItems);
    return inserted;
  }

  const cachedPath = getCachedInstallPath(finalAppid, finalName);
  if (cachedPath === null) {
    return false;
  }
  if (cachedPath) {
    return insertItem(menuItems, finalAppid, finalName);
  }

  if (!isInstallPathLoading(finalAppid, finalName)) {
    void fetchInstallPath(finalAppid, finalName).then((path) => {
      if (path) {
        try {
          insertItem(menuItems, finalAppid, finalName);
          forceMenuUpdate(menuItems);
        } catch (e) {
          console.warn("Decky File Manager: failed to update library context menu after install check", e);
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
  if (!patchMenuItems(menuItems, appid, name) && attempt < 3) {
    window.setTimeout(() => scheduleMenuPatch(menuItems, appid, name, attempt + 1), attempt === 0 ? 0 : 50);
  }
};

const findLibraryContextMenu = () => {
  const moduleExports = findModuleByExport((entry: any) => entry?.toString && entry.toString().includes("().LibraryContextMenu"));
  if (!moduleExports) {
    return undefined;
  }
  const candidate = Object.values(moduleExports).find((sibling: any) => sibling?.toString?.().includes("navigator:"));
  return candidate ? fakeRenderComponent(candidate as Function)?.type : undefined;
};

let activePatches: Unpatchable[] = [];

export const unpatchLibraryContextMenu = () => {
  activePatches.forEach((patch) => patch?.unpatch?.());
  activePatches = [];
};

export default function patchLibraryContextMenu(): void {
  if (activePatches.length > 0) {
    return;
  }

  let LibraryContextMenu: any;
  try {
    LibraryContextMenu = findLibraryContextMenu();
  } catch (e) {
    console.warn("Decky File Manager: library context menu not found", e);
  }
  if (!LibraryContextMenu) {
    return;
  }

  const track = <T extends Unpatchable>(patch: T): T => {
    activePatches.push(patch);
    return patch;
  };

  let innerPatched = false;

  track(afterPatch(LibraryContextMenu.prototype, "render", (_args: unknown[], component: any) => {
    const componentContext = getComponentAppContext(component);
    const fallbackAppid: number | undefined = componentContext.appid ?? component?._owner?.pendingProps?.overview?.appid;
    const ownerName = () => component?._owner?.pendingProps?.overview?.name;

    if (!innerPatched) {
      innerPatched = true;
      track(afterPatch(component, "type", (_a: unknown[], ret: any) => {
        track(afterPatch(ret?.type?.prototype, "render", (_b: unknown[], ret2: any) => {
          const menuItems = ret2?.props?.children?.[0];
          if (!isOpeningAppContextMenu(menuItems)) {
            return ret2;
          }
          try {
            removeExploreItem(menuItems);
            const menuContext = getMenuAppContext(menuItems);
            scheduleMenuPatch(menuItems, componentContext.appid ?? menuContext.appid ?? fallbackAppid, componentContext.name ?? menuContext.name ?? ownerName());
          } catch (e) {
            console.warn("Decky File Manager: failed to patch library context menu", e);
          }
          return ret2;
        }));

        track(afterPatch(ret?.type?.prototype, "shouldComponentUpdate", ([nextProps]: any[], shouldUpdate: boolean) => {
          const children = nextProps?.children || [];
          try {
            removeExploreItem(children);
            if (shouldUpdate === true) {
              const nextOwner = children?.[0]?._owner?.pendingProps?.overview;
              const menuContext = getMenuAppContext(children);
              scheduleMenuPatch(children, nextOwner?.appid ?? fallbackAppid ?? menuContext.appid, nextOwner?.name ?? menuContext.name);
            }
          } catch (e) {
            console.warn("Decky File Manager: failed to refresh library context menu", e);
          }
          return shouldUpdate;
        }));
        return ret;
      }));
    } else {
      try {
        const children = component?.props?.children || [];
        const menuContext = getMenuAppContext(children);
        scheduleMenuPatch(children, componentContext.appid ?? menuContext.appid, componentContext.name ?? menuContext.name ?? ownerName());
      } catch (e) {
        console.warn("Decky File Manager: failed to update library context menu", e);
      }
    }
    return component;
  }));
}
