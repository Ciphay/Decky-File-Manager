import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { backend, toaster } from "./mocks/decky-api";
import { showModal } from "./mocks/decky-ui";
import { usePanes } from "../../src/hooks/usePanes";
import { KEYBOARD_BACK_GRACE_MS, useInputGuards } from "../../src/hooks/useInputGuards";
import { useOverlayState } from "../../src/hooks/useOverlayState";
import { useBackgroundOperations } from "../../src/hooks/useBackgroundOperations";
import { useModalHost } from "../../src/hooks/useModalHost";
import { addBackgroundOperation, updateBackgroundOperations } from "../../src/utils/backgroundStore";

const listing = (path: string, names: string[] = ["a.txt"]) => ({ path, items: names.map((name) => ({ name, path: `${path}/${name}`, is_dir: false, size: 1, modified: 0 })) });

describe("usePanes", () => {
  it("loads a directory into the left pane and reports success", async () => {
    backend.on("list_dir", (p: string) => listing(p === "~" ? "/home/u" : p));
    const { result } = renderHook(() => usePanes());
    expect(result.current.panes.left.loading).toBe(true);
    let ok = false;
    await act(async () => { ok = await result.current.loadPane("left", "~"); });
    expect(ok).toBe(true);
    expect(result.current.panes.left).toMatchObject({ path: "/home/u", loading: false, error: null });
    expect(result.current.panes.left.items).toHaveLength(1);
    expect(result.current.getPath("left")).toBe("/home/u");
    expect(result.current.getPath("right")).toBe("/home/u");
  });

  it("keeps old items and exposes the error message on failure", async () => {
    backend.on("list_dir", (p: string) => (p === "/bad" ? { success: false, error: "Sem permissão" } : listing(p)));
    const { result } = renderHook(() => usePanes());
    await act(async () => { await result.current.loadPane("left", "/ok"); });
    let ok = true;
    await act(async () => { ok = await result.current.loadPane("left", "/bad"); });
    expect(ok).toBe(false);
    expect(result.current.panes.left.error).toBe("Sem permissão");
    expect(result.current.panes.left.path).toBe("/ok");
    expect(result.current.panes.left.items).toHaveLength(1);
    backend.on("list_dir", () => { throw new Error("rpc down"); });
    await act(async () => { await result.current.loadPane("left", "/x"); });
    expect(result.current.panes.left.error).toBe("rpc down");
  });

  it("ignores stale responses (last request wins)", async () => {
    const resolvers: Array<(v: any) => void> = [];
    backend.on("list_dir", () => new Promise((resolve) => resolvers.push(resolve)));
    const { result } = renderHook(() => usePanes());
    let first!: Promise<boolean>, second!: Promise<boolean>;
    act(() => { first = result.current.loadPane("left", "/one"); second = result.current.loadPane("left", "/two"); });
    await act(async () => { resolvers[1](listing("/two")); await second; });
    await act(async () => { resolvers[0](listing("/one")); expect(await first).toBe(false); });
    expect(result.current.panes.left.path).toBe("/two");
  });

  it("navigates up with a focus request for the folder we left", async () => {
    backend.on("list_dir", (p: string) => listing(p));
    const { result } = renderHook(() => usePanes());
    await act(async () => { await result.current.loadPane("left", "/a/b"); });
    act(() => { expect(result.current.goUp("left")).toBe(true); });
    await waitFor(() => expect(result.current.panes.left.path).toBe("/a"));
    expect(result.current.consumeFocusRequest("left")).toBe("/a/b");
    expect(result.current.consumeFocusRequest("left")).toBeNull();
    expect(result.current.consumeFocusRequest("right")).toBeNull();
    await act(async () => { await result.current.loadPane("left", "/"); });
    expect(result.current.goUp("left")).toBe(false);
  });

  it("split view copies the left pane, selects sides and collapses back", async () => {
    backend.on("list_dir", (p: string) => listing(p));
    const { result } = renderHook(() => usePanes());
    await act(async () => { await result.current.loadPane("left", "/left"); });
    expect(result.current.activeSide).toBe("left");
    act(() => result.current.setSplit(true));
    expect(result.current.isSplit).toBe(true);
    expect(result.current.panes.right.path).toBe("/left");
    await act(async () => { await result.current.loadPane("right", "/right"); });
    act(() => result.current.setSelectedSide("right"));
    expect(result.current.activeSide).toBe("right");
    act(() => result.current.setSplit(false));
    expect(result.current.isSplit).toBe(false);
    expect(result.current.activeSide).toBe("left");
    expect(result.current.panes.left.path).toBe("/right");
  });

  it("refreshVisible only reloads panes that show the target directory", async () => {
    backend.on("list_dir", (p: string) => listing(p));
    const { result } = renderHook(() => usePanes());
    await act(async () => { await result.current.loadPane("left", "/left"); });
    act(() => result.current.setSplit(true));
    await act(async () => { await result.current.loadPane("right", "/right"); });
    backend.calls = [];
    await act(async () => { await result.current.refreshVisible("/right/"); });
    expect(backend.callsTo("list_dir")).toEqual([["/right"]]);
    backend.calls = [];
    await act(async () => { await result.current.refreshVisible(); });
    expect(backend.callsTo("list_dir")).toHaveLength(2);
    await act(async () => { await result.current.refresh("left"); });
  });
});

