import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { backend } from "./mocks/decky-api";
import { useItemActions } from "../../src/hooks/useItemActions";
import { useGamepadButtons, type GamepadHandlers } from "../../src/hooks/useGamepadButtons";

const entry = { name: "a.txt", path: "/d/a.txt", is_dir: false, size: 1, modified: 0 };

describe("useItemActions error reporting", () => {
  const setup = () => {
    let dialog: any = null;
    const setDialog: any = vi.fn((u: any) => { dialog = typeof u === "function" ? u(dialog) : u; });
    const runOperation: any = vi.fn(async (_l: string, _a: any, options: any) => { options.onError(new Error("Sem permissão: x")); return null; });
    return { ...renderHook(() => useItemActions({ runOperation, setDialog })), getDialog: () => dialog };
  };

  it("permission errors from every operation open the permission dialog", async () => {
    const { result, getDialog } = setup();
    const checks: Array<() => Promise<void>> = [
      () => result.current.confirmCreateFolder({ kind: "createFolder", parentDir: "/d", name: "n" }),
      () => result.current.confirmRename({ kind: "rename", path: "/d/a", value: "b" }),
      () => result.current.confirmDelete({ kind: "delete", path: "/d/a", name: "a" }),
      () => result.current.extract(entry, "/out"),
    ];
    for (const run of checks) {
      await act(async () => { await run(); });
      expect(getDialog()).toMatchObject({ kind: "message", title: "Permission denied" });
    }
  });

  it("keeps the dialog state untouched when the properties request is for a stale dialog", async () => {
    const props = { name: "d", path: "/d/d", type: "folder", size: null, created: 1, modified: 1, permissions: { owner: "u", immutable: false, raw: "0o1" } };
    backend.on("get_properties", () => props);
    backend.on("get_directory_size", () => ({ size: 5, path: "/d/d" }));
    let dialog: any = null;
    const setDialog: any = (u: any) => { dialog = typeof u === "function" ? u(dialog) : u; if (dialog?.kind === "properties") dialog = { kind: "message", title: "x", message: "y" }; };
    const { result } = renderHook(() => useItemActions({ runOperation: vi.fn() as any, setDialog }));
    await act(async () => { await result.current.showProperties({ ...entry, name: "d", path: "/d/d", is_dir: true }); });
    expect(dialog).toMatchObject({ kind: "message" });
  });
});

describe("useGamepadButtons path-bar and keyboard branches", () => {
  let registered: any;
  const handlers = (extra: Partial<GamepadHandlers> = {}): GamepadHandlers => ({
    isQuickAccessVisible: false, hasDialog: false, isAnyOverlayOpen: () => false, isKeyboardOpen: () => false, consumeKeyboardBack: () => false, lastOverlayRemovedAt: () => 0,
    closeTopOverlay: vi.fn(() => false), openContextMenu: vi.fn(), goBack: vi.fn(), exitPlugin: vi.fn(), getScope: () => null, getPathInput: () => null,
    suppressPathFocus: vi.fn(), ...extra,
  });
  const press = (b: number, p: boolean) => act(() => registered(0, b, p));
  const install = () => { (window as any).SteamClient = { Input: { RegisterForControllerInputMessages: (cb: any) => { registered = cb; return { unregister: vi.fn() }; } } }; };

  it("B with the path input focused (no keyboard) blurs it and goes back immediately", () => {
    install();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const h = handlers({ getPathInput: () => input });
    renderHook(() => useGamepadButtons(h));
    press(1, true);
    expect(h.suppressPathFocus).toHaveBeenCalled();
    expect(h.goBack).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(input);
    press(1, false);
    expect(h.goBack).toHaveBeenCalledTimes(1);
    input.remove();
  });

  it("B with the virtual keyboard open blurs the text field instead of going back", () => {
    install();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const h = handlers({ isKeyboardOpen: () => true, consumeKeyboardBack: () => true, closeTopOverlay: vi.fn(() => false) });
    renderHook(() => useGamepadButtons(h));
    press(1, true); press(1, false);
    expect(document.activeElement).not.toBe(input);
    expect(h.goBack).not.toHaveBeenCalled();
    input.remove();
  });

  it("B while the keyboard is open inside a dialog only dismisses the keyboard: the dialog stays", () => {
    install();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const h = handlers({ hasDialog: true, consumeKeyboardBack: () => true });
    renderHook(() => useGamepadButtons(h));
    press(1, true); press(1, false);
    expect(h.closeTopOverlay).not.toHaveBeenCalled();
    expect(h.goBack).not.toHaveBeenCalled();
    expect(h.exitPlugin).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it("with the keyboard closed, B closes the dialog", () => {
    install();
    const h = handlers({ hasDialog: true, closeTopOverlay: vi.fn(() => true) });
    renderHook(() => useGamepadButtons(h));
    press(1, true); press(1, false);
    expect(h.closeTopOverlay).toHaveBeenCalledTimes(1);
  });

  it("Y is ignored while typing in a text field", () => {
    install();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const h = handlers();
    renderHook(() => useGamepadButtons(h));
    press(3, true);
    expect(h.openContextMenu).not.toHaveBeenCalled();
    input.remove();
  });

  it("an overlay outside the plugin scope blocks B, one containing the scope does not", () => {
    install();
    const scope = document.createElement("div");
    const wrapper = document.createElement("div");
    wrapper.setAttribute("role", "dialog");
    wrapper.getBoundingClientRect = () => ({ width: 10, height: 10 } as DOMRect);
    wrapper.appendChild(scope);
    document.body.appendChild(wrapper);
    const h = handlers({ getScope: () => scope });
    renderHook(() => useGamepadButtons(h));
    press(1, true); press(1, false);
    expect(h.goBack).toHaveBeenCalledTimes(1);
    const foreign = document.createElement("div");
    foreign.setAttribute("role", "menu");
    foreign.getBoundingClientRect = () => ({ width: 10, height: 10 } as DOMRect);
    document.body.appendChild(foreign);
    press(1, true); press(1, false);
    expect(h.goBack).toHaveBeenCalledTimes(1);
    foreign.remove(); wrapper.remove();
  });
});
