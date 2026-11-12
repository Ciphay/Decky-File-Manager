import { Router } from "@decky/ui";
import { getScreenshotsDir } from "../api";
import { setSelectionIntent } from "../utils/launchIntent";
import { isGamepadUi } from "./steamEnv";

type AnyFn = (...args: any[]) => any;

const openManagerAt = (path: string) => {
  setSelectionIntent(null);
  Router.CloseSideMenus?.();
  Router.Navigate?.(`/steam-os-file-manager?path=${encodeURIComponent(path)}&mode=normal`);
};

const wrap = (target: any, name: string, handler: (original: AnyFn, args: unknown[]) => unknown | false): (() => void) => {
  const original: AnyFn | undefined = target?.[name];
  if (typeof original !== "function") return () => undefined;

  const bound: AnyFn = original.bind(target);
  const hooked: AnyFn = (...args: unknown[]) => {
    if (!isGamepadUi()) return bound(...args);
    try {
      const result = handler(bound, args);
      return result === false ? bound(...args) : result;
    } catch (e) {
      console.warn(`Decky File Manager: ${name} hook failed, using the system file manager`, e);
      return bound(...args);
    }
  };

  target[name] = hooked;
  return () => {
    if (target[name] === hooked) target[name] = original;
  };
};

const openScreenshots = (appid: number): unknown => {
  void getScreenshotsDir(appid || 0).then((result) => {
    if (result?.success && result.path) openManagerAt(result.path);
  });
  return undefined;
};

export function installExplorerHooks(): () => void {
  const client = (window as any).SteamClient;
  const restorers = [
    wrap(client?.System, "OpenLocalDirectoryInSystemExplorer", (_original, [path]) => {
      if (typeof path !== "string" || !path) return false;
      openManagerAt(path);
      return undefined;
    }),
    wrap(client?.InstallFolder, "BrowseFilesInFolder", async (original, [folderIndex]) => {
      const folders = (await client.InstallFolder.GetInstallFolders?.()) as Array<{ nFolderIndex: number; strFolderPath: string }> | undefined;
      const folder = folders?.find((entry) => entry.nFolderIndex === folderIndex);
      if (!folder?.strFolderPath) return original(folderIndex);
      openManagerAt(`${folder.strFolderPath.replace(/\/+$/, "")}/steamapps`);
      return undefined;
    }),
    wrap(client?.Screenshots, "ShowScreenshotsOnDisk", (_original, [appid]) => openScreenshots(Number(appid) || 0)),
    wrap(client?.Apps, "BrowseScreenshotsForApp", (_original, [appid]) => openScreenshots(Number(appid) || 0)),
    wrap(client?.Apps, "BrowseScreenshotForApp", (_original, [appid]) => openScreenshots(Number(appid) || 0)),
  ];
  return () => restorers.forEach((restore) => restore());
}
