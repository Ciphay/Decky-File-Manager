import { ComponentType } from "react";
import { definePlugin, routerHook } from "@decky/api";
import { SteamIcon } from "./Icons";
import Content from "./PluginContent";
import FileManagerPage from "./FileManagerPage";
import TextEditor from "./TextEditor";
import patchLibraryContextMenu, { unpatchLibraryContextMenu } from "./menuPatch/MenuPatch";
import { startBackgroundPolling } from "./backgroundPolling";
import { PICK_ROUTE, installFileDialogHook } from "./fileDialog/fileDialogHook";
import PickRoute from "./fileDialog/PickRoute";
import { installExplorerHooks } from "./fileDialog/explorerHooks";
import { isGamescopeSession } from "./api";
import { installFolderMenus } from "./steamMenus/folderMenus";

const ROUTES: Array<[string, ComponentType]> = [
  ["/steam-os-file-manager", FileManagerPage],
  ["/steam-os-file-manager/select", FileManagerPage],
  ["/steam-os-file-manager/select-file", FileManagerPage],
  [PICK_ROUTE, PickRoute],
  ["/decky-manager/text-editor", TextEditor],
];

export default definePlugin(() => {
  ROUTES.forEach(([path, component]) => routerHook.addRoute(path, component));
  patchLibraryContextMenu();
  const stopPolling = startBackgroundPolling();
  const restoreFileDialog = installFileDialogHook();
  const restoreExplorer = installExplorerHooks();
  let restoreFolderMenus: () => void = () => undefined;
  let dismounted = false;
  isGamescopeSession()
    .then((session) => {
      if (session?.gamescope && !dismounted) restoreFolderMenus = installFolderMenus();
    })
    .catch(() => undefined);

  return {
    name: "Decky File Manager",
    content: <Content />,
    icon: <SteamIcon />,
    onDismount() {
      stopPolling();
      restoreFileDialog();
      restoreExplorer();
      dismounted = true;
      restoreFolderMenus();
      unpatchLibraryContextMenu();
      ROUTES.forEach(([path]) => routerHook.removeRoute(path));
    },
  };
});
