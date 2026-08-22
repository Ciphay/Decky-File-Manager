import { definePlugin, routerHook } from "@decky/api";
import { SteamIcon } from "./Icons";
import Content from "./PluginContent";
import FileManagerPage from "./FileManagerPage";
import TextEditor from "./TextEditor";
import patchLibraryContextMenu from "./MenuPatch";

routerHook.addRoute("/steam-os-file-manager", FileManagerPage);
routerHook.addRoute("/decky-manager/text-editor", TextEditor);

patchLibraryContextMenu();

export default definePlugin(() => {
  return {
    name: "Decky Manager",
    content: <Content />,
    icon: <SteamIcon />,
  };
});
