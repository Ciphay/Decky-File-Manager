import { Navigation, Router } from "@decky/ui";
import { patternsForDefaultFilter } from "./patterns";
import { PickFilter, PickRequest, PickSession, setActivePickSession } from "./pickerSession";
import { isGamepadUi } from "./steamEnv";
import { setSelectionIntent } from "../utils/launchIntent";

export const PICK_ROUTE = "/decky-manager/file-picker";

type DialogOptions = {
  strTitle?: string;
  strInitialFile?: string;
  bChooseDirectory?: boolean;
  rgFilters?: Array<{ strFileTypeName?: string; rFilePatterns?: string[]; bUseAsDefault?: boolean }>;
};

type OpenFileDialog = (options?: DialogOptions) => Promise<string>;

const NAVIGATE_BACK_SETTLE_MS = 280;

const cancelledError = () => ({ result: 52, message: "" });

const toRequest = (options: DialogOptions = {}): PickRequest => ({
  title: options.strTitle ?? "",
  initialPath: options.strInitialFile ?? "",
  chooseDirectory: Boolean(options.bChooseDirectory),
  filters: (options.rgFilters ?? []).map((filter): PickFilter => ({
    name: filter.strFileTypeName ?? "",
    patterns: filter.rFilePatterns ?? [],
    isDefault: Boolean(filter.bUseAsDefault),
  })),
});

const initialDirectory = (initialPath: string): string => {
  if (!initialPath) return "";
  if (initialPath.endsWith("/")) return initialPath;
  const slash = initialPath.lastIndexOf("/");
  return slash > 0 ? initialPath.slice(0, slash) : "/";
};

let pickerOpen = false;

const openPicker = (options: DialogOptions): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const request = toRequest(options);
    let settled = false;

    const finish = (action: () => void, navigateBack: boolean) => {
      if (settled) return;
      settled = true;
      pickerOpen = false;
      setActivePickSession(null);
      if (navigateBack) {
        Navigation.NavigateBack?.();
        window.setTimeout(action, NAVIGATE_BACK_SETTLE_MS);
      } else {
        action();
      }
    };

    const session: PickSession = {
      request,
      startPath: initialDirectory(request.initialPath),
      patterns: patternsForDefaultFilter(request.filters),
      canShowAll: request.filters.length > 1,
      resolve: (path) => finish(() => resolve(request.chooseDirectory && !path.endsWith("/") ? `${path}/` : path), true),
      cancel: () => finish(() => reject(cancelledError()), true),
      abandon: () => finish(() => reject(cancelledError()), false),
    };

    pickerOpen = true;
    setActivePickSession(session);
    try {
      setSelectionIntent(null);
      Router.CloseSideMenus?.();
      Router.Navigate?.(PICK_ROUTE);
    } catch (e) {
      pickerOpen = false;
      settled = true;
      setActivePickSession(null);
      reject(e);
    }
  });

export function installFileDialogHook(): () => void {
  const system = (window as any).SteamClient?.System;
  const original: OpenFileDialog | undefined = system?.OpenFileDialog;
  if (typeof original !== "function") {
    return () => undefined;
  }

  const bound: OpenFileDialog = original.bind(system);
  const hooked: OpenFileDialog = (options) => {
    if (pickerOpen || !isGamepadUi()) return bound(options);
    return openPicker(options ?? {}).catch((error) => {
      if (error && typeof error === "object" && (error as { result?: number }).result === 52) throw error;
      console.warn("Decky File Manager: file picker failed, using the system dialog", error);
      return bound(options);
    });
  };

  system.OpenFileDialog = hooked;
  return () => {
    if (system.OpenFileDialog === hooked) system.OpenFileDialog = original;
  };
}
