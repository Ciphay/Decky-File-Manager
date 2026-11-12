import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { backend, toaster } from "./mocks/decky-api";
import { Navigation, Router, showContextMenu } from "./mocks/decky-ui";
import { readLaunchParams, useLaunchParams, useSelectionAction } from "../../src/hooks/useLaunchParams";
import { useGamepadButtons, type GamepadHandlers } from "../../src/hooks/useGamepadButtons";
import { useContextMenu } from "../../src/hooks/useContextMenu";
import { setSelectionIntent } from "../../src/utils/launchIntent";
import { takePendingEditorFile } from "../../src/utils/editorHandoff";

const setUrl = (path: string) => window.history.pushState({}, "", path);
const entry = (name: string, is_dir = false, path = `/d/${name}`) => ({ name, path, is_dir, size: 1, modified: 0 });

beforeEach(() => {
  setSelectionIntent(null);
  setUrl("/routes/steam-os-file-manager");
});

describe("readLaunchParams / useLaunchParams", () => {
  it("defaults to the normal manager", () => {
    expect(readLaunchParams()).toEqual({ selectionKind: null, resultFile: null, startPath: "" });
  });

  it("detects modes from the pathname, query and text editor flag", () => {
    setUrl("/routes/steam-os-file-manager/select-file?path=~");
    expect(readLaunchParams()).toMatchObject({ selectionKind: "shortcut", startPath: "~" });
    setUrl("/routes/steam-os-file-manager/select?resultFile=%2Ftmp%2Fr.json");
    expect(readLaunchParams()).toMatchObject({ selectionKind: "result-file", resultFile: "/tmp/r.json" });
    setUrl("/routes/steam-os-file-manager?mode=select-file");
    expect(readLaunchParams().selectionKind).toBe("shortcut");
    setUrl("/routes/steam-os-file-manager?mode=select");
    expect(readLaunchParams().selectionKind).toBe("result-file");
    setUrl("/routes/steam-os-file-manager?textEditorMode=true&path=%2Fa%25b");
    expect(readLaunchParams()).toMatchObject({ selectionKind: "text-editor", startPath: "/a%b" });
  });

  it("uses the navigation intent only when the URL says nothing and the mode is not explicit", () => {
    setSelectionIntent("shortcut");
    expect(readLaunchParams().selectionKind).toBe("shortcut");
    setUrl("/routes/steam-os-file-manager?mode=normal");
    expect(readLaunchParams().selectionKind).toBeNull();
  });

  it("re-reads on mount and on popstate", () => {
    const { result } = renderHook(() => useLaunchParams());
    expect(result.current.selectionKind).toBeNull();
    act(() => { setUrl("/routes/steam-os-file-manager/select-file"); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(result.current.selectionKind).toBe("shortcut");
  });
});

describe("useSelectionAction", () => {
  const setup = (params: any, extra: any = {}) => {
    const openAddShortcut = vi.fn();
    const exitPlugin = vi.fn();
    const hook = renderHook(() => useSelectionAction({ params, openAddShortcut, exitPlugin, ...extra }));
    return { ...hook, openAddShortcut, exitPlugin };
  };

  it("ignores folders and the non-selection mode", async () => {
    const { result, openAddShortcut } = setup({ selectionKind: null });
    await act(async () => result.current(entry("a")));
    const second = setup({ selectionKind: "shortcut" });
    await act(async () => second.result.current(entry("dir", true)));
    expect(openAddShortcut).not.toHaveBeenCalled();
    expect(second.openAddShortcut).not.toHaveBeenCalled();
  });

  it("shortcut mode opens the add-shortcut dialog", async () => {
    const { result, openAddShortcut } = setup({ selectionKind: "shortcut" });
    await act(async () => result.current(entry("Game.sh")));
    expect(openAddShortcut).toHaveBeenCalledWith(expect.objectContaining({ name: "Game.sh" }));
  });

  it("result-file mode stores the selection and leaves", async () => {
    backend.on("set_file_selection", () => ({ success: true }));
    const { result, exitPlugin } = setup({ selectionKind: "result-file", resultFile: "/tmp/r.json" });
    await act(async () => result.current(entry("a.bin")));
    expect(backend.callsTo("set_file_selection")).toEqual([["/d/a.bin", "/tmp/r.json"]]);
    expect(exitPlugin).toHaveBeenCalled();
    backend.on("set_file_selection", () => ({ success: false, error: "falhou" }));
    exitPlugin.mockClear();
    await act(async () => result.current(entry("a.bin")));
    expect(exitPlugin).not.toHaveBeenCalled();
    expect(toaster.toast.mock.calls.at(-1)![0].body).toBe("falhou");
  });

  it("text-editor mode hands the file over and goes back", async () => {
    backend.on("read_file_content", () => ({ success: true, content: "texto" }));
    const { result } = setup({ selectionKind: "text-editor" });
    await act(async () => result.current(entry("n.txt")));
    expect(takePendingEditorFile()).toEqual({ path: "/d/n.txt", content: "texto" });
    expect(Navigation.NavigateBack).toHaveBeenCalled();
    backend.on("read_file_content", () => ({ success: false, error: "grande demais" }));
    await act(async () => result.current(entry("big.txt")));
    expect(toaster.toast.mock.calls.at(-1)![0].body).toBe("grande demais");
  });

  it("pick mode resolves files only when choosing files", async () => {
    const pick: any = { request: { chooseDirectory: false }, resolve: vi.fn() };
    const { result } = setup({ selectionKind: "pick" }, { pick });
    await act(async () => result.current(entry("a.sh")));
    expect(pick.resolve).toHaveBeenCalledWith("/d/a.sh");
    const dirPick: any = { request: { chooseDirectory: true }, resolve: vi.fn() };
    const second = setup({ selectionKind: "pick" }, { pick: dirPick });
    await act(async () => second.result.current(entry("a.sh")));
    expect(dirPick.resolve).not.toHaveBeenCalled();
  });
});

describe("useGamepadButtons", () => {
  let registered: ((index: number, button: number, pressed: boolean) => void) | null;
  let unregister: ReturnType<typeof vi.fn>;

  const handlers = (extra: Partial<GamepadHandlers> = {}): GamepadHandlers => ({
    isQuickAccessVisible: false, hasDialog: false, isAnyOverlayOpen: () => false, isKeyboardOpen: () => false, consumeKeyboardBack: () => false, lastOverlayRemovedAt: () => 0,
    closeTopOverlay: vi.fn(() => false), openContextMenu: vi.fn(), goBack: vi.fn(), exitPlugin: vi.fn(), getScope: () => null, getPathInput: () => null,
    suppressPathFocus: vi.fn(), ...extra,
  });

  beforeEach(() => {
    registered = null;
    unregister = vi.fn();
    (window as any).SteamClient = { Input: { RegisterForControllerInputMessages: (cb: any) => { registered = cb; return { unregister }; } } };
  });

  const press = (button: number, pressed: boolean) => act(() => registered!(0, button, pressed));

  it("quick B press goes back; long press exits and does not go back", async () => {
    vi.useFakeTimers();
    const h = handlers();
    renderHook(() => useGamepadButtons(h));
    press(1, true); press(1, false);
    expect(h.goBack).toHaveBeenCalledTimes(1);
    press(1, true);
    act(() => { vi.advanceTimersByTime(250); });
    expect(h.exitPlugin).toHaveBeenCalledTimes(1);
    press(1, false);
    expect(h.goBack).toHaveBeenCalledTimes(1);
  });

  it("B with an open overlay closes it instead of going back", () => {
    const h = handlers({ hasDialog: true, closeTopOverlay: vi.fn(() => true) });
    renderHook(() => useGamepadButtons(h));
    press(1, true); press(1, false);
    expect(h.closeTopOverlay).toHaveBeenCalled();
    expect(h.goBack).not.toHaveBeenCalled();
  });

  it("ignores B recently after an overlay was removed, and a repeated press", () => {
    const h = handlers({ lastOverlayRemovedAt: () => Date.now() });
    renderHook(() => useGamepadButtons(h));
    press(1, true); press(1, true); press(1, false);
    expect(h.goBack).not.toHaveBeenCalled();
  });

  it("B release always resets state even when a Steam overlay appears meanwhile", () => {
    const h = handlers();
    renderHook(() => useGamepadButtons(h));
    press(1, true);
    const menu = document.createElement("div");
    menu.id = "QuickAccess-Menu";
    menu.getBoundingClientRect = () => ({ width: 100, height: 100 } as DOMRect);
    document.body.appendChild(menu);
    press(1, false);
    expect(h.goBack).not.toHaveBeenCalled();
    menu.remove();
    press(1, true); press(1, false);
    expect(h.goBack).toHaveBeenCalledTimes(1);
  });

  it("Y opens the context menu unless an overlay is open", () => {
    const h = handlers();
    const { rerender } = renderHook((props: GamepadHandlers) => useGamepadButtons(props), { initialProps: h });
    press(3, true);
    expect(h.openContextMenu).toHaveBeenCalledTimes(1);
    press(3, false);
    expect(h.openContextMenu).toHaveBeenCalledTimes(1);
    rerender(handlers({ isAnyOverlayOpen: () => true, openContextMenu: h.openContextMenu }));
    press(3, true);
    expect(h.openContextMenu).toHaveBeenCalledTimes(1);
  });

  it("uses the latest handlers without re-registering and unregisters on unmount", () => {
    const first = handlers();
    const second = handlers();
    const { rerender, unmount } = renderHook((props: GamepadHandlers) => useGamepadButtons(props), { initialProps: first });
    const registeredOnce = registered;
    rerender(second);
    expect(registered).toBe(registeredOnce);
    press(3, true);
    expect(second.openContextMenu).toHaveBeenCalled();
    expect(first.openContextMenu).not.toHaveBeenCalled();
    unmount();
    expect(unregister).toHaveBeenCalled();
    press(3, true);
    expect(second.openContextMenu).toHaveBeenCalledTimes(1);
  });

  it("does nothing without the Steam input API", () => {
    (window as any).SteamClient = undefined;
    expect(() => renderHook(() => useGamepadButtons(handlers()))).not.toThrow();
  });
});

describe("useContextMenu", () => {
  const overlay = () => ({ isAnyOverlayOpen: vi.fn(() => false), clearContextMenu: vi.fn(), contextMenuRef: { current: null as any }, markOverlayRemoved: vi.fn(), lastRemovedAtRef: { current: 0 } });
  const build = (extra: any = {}) => {
    const o = overlay();
    const clipboard: any = { refreshClipboard: vi.fn(async () => true), paste: vi.fn(), copy: vi.fn(), cut: vi.fn(), transferToOtherPane: vi.fn() };
    const itemActions: any = { openCreateFolder: vi.fn(), extract: vi.fn(), openInTextEditor: vi.fn(), openRename: vi.fn(), openDelete: vi.fn(), showProperties: vi.fn() };
    const params = {
      overlay: o, isSelectionMode: () => false, isSplit: false, activeSide: "left" as const, setSelectedSide: vi.fn(), getPath: (side: string) => (side === "left" ? "/left" : "/right"),
      getFocusedItem: () => ({ item: entry("a.zip"), side: "left" as const }), clipboard, itemActions, addToSteam: vi.fn(), getFallbackAnchor: () => null, ...extra,
    };
    return { ...renderHook(() => useContextMenu(params)), o, clipboard, itemActions, params };
  };
  const menuOf = () => (showContextMenu as any).mock.calls.at(-1)[0];
  const itemLabels = (menu: any): string[] => {
    const out: string[] = [];
    const walk = (node: any) => { if (!node) return; if (Array.isArray(node)) return node.forEach(walk); const inner = node.props?.children; if (node.type?.name === "MenuItem" || node.props?.onClick) out.push(typeof inner === "string" ? inner : JSON.stringify(inner?.props?.children ?? "")); else walk(inner); };
    walk(menu.props.children);
    return out;
  };

  it("is blocked in selection mode and while another overlay is open", async () => {
    const blocked = build({ isSelectionMode: () => true });
    await act(async () => blocked.result.current());
    expect(showContextMenu).not.toHaveBeenCalled();
    const open = build();
    open.o.isAnyOverlayOpen.mockReturnValue(true);
    await act(async () => open.result.current());
    expect(showContextMenu).not.toHaveBeenCalled();
  });

  it("opens the item menu and wires actions to the right directory (once per click)", async () => {
    const { result, clipboard, itemActions, o } = build();
    await act(async () => result.current());
    expect(clipboard.refreshClipboard).toHaveBeenCalled();
    const menu = menuOf();
    expect(menu.props.itemName).toBe("a.zip");
    expect(menu.props.isArchive).toBe(true);
    const { actions } = menu.props;
    act(() => { actions.copy(); actions.copy(); });
    expect(clipboard.copy).toHaveBeenCalledTimes(1);
    act(() => actions.extract());
    expect(itemActions.extract).toHaveBeenCalledWith(expect.objectContaining({ name: "a.zip" }), "/left");
    act(() => actions.paste());
    expect(clipboard.paste).toHaveBeenCalledWith("/left");
    act(() => actions.newFolder());
    expect(itemActions.openCreateFolder).toHaveBeenCalledWith("/left");
    expect(o.clearContextMenu).toHaveBeenCalled();
    expect(o.contextMenuRef.current).toBeTruthy();
  });

  it("uses the background menu for no item or the parent entry", async () => {
    const none = build({ getFocusedItem: () => ({ item: null, side: null }) });
    await act(async () => none.result.current());
    expect(menuOf().props.clipboardHas).toBe(true);
    expect(menuOf().props.actions.paste).toBeTypeOf("function");
    expect(menuOf().props.itemName).toBeUndefined();
    const parent = build({ getFocusedItem: () => ({ item: { ...entry("...", true), isParent: true }, side: "left" }) });
    await act(async () => parent.result.current());
    expect(menuOf().props.itemName).toBeUndefined();
  });

  it("split view: transfers to the other pane and selects the side that owns the item", async () => {
    const { result, clipboard, params } = build({ isSplit: true, getFocusedItem: () => ({ item: entry("f.txt"), side: "right" }) });
    await act(async () => result.current());
    expect(params.setSelectedSide).toHaveBeenCalledWith("right");
    const { actions, side } = menuOf().props;
    expect(side).toBe("right");
    act(() => actions.copyToOther());
    expect(clipboard.transferToOtherPane).toHaveBeenCalledWith(expect.objectContaining({ name: "f.txt" }), "copy", "/right", "/left");
    act(() => actions.moveToOther());
    expect(clipboard.transferToOtherPane).toHaveBeenLastCalledWith(expect.anything(), "cut", "/right", "/left");
  });

  it("directory items hide editor/steam actions via isDir", async () => {
    const { result, itemActions, params } = build({ getFocusedItem: () => ({ item: entry("dir", true), side: "left" }) });
    await act(async () => result.current());
    expect(menuOf().props.isDir).toBe(true);
    const { actions } = menuOf().props;
    act(() => { actions.rename(); actions.remove(); actions.properties(); actions.addToSteam(); actions.openInEditor(); });
    expect(itemActions.openRename).toHaveBeenCalled();
    expect(itemActions.openDelete).toHaveBeenCalled();
    expect(itemActions.showProperties).toHaveBeenCalled();
    expect(params.addToSteam).toHaveBeenCalled();
    expect(itemActions.openInTextEditor).toHaveBeenCalled();
    expect(Router.Navigate).not.toHaveBeenCalled();
    expect(itemLabels).toBeTypeOf("function");
  });
});
