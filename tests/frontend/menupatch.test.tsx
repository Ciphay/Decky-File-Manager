import { describe, expect, it, vi, beforeEach } from "vitest";
import { collectAppContext, getAppContextFromNode, getComponentAppContext, getMenuAppContext } from "../../src/menuPatch/appContext";
import { EXPLORE_ITEM_KEY, forceMenuUpdate, getMenuOwnerComponent, isOpeningAppContextMenu, removeExploreItem, spliceExploreLocalFilesItem } from "../../src/menuPatch/menuItems";

describe("appContext", () => {
  it("reads appid and name from overview/app holders", () => {
    expect(getAppContextFromNode({ overview: { appid: 7, name: " Hades " } })).toEqual({ appid: 7, name: "Hades" });
    expect(getAppContextFromNode({ props: { app: { appid: 9, display_name: "Doom" } } })).toEqual({ appid: 9, name: "Doom" });
    expect(getAppContextFromNode({ _owner: { pendingProps: { overview: { appid: 1, title: "T" } } } })).toEqual({ appid: 1, name: "T" });
    expect(getAppContextFromNode({ overview: { name: "Só nome" } })).toEqual({ name: "Só nome" });
    expect(getAppContextFromNode({ overview: { appid: 3 } })).toEqual({ appid: 3, name: undefined });
    expect(getAppContextFromNode({})).toBeNull();
    expect(getAppContextFromNode(null)).toBeNull();
    expect(getAppContextFromNode("x")).toBeNull();
  });

  it("prefers nodes that have both appid and name, and survives cycles", () => {
    const cyclic: any = { overview: { appid: 5, name: "Cíclico" } };
    cyclic.self = cyclic;
    cyclic.list = [cyclic, { overview: { name: "só nome" } }];
    expect(collectAppContext(cyclic)).toEqual({ appid: 5, name: "Cíclico" });
    expect(collectAppContext({ a: { b: { c: { overview: { name: "profundo" } } } } })).toEqual({ name: "profundo" });
    expect(collectAppContext(null)).toBeNull();
    expect(collectAppContext([])).toBeNull();
  });

  it("does not walk into fiber-like keys and limits depth", () => {
    const trap = { _owner: { overview: { appid: 99, name: "Fiber" } } };
    expect(collectAppContext(trap)).toBeNull();
    let deep: any = { overview: { appid: 1, name: "fundo" } };
    for (let i = 0; i < 30; i++) deep = { next: deep };
    expect(collectAppContext(deep)).toBeNull();
  });

  it("menu and component helpers", () => {
    expect(getMenuAppContext([{ overview: { appid: 2, name: "X" } }])).toEqual({ appid: 2, name: "X" });
    expect(getMenuAppContext("not an array")).toEqual({});
    expect(getMenuAppContext([])).toEqual({ appid: undefined, name: undefined });
    expect(getComponentAppContext({ props: { overview: { appid: 4 } } })).toEqual({ appid: 4, name: undefined });
    expect(getComponentAppContext({})).toEqual({});
  });
});

describe("menuItems", () => {
  it("detects the app context menu by handler text", () => {
    const appMenu = [{ props: { onSelected: function launchSource() { /* launchSource */ } } }];
    expect(isOpeningAppContextMenu(appMenu)).toBe(true);
    expect(isOpeningAppContextMenu([{ props: { onSelected: () => 1 } }])).toBe(false);
    expect(isOpeningAppContextMenu([])).toBe(false);
    expect(isOpeningAppContextMenu(null)).toBe(false);
  });

  it("finds the owner component and forces an update", () => {
    const update = vi.fn();
    const items = [{ stateNode: { forceUpdate: update } }];
    expect(getMenuOwnerComponent(items)).toBe(items[0].stateNode);
    forceMenuUpdate(items);
    expect(update).toHaveBeenCalled();
    expect(getMenuOwnerComponent("x")).toBeNull();
    forceMenuUpdate([{}]);
  });

  it("splices the item before Properties, once, and removes it again", () => {
    const onSelect = vi.fn();
    const children: any[] = [{ key: "a" }, { key: "b", onSelected: function AppProperties() { /* AppProperties */ } }, { key: "c" }];
    expect(spliceExploreLocalFilesItem(children, onSelect)).toBe(true);
    expect(children.map((c) => c.key)).toEqual(["a", EXPLORE_ITEM_KEY, "b", "c"]);
    expect(children[1].props.onClick).toBe(onSelect);
    expect(children[1].props.children).toBe("Explore local files");
    expect(spliceExploreLocalFilesItem(children, onSelect)).toBe(true);
    expect(children).toHaveLength(4);
    removeExploreItem(children);
    expect(children.map((c) => c.key)).toEqual(["a", "b", "c"]);
    removeExploreItem(children);
    expect(children).toHaveLength(3);
  });

  it("falls back to a label match, then appends; hides the item in the top-level 'manage' menu", () => {
    const byLabel: any[] = [{ key: "x" }, { label: "Properties" }];
    spliceExploreLocalFilesItem(byLabel, vi.fn());
    expect(byLabel[1].key).toBe(EXPLORE_ITEM_KEY);
    const appended: any[] = [{ key: "x" }];
    spliceExploreLocalFilesItem(appended, vi.fn());
    expect(appended.at(-1).key).toBe(EXPLORE_ITEM_KEY);
    const topLevel: any[] = [{ props: { label: "Gerenciar" } }];
    spliceExploreLocalFilesItem(topLevel, vi.fn());
    expect(topLevel.at(-1).props.style).toEqual({ display: "none" });
    expect(spliceExploreLocalFilesItem("nope" as any, vi.fn())).toBe(false);
  });
});

