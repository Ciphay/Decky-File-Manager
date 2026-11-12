import { ReactElement, cloneElement, createElement } from "react";
import { MenuItem } from "@decky/ui";
import { t } from "../i18n";
import { ComponentRule, installComponentRules } from "./jsxHook";

const STORAGE_TOKEN = "#ContentManagement_BrowseFolder";
const SCREENSHOT_TOKEN = "#ScreenshotUploader_ShowOnDisk";
const BROWSE_SLOT = 3;

const localize = (token: string, fallbackKey: string): string => {
  const localized = (window as any).LocalizationManager?.LocalizeString?.(token);
  return typeof localized === "string" && localized && localized !== token ? localized : t(fallbackKey);
};

const hasMenuItem = (children: unknown[], label: string): boolean =>
  children.some((child: any) => child && typeof child === "object" && child.props?.children === label);

const withMenuItem = (menu: any, key: string, label: string, onSelected: () => void, slot?: number): any => {
  const children = menu?.props?.children;
  if (!Array.isArray(children) || hasMenuItem(children, label)) return menu;

  const item = createElement(MenuItem, { key, onSelected }, label);
  const next = [...children];
  if (slot !== undefined && slot < next.length && !next[slot]) next[slot] = item;
  else next.push(item);
  return cloneElement(menu as ReactElement, { children: next } as any);
};

const withScreenshotOption = (out: any, label: string, onSelected: () => void): any => {
  const options = out?.props?.additionalOptions;
  if (Array.isArray(options)) {
    if (options.some((option: any) => option?.label === label)) return out;
    return cloneElement(out as ReactElement, { additionalOptions: [...options, { label, onSelected }] } as any);
  }
  return withMenuItem(out, "dfm-show-on-disk", label, onSelected);
};

const storageRule: ComponentRule = {
  matchesProps: (props) => typeof props.folder?.nFolderIndex === "number" && "fnEject" in props,
  matchesSource: (source) => source.includes(STORAGE_TOKEN),
  wrap: (original) => (props: any) => {
    const out = original(props);
    if (!props?.folder?.bIsMounted) return out;
    const label = localize(STORAGE_TOKEN, "steam.browse_folder");
    return withMenuItem(out, "dfm-browse-folder", label, () => (window as any).SteamClient?.InstallFolder?.BrowseFilesInFolder?.(props.folder.nFolderIndex), BROWSE_SLOT);
  },
};

const screenshotRule: ComponentRule = {
  matchesProps: (props) => props.screenshot != null && props.screenshot.strGameID !== undefined,
  matchesSource: (source) => source.includes("ShowScreenshotsOnDisk"),
  wrap: (original) => (props: any) => {
    const out = original(props);
    if (props?.screenshot?.strGameID === undefined) return out;
    const label = localize(SCREENSHOT_TOKEN, "steam.show_on_disk");
    return withScreenshotOption(out, label, () => (window as any).SteamClient?.Screenshots?.ShowScreenshotsOnDisk?.(props.screenshot.strGameID));
  },
};

export function installFolderMenus(): () => void {
  return installComponentRules([storageRule, screenshotRule]);
}
