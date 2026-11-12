import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { backend } from "./mocks/decky-api";

const gamepad = () => { (window as any).SteamUIStore = { WindowStore: { GamepadUIMainWindowInstance: {} } }; };

async function load() {
  vi.resetModules();
  const hook = await import("../../src/fileDialog/fileDialogHook");
  const session = await import("../../src/fileDialog/pickerSession");
  const ui: any = await import("@decky/ui");
  return { ...hook, ...session, ui };
}

function installSystem(original = vi.fn(async () => "/native/path")) {
  const system = { OpenFileDialog: original };
  (window as any).SteamClient = { System: system };
  return { system, original };
}

describe("file dialog hook", () => {
  beforeEach(() => gamepad());

  it("replaces OpenFileDialog and restores it on uninstall", async () => {
    const { installFileDialogHook, ui } = await load();
    const { Router, Navigation } = ui as any;
    const { system, original } = installSystem();
    const restore = installFileDialogHook();
    expect(system.OpenFileDialog).not.toBe(original);
    restore();
    expect(system.OpenFileDialog).toBe(original);
  });

  it("is a no-op without the Steam API", async () => {
    const { installFileDialogHook, ui } = await load();
    const { Router, Navigation } = ui as any;
    (window as any).SteamClient = undefined;
    expect(() => installFileDialogHook()()).not.toThrow();
  });

  it("outside the gamepad UI, uses the native dialog", async () => {
    (window as any).SteamUIStore = undefined;
    const { installFileDialogHook, ui } = await load();
    const { Router, Navigation } = ui as any;
    const { system, original } = installSystem();
    installFileDialogHook();
    expect(await system.OpenFileDialog({ strTitle: "x" })).toBe("/native/path");
    expect(original).toHaveBeenCalled();
    expect(Router.Navigate).not.toHaveBeenCalled();
  });

  it("opens the picker route and resolves with the chosen path (folders get a trailing slash)", async () => {
    const { installFileDialogHook, PICK_ROUTE, getActivePickSession, ui } = await load();
    const { Router, Navigation } = ui as any;
    const { system } = installSystem();
    installFileDialogHook();
    vi.useFakeTimers();
    const promise = system.OpenFileDialog({ strTitle: "Escolher", strInitialFile: "/usr/bin/", bChooseDirectory: true });
    expect(Router.Navigate).toHaveBeenCalledWith(PICK_ROUTE);
    expect(Router.CloseSideMenus).toHaveBeenCalled();
    const session = getActivePickSession()!;
    expect(session.request).toMatchObject({ title: "Escolher", chooseDirectory: true });
    expect(session.startPath).toBe("/usr/bin/");
    session.resolve("/home/u/Downloads");
    expect(getActivePickSession()).toBeNull();
    expect(Navigation.NavigateBack).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    await expect(promise).resolves.toBe("/home/u/Downloads/");
  });

  it("files keep their path as-is and filters become patterns", async () => {
    const { installFileDialogHook, getActivePickSession, ui } = await load();
    const { Router, Navigation } = ui as any;
    const { system } = installSystem();
    installFileDialogHook();
    vi.useFakeTimers();
    const promise = system.OpenFileDialog({
      strTitle: "Jogo", strInitialFile: "/usr/bin/tool",
      rgFilters: [{ strFileTypeName: "Apps", rFilePatterns: ["*.sh", "*.AppImage"], bUseAsDefault: true }, { strFileTypeName: "Todos", rFilePatterns: ["*"] }],
    });
    const session = getActivePickSession()!;
    expect(session.startPath).toBe("/usr/bin");
    expect(session.canShowAll).toBe(true);
    expect(session.patterns!.some((p) => p.test("run.sh"))).toBe(true);
    session.resolve("/x/run.sh");
    await vi.advanceTimersByTimeAsync(300);
    await expect(promise).resolves.toBe("/x/run.sh");
  });

  it("cancel rejects with the code Steam expects and navigates back", async () => {
    const { installFileDialogHook, getActivePickSession, ui } = await load();
    const { Router, Navigation } = ui as any;
    const { system } = installSystem();
    installFileDialogHook();
    vi.useFakeTimers();
    const promise = system.OpenFileDialog({ strTitle: "x" });
    const assertion = expect(promise).rejects.toEqual({ result: 52, message: "" });
    getActivePickSession()!.cancel();
    await vi.advanceTimersByTimeAsync(300);
    await assertion;
    expect(Navigation.NavigateBack).toHaveBeenCalled();
  });

  it("abandon rejects without navigating, and later calls are ignored", async () => {
    const { installFileDialogHook, getActivePickSession, ui } = await load();
    const { Router, Navigation } = ui as any;
    const { system } = installSystem();
    installFileDialogHook();
    const promise = system.OpenFileDialog({});
    const session = getActivePickSession()!;
    const assertion = expect(promise).rejects.toEqual({ result: 52, message: "" });
    session.abandon();
    session.resolve("/late");
    await assertion;
    expect(Navigation.NavigateBack).not.toHaveBeenCalled();
  });

  it("while a picker is open, new calls use the native dialog", async () => {
    const { installFileDialogHook, getActivePickSession, ui } = await load();
    const { Router, Navigation } = ui as any;
    const { system, original } = installSystem();
    installFileDialogHook();
    const first = system.OpenFileDialog({});
    expect(await system.OpenFileDialog({ strTitle: "second" })).toBe("/native/path");
    expect(original).toHaveBeenCalledTimes(1);
    getActivePickSession()!.abandon();
    await first.catch(() => undefined);
  });

  it("falls back to the native dialog when navigation throws", async () => {
    const { installFileDialogHook, getActivePickSession, ui } = await load();
    const { Router, Navigation } = ui as any;
    const { system } = installSystem();
    installFileDialogHook();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    (Router.Navigate as any).mockImplementationOnce(() => { throw new Error("no router"); });
    expect(await system.OpenFileDialog({})).toBe("/native/path");
    expect(getActivePickSession()).toBeNull();
  });

  it("the picker session store notifies subscribers", async () => {
    const { setActivePickSession, subscribeActivePickSession, getActivePickSession } = await load();
    const listener = vi.fn();
    const unsubscribe = subscribeActivePickSession(listener);
    const fake: any = { request: {} };
    setActivePickSession(fake);
    expect(getActivePickSession()).toBe(fake);
    setActivePickSession(null);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    setActivePickSession(fake);
    expect(listener).toHaveBeenCalledTimes(2);
    setActivePickSession(null);
  });
});