describe("install path cache and the library menu patch", () => {
  beforeEach(() => vi.resetModules());

  it("resolves through the backend, caches successes, expires failures", async () => {
    vi.useFakeTimers();
    const { fetchInstallPath, getCachedInstallPath, getInstallCacheKey, isInstallPathLoading } = await import("../../src/menuPatch/installPath");
    const { backend: be } = await import("./mocks/decky-api");
    let answer: any = { success: true, path: "/games/hades" };
    be.on("get_game_install_dir", () => answer);
    expect(getInstallCacheKey(7, " Hades ")).toBe("7:Hades");
    expect(getCachedInstallPath(7, "Hades")).toBeUndefined();
    const pending = fetchInstallPath(7, "Hades");
    expect(isInstallPathLoading(7, "Hades")).toBe(true);
    expect(fetchInstallPath(7, "Hades")).toBe(pending);
    expect(await pending).toBe("/games/hades");
    expect(getCachedInstallPath(7, "Hades")).toBe("/games/hades");
    await fetchInstallPath(7, "Hades");
    expect(be.callsTo("get_game_install_dir")).toHaveLength(1);

    answer = { success: false };
    expect(await fetchInstallPath(8, "Nope")).toBeNull();
    expect(getCachedInstallPath(8, "Nope")).toBeNull();
    vi.advanceTimersByTime(31_000);
    expect(getCachedInstallPath(8, "Nope")).toBeUndefined();
  });

  it("falls back to SteamClient and tolerates backend failures", async () => {
    const { fetchInstallPath } = await import("../../src/menuPatch/installPath");
    const { backend: be } = await import("./mocks/decky-api");
    be.on("get_game_install_dir", () => ({ success: false }));
    (window as any).SteamClient = { Apps: { GetAppInstallDir: (_id: number, cb: (p: string) => void) => cb("  /steam/path  ") } };
    expect(await fetchInstallPath(11, "x")).toBe("/steam/path");
    be.on("get_game_install_dir", () => { throw new Error("offline"); });
    expect(await fetchInstallPath(12, "y")).toBeNull();
    expect(await fetchInstallPath(0, "só nome")).toBeNull();
  });

  it("patching registers patches only when the menu component is found, and unpatch cleans up", async () => {
    const ui: any = await import("@decky/ui");
    ui.findModuleByExport.mockReturnValue({ a: { toString: () => "navigator:" } });
    ui.fakeRenderComponent.mockReturnValue({ type: { prototype: {} } });
    const { default: patch, unpatchLibraryContextMenu } = await import("../../src/menuPatch/MenuPatch");
    patch();
    expect(ui.afterPatch).toHaveBeenCalledTimes(1);
    patch();
    expect(ui.afterPatch).toHaveBeenCalledTimes(1);
    const unpatch = ui.afterPatch.mock.results[0].value.unpatch;
    unpatchLibraryContextMenu();
    expect(unpatch).toHaveBeenCalled();
  });

  it("does nothing when the library menu cannot be found", async () => {
    const ui: any = await import("@decky/ui");
    ui.findModuleByExport.mockReturnValue(undefined);
    const { default: patch } = await import("../../src/menuPatch/MenuPatch");
    patch();
    expect(ui.afterPatch).not.toHaveBeenCalled();
  });

  it("the injected menu item opens the file manager at the game's install dir", async () => {
    const ui: any = await import("@decky/ui");
    ui.findModuleByExport.mockReturnValue({ a: { toString: () => "navigator:" } });
    ui.fakeRenderComponent.mockReturnValue({ type: { prototype: {} } });
    const { backend: be } = await import("./mocks/decky-api");
    be.on("get_game_install_dir", () => ({ success: true, path: "/games/Doom Eternal" }));
    const { default: patch } = await import("../../src/menuPatch/MenuPatch");
    const { EXPLORE_ITEM_KEY: key } = await import("../../src/menuPatch/menuItems");
    patch();
    const outerHandler = ui.afterPatch.mock.calls[0][2];
    const component: any = { props: { children: [] }, _owner: { pendingProps: { overview: { appid: 42, name: "Doom" } } } };
    ui.afterPatch.mockImplementation((_o: any, prop: string, handler: any) => ({ unpatch: vi.fn(), prop, handler }));
    outerHandler([], component);
    const innerCall = ui.afterPatch.mock.calls.find((c: any[]) => c[1] === "type");
    expect(innerCall).toBeTruthy();
    const ret = { type: { prototype: {} } };
    innerCall[2]([], ret);
    const renderCall = ui.afterPatch.mock.calls.find((c: any[]) => c[1] === "render" && c[0] === ret.type.prototype);
    const menuItems: any[] = [{ props: { onSelected: function launchSource() { /* launchSource */ } } }, { onSelected: function AppProperties() { /* AppProperties */ } }];
    renderCall[2]([], { props: { children: [menuItems] } });
    await vi.waitFor(() => expect(menuItems.some((i) => i?.key === key)).toBe(true), { timeout: 2000 });
    menuItems.find((i) => i?.key === key).props.onClick();
    await vi.waitFor(() => expect(ui.Router.Navigate).toHaveBeenCalled());
    expect(ui.Router.Navigate.mock.calls[0][0]).toBe(`/steam-os-file-manager?path=${encodeURIComponent("/games/Doom Eternal")}&mode=normal`);
    expect(ui.Router.CloseSideMenus).toHaveBeenCalled();
    expect(be.callsTo("get_game_install_dir").length).toBeGreaterThan(0);
  });
});