describe("useInputGuards", () => {
  it("tracks focus and keyboard state per input and resets on keyboard dismiss", () => {
    let dismiss: () => void = () => undefined;
    const unregister = vi.fn();
    (window as any).SteamClient = { Input: { RegisterForUserDismissKeyboardMessages: (cb: () => void) => { dismiss = cb; return { unregister }; } } };
    const { result, unmount } = renderHook(() => useInputGuards());
    expect(result.current.isKeyboardOpen()).toBe(false);
    act(() => result.current.bind("path").onFocus());
    expect(result.current.guardsRef.current.path).toEqual({ focused: true, keyboardOpen: true });
    expect(result.current.isKeyboardOpen()).toBe(true);
    dismiss();
    expect(result.current.guardsRef.current.path.keyboardOpen).toBe(false);
    expect(result.current.isKeyboardOpen()).toBe(false);
    act(() => result.current.bind("rename").onFocus());
    act(() => result.current.bind("rename").onBlur());
    expect(result.current.guardsRef.current.rename).toEqual({ focused: false, keyboardOpen: false });
    unmount();
    expect(unregister).toHaveBeenCalled();
  });

  it("consumeKeyboardBack swallows the B that closes the keyboard, then lets the next one through", () => {
    vi.useFakeTimers();
    try {
      let dismiss: () => void = () => undefined;
      (window as any).SteamClient = { Input: { RegisterForUserDismissKeyboardMessages: (cb: () => void) => { dismiss = cb; return { unregister: vi.fn() }; } } };
      const { result } = renderHook(() => useInputGuards());
      expect(result.current.consumeKeyboardBack()).toBe(false);

      act(() => result.current.bind("rename").onFocus());
      expect(result.current.consumeKeyboardBack()).toBe(true);
      expect(result.current.consumeKeyboardBack()).toBe(true);
      expect(result.current.isKeyboardOpen()).toBe(false);
      vi.advanceTimersByTime(KEYBOARD_BACK_GRACE_MS + 10);
      expect(result.current.consumeKeyboardBack()).toBe(false);

      act(() => result.current.bind("rename").onFocus());
      dismiss();
      expect(result.current.consumeKeyboardBack()).toBe(true);
      vi.advanceTimersByTime(KEYBOARD_BACK_GRACE_MS + 10);
      expect(result.current.consumeKeyboardBack()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("activating a still-focused input reopens the keyboard flag", () => {
    const { result } = renderHook(() => useInputGuards());
    const binding = result.current.bind("rename");
    binding.onActivate();
    expect(result.current.isKeyboardOpen()).toBe(false);
    act(() => binding.onFocus());
    result.current.guardsRef.current.rename.keyboardOpen = false;
    binding.onActivate();
    expect(result.current.isKeyboardOpen()).toBe(true);
  });

  it("works without the Steam input API", () => {
    const { result } = renderHook(() => useInputGuards());
    expect(result.current.isKeyboardOpen()).toBe(false);
  });
});

describe("useOverlayState", () => {
  it("clears the context menu and reports open overlays", () => {
    const { result, rerender } = renderHook(({ dialog }) => useOverlayState(dialog), { initialProps: { dialog: false } });
    expect(result.current.isAnyOverlayOpen()).toBe(false);
    rerender({ dialog: true });
    expect(result.current.isAnyOverlayOpen()).toBe(true);
    const Hide = vi.fn();
    result.current.contextMenuRef.current = { Hide };
    act(() => result.current.clearContextMenu());
    expect(Hide).toHaveBeenCalled();
    expect(result.current.contextMenuRef.current).toBeNull();
    expect(result.current.lastRemovedAtRef.current).toBeGreaterThan(0);
    act(() => result.current.clearContextMenu());
    expect(Hide).toHaveBeenCalledTimes(1);
  });

  it("drops a stale context menu handle when no menu element is visible", () => {
    const { result } = renderHook(() => useOverlayState(false));
    result.current.contextMenuRef.current = { Hide: vi.fn() };
    expect(result.current.isAnyOverlayOpen()).toBe(false);
    expect(result.current.contextMenuRef.current).toBeNull();
  });

  it("swallows errors thrown by Hide and marks removal time", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { result } = renderHook(() => useOverlayState(false));
    result.current.contextMenuRef.current = { Hide: () => { throw new Error("gone"); } };
    act(() => result.current.clearContextMenu());
    expect(result.current.contextMenuRef.current).toBeNull();
    act(() => result.current.markOverlayRemoved());
    expect(result.current.lastRemovedAtRef.current).toBeGreaterThan(0);
  });
});

describe("useBackgroundOperations and useModalHost", () => {
  it("re-renders when the store changes", () => {
    updateBackgroundOperations(() => []);
    const { result } = renderHook(() => useBackgroundOperations());
    expect(result.current).toEqual([]);
    act(() => addBackgroundOperation({ operationId: "a", label: "x", progress: 1, paused: false }));
    expect(result.current).toHaveLength(1);
  });

  it("shows, updates and closes the modal content", async () => {
    vi.useFakeTimers();
    const handle = { Close: vi.fn(), Update: vi.fn() };
    (showModal as any).mockReturnValue(handle);
    const { rerender, unmount } = renderHook(({ content }) => useModalHost(content), { initialProps: { content: null as any } });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(showModal).not.toHaveBeenCalled();
    rerender({ content: "A" });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(showModal).toHaveBeenCalledWith("A");
    rerender({ content: "B" });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(handle.Update).toHaveBeenCalledWith("B");
    rerender({ content: null });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(handle.Close).toHaveBeenCalled();
    rerender({ content: "C" });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    unmount();
    expect(handle.Close.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(toaster.toast).not.toHaveBeenCalled();
  });
});