describe("PickRoute", () => {
  beforeEach(() => vi.resetModules());

  it("renders the manager in pick mode while a session is active, and abandons on unmount", async () => {
    vi.doMock("../../src/FileManagerPage", () => ({ default: ({ pick }: any) => <div data-testid="page">{pick.request.title}</div> }));
    const { default: PickRoute } = await import("../../src/fileDialog/PickRoute");
    const { setActivePickSession } = await import("../../src/fileDialog/pickerSession");
    const abandon = vi.fn();
    setActivePickSession({ request: { title: "Escolher" }, abandon } as any);
    const { getByTestId, unmount } = render(<PickRoute />);
    expect(getByTestId("page").textContent).toBe("Escolher");
    act(() => setActivePickSession(null));
    expect(getByTestId("page").textContent).toBe("Escolher");
    unmount();
    expect(abandon).toHaveBeenCalled();
    vi.doUnmock("../../src/FileManagerPage");
  });

  it("goes back when opened without a session", async () => {
    vi.doMock("../../src/FileManagerPage", () => ({ default: () => <div /> }));
    const { default: PickRoute } = await import("../../src/fileDialog/PickRoute");
    const ui: any = await import("@decky/ui");
    render(<PickRoute />);
    expect(ui.Navigation.NavigateBack).toHaveBeenCalled();
    vi.doUnmock("../../src/FileManagerPage");
  });
});