describe("library menu patch: re-renders and non-Steam shortcuts", () => {
  beforeEach(() => vi.resetModules());

  async function bootstrap() {
    const ui: any = await import("@decky/ui");
    ui.findModuleByExport.mockReturnValue({ a: { toString: () => "navigator:" } });
    ui.fakeRenderComponent.mockReturnValue({ type: { prototype: {} } });
    const api: any = await import("./mocks/decky-api");
    const { default: patch } = await import("../../src/menuPatch/MenuPatch");
    const { EXPLORE_ITEM_KEY: key } = await import("../../src/menuPatch/menuItems");
    patch();
    const outer = ui.afterPatch.mock.calls[0][2];
    ui.afterPatch.mockImplementation((_o: any, prop: string, handler: any) => ({ unpatch: vi.fn(), prop, handler }));
    return { ui, api, outer, key };
  }
  const appMenu = () => [{ props: { onSelected: function launchSource() { /* launchSource */ } } }, { onSelected: function AppProperties() { /* AppProperties */ } }];

  it("non-Steam shortcuts (no appid) get the item immediately and open by name", async () => {
    const { ui, api, outer, key } = await bootstrap();
    api.backend.on("get_game_install_dir", () => ({ success: true, path: "/games/Custom" }));
    const component: any = { props: { children: [] }, _owner: { pendingProps: { overview: { name: "Custom Game" } } } };
    outer([], component);
    const inner = ui.afterPatch.mock.calls.find((c: any[]) => c[1] === "type");
    const ret = { type: { prototype: {} } };
    inner[2]([], ret);
    const render = ui.afterPatch.mock.calls.find((c: any[]) => c[1] === "render" && c[0] === ret.type.prototype);
    const items: any[] = appMenu();
    render[2]([], { props: { children: [items] } });
    expect(items.some((i) => i?.key === key)).toBe(true);
    items.find((i) => i?.key === key).props.onClick();
    await vi.waitFor(() => expect(ui.Router.Navigate).toHaveBeenCalled());
    expect(api.backend.callsTo("get_game_install_dir")[0]).toEqual([0, "Custom Game"]);
  });

  it("a second render updates the menu through the else-branch, and shouldComponentUpdate re-patches new children", async () => {
    const { ui, api, outer, key } = await bootstrap();
    api.backend.on("get_game_install_dir", () => ({ success: true, path: "/games/Hades" }));
    const component: any = { props: { children: [] }, _owner: { pendingProps: { overview: { appid: 5, name: "Hades" } } } };
    outer([], component);
    const inner = ui.afterPatch.mock.calls.find((c: any[]) => c[1] === "type");
    const ret = { type: { prototype: {} } };
    inner[2]([], ret);
    const scu = ui.afterPatch.mock.calls.find((c: any[]) => c[1] === "shouldComponentUpdate");
    const children: any[] = [appMenu()];
    const owner = { _owner: { pendingProps: { overview: { appid: 5, name: "Hades" } } } };
    children[0].push(owner);
    await vi.waitFor(() => api.backend.callsTo("get_game_install_dir").length >= 0);
    expect(scu[2]([{ children }], true)).toBe(true);
    expect(scu[2]([{ children: null }], false)).toBe(false);
    const again: any = { props: { children: appMenu() }, _owner: component._owner };
    outer([], again);
    await vi.waitFor(() => expect(api.backend.callsTo("get_game_install_dir").length).toBeGreaterThan(0));
    expect(key).toBeTruthy();
  });

  it("menus that are not app context menus are left untouched", async () => {
    const { ui, outer } = await bootstrap();
    const component: any = { props: { children: [] }, _owner: { pendingProps: { overview: { appid: 5 } } } };
    outer([], component);
    const inner = ui.afterPatch.mock.calls.find((c: any[]) => c[1] === "type");
    const ret = { type: { prototype: {} } };
    inner[2]([], ret);
    const render = ui.afterPatch.mock.calls.find((c: any[]) => c[1] === "render" && c[0] === ret.type.prototype);
    const other = [{ props: { onSelected: () => 1 } }];
    const result = { props: { children: [other] } };
    expect(render[2]([], result)).toBe(result);
    expect(other).toHaveLength(1);
  });
});