describe("explorer hooks", () => {
  beforeEach(() => gamepad());

  async function loadExplorer() {
    vi.resetModules();
    const explorer = await import("../../src/fileDialog/explorerHooks");
    const ui: any = await import("@decky/ui");
    const api: any = await import("./mocks/decky-api");
    return { ...explorer, ui, backend: api.backend };
  }

  const client = () => ({
    System: { OpenLocalDirectoryInSystemExplorer: vi.fn(() => "native-explorer") },
    InstallFolder: { BrowseFilesInFolder: vi.fn(() => "native-browse"), GetInstallFolders: vi.fn(async () => [{ nFolderIndex: 1, strFolderPath: "/mnt/sd/SteamLibrary/" }]) },
    Screenshots: { ShowScreenshotsOnDisk: vi.fn(() => "native-shots") },
    Apps: { BrowseScreenshotsForApp: vi.fn(() => "native"), BrowseScreenshotForApp: vi.fn(() => "native") },
  });

  it("opens the plugin manager for 'show in system explorer'", async () => {
    const { installExplorerHooks, ui } = await loadExplorer();
    const steam = client();
    (window as any).SteamClient = steam;
    installExplorerHooks();
    steam.System.OpenLocalDirectoryInSystemExplorer("/games/Hades");
    expect(ui.Router.Navigate).toHaveBeenCalledWith(`/steam-os-file-manager?path=${encodeURIComponent("/games/Hades")}&mode=normal`);
    expect(ui.Router.CloseSideMenus).toHaveBeenCalled();
  });

  it("falls back to the native call for invalid arguments, desktop UI and errors", async () => {
    const { installExplorerHooks, ui } = await loadExplorer();
    const steam = client();
    const nativeExplorer = steam.System.OpenLocalDirectoryInSystemExplorer;
    (window as any).SteamClient = steam;
    installExplorerHooks();
    expect((steam.System.OpenLocalDirectoryInSystemExplorer as any)("")).toBe("native-explorer");
    (window as any).SteamUIStore = undefined;
    expect((steam.System.OpenLocalDirectoryInSystemExplorer as any)("/x")).toBe("native-explorer");
    expect(nativeExplorer).toHaveBeenCalledTimes(2);
    expect(ui.Router.Navigate).not.toHaveBeenCalled();
    gamepad();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    ui.Router.Navigate.mockImplementationOnce(() => { throw new Error("boom"); });
    expect((steam.System.OpenLocalDirectoryInSystemExplorer as any)("/x")).toBe("native-explorer");
  });

  it("storage browse opens the library's steamapps folder", async () => {
    const { installExplorerHooks, ui } = await loadExplorer();
    const steam = client();
    (window as any).SteamClient = steam;
    installExplorerHooks();
    await (steam.InstallFolder.BrowseFilesInFolder as any)(1);
    expect(ui.Router.Navigate).toHaveBeenCalledWith(`/steam-os-file-manager?path=${encodeURIComponent("/mnt/sd/SteamLibrary/steamapps")}&mode=normal`);
    ui.Router.Navigate.mockClear();
    await (steam.InstallFolder.BrowseFilesInFolder as any)(99);
    expect(ui.Router.Navigate).not.toHaveBeenCalled();
  });

  it("screenshots open the backend-resolved folder", async () => {
    const { installExplorerHooks, ui, backend: be } = await loadExplorer();
    be.on("get_screenshots_dir", (appid: number) => (appid === 730 ? { success: true, path: "/shots/730" } : { success: false }));
    const steam = client();
    (window as any).SteamClient = steam;
    installExplorerHooks();
    (steam.Screenshots.ShowScreenshotsOnDisk as any)(730);
    await vi.waitFor(() => expect(ui.Router.Navigate).toHaveBeenCalled());
    expect(ui.Router.Navigate.mock.calls[0][0]).toContain(encodeURIComponent("/shots/730"));
    ui.Router.Navigate.mockClear();
    (steam.Apps.BrowseScreenshotsForApp as any)(999);
    (steam.Apps.BrowseScreenshotForApp as any)(0);
    await new Promise((r) => setTimeout(r, 20));
    expect(ui.Router.Navigate).not.toHaveBeenCalled();
    expect(be.callsTo("get_screenshots_dir")).toEqual([[730], [999], [0]]);
  });

  it("restores every original on uninstall and tolerates missing APIs", async () => {
    const { installExplorerHooks } = await loadExplorer();
    const steam = client();
    const originals = [steam.System.OpenLocalDirectoryInSystemExplorer, steam.InstallFolder.BrowseFilesInFolder, steam.Screenshots.ShowScreenshotsOnDisk, steam.Apps.BrowseScreenshotsForApp, steam.Apps.BrowseScreenshotForApp];
    (window as any).SteamClient = steam;
    installExplorerHooks()();
    expect([steam.System.OpenLocalDirectoryInSystemExplorer, steam.InstallFolder.BrowseFilesInFolder, steam.Screenshots.ShowScreenshotsOnDisk, steam.Apps.BrowseScreenshotsForApp, steam.Apps.BrowseScreenshotForApp]).toEqual(originals);
    (window as any).SteamClient = {};
    expect(() => installExplorerHooks()()).not.toThrow();
    expect(backend.calls).toBeDefined();
  });
});
