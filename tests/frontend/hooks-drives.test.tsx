import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { backend, toaster } from "./mocks/decky-api";
import { showContextMenu } from "./mocks/decky-ui";
import { useDriveActions } from "../../src/hooks/useDriveActions";
import type { DialogState } from "../../src/dialogs";
import type { DriveInfo } from "../../src/utils/drives";

const drive = (extra: Partial<DriveInfo> = {}): DriveInfo => ({
  name: "Jogos", path: "/dev/sdb1", kind: "internal", device: "/dev/sdb1", total: 100, free: null, mounted: false, fstype: "ext4", system: false, ...extra,
});

function setup(drives: DriveInfo[]) {
  let dialog: DialogState = null;
  const setDialog = vi.fn((update: any) => { dialog = typeof update === "function" ? update(dialog) : update; });
  const overlay: any = { isAnyOverlayOpen: vi.fn(() => false), clearContextMenu: vi.fn(), contextMenuRef: { current: null } };
  const params = { drives, setDialog, overlay, refreshDrives: vi.fn(async () => undefined), openPath: vi.fn(), onUnmounted: vi.fn() };
  const hook = renderHook(() => useDriveActions(params));
  return { ...hook, params, getDialog: () => dialog };
}

describe("useDriveActions", () => {
  it("opens mounted drives directly", () => {
    const { result, params } = setup([]);
    act(() => result.current.activate(drive({ mounted: true, path: "/run/media/u/Jogos" })));
    expect(params.openPath).toHaveBeenCalledWith("/run/media/u/Jogos");
    expect(backend.callsTo("mount_drive")).toHaveLength(0);
  });

  it("mounts an unmounted drive and opens its path", async () => {
    backend.on("mount_drive", () => ({ ok: true, path: "/run/media/u/Jogos" }));
    const { result, params } = setup([]);
    await act(async () => result.current.activate(drive()));
    expect(backend.callsTo("mount_drive")).toEqual([["/dev/sdb1", null, null]]);
    expect(params.openPath).toHaveBeenCalledWith("/run/media/u/Jogos");
    expect(params.refreshDrives).toHaveBeenCalled();
  });

  it("asks for the password, retries with it and handles a wrong password", async () => {
    backend.on("mount_drive", (_d: string, password: string | null) => {
      if (password === null) return { ok: false, needs_password: true };
      if (password === "wrong") return { ok: false, needs_password: true, wrong_password: true };
      return { ok: true, path: "/run/media/u/Jogos" };
    });
    const { result, params, getDialog } = setup([]);
    await act(async () => result.current.activate(drive()));
    const dialog = getDialog() as any;
    expect(dialog.kind).toBe("password");
    expect(dialog.title).toBe("Administrator password");

    await act(async () => dialog.submit("wrong"));
    expect((getDialog() as any).error).toBe("Wrong password, try again.");
    expect((getDialog() as any).kind).toBe("password");
    expect(params.openPath).not.toHaveBeenCalled();

    await act(async () => (getDialog() as any).submit("correct"));
    expect(getDialog()).toBeNull();
    expect(params.openPath).toHaveBeenCalledWith("/run/media/u/Jogos");
    expect(backend.callsTo("mount_drive").map((call) => call[1])).toEqual([null, "wrong", "correct"]);
  });

  it("encrypted drives ask for the passphrase first, retry on a wrong one and open the mounted path", async () => {
    backend.on("mount_drive", (_d: string, _pw: string | null, passphrase: string | null) => (
      passphrase === "good" ? { ok: true, path: "/run/media/u/Cofre" } : { ok: false, needs_passphrase: true, wrong_passphrase: true }
    ));
    const { result, params, getDialog } = setup([]);
    act(() => result.current.activate(drive({ name: "Cofre", encrypted: true })));
    expect(backend.callsTo("mount_drive")).toHaveLength(0);
    const dialog = getDialog() as any;
    expect(dialog.kind).toBe("password");
    expect(dialog.title).toBe("Unlock drive");
    expect(dialog.message).toBe("Enter the passphrase for Cofre.");

    await act(async () => dialog.submit("bad"));
    expect((getDialog() as any).error).toBe("Wrong passphrase, try again.");
    expect(params.openPath).not.toHaveBeenCalled();

    await act(async () => (getDialog() as any).submit("good"));
    expect(getDialog()).toBeNull();
    expect(params.openPath).toHaveBeenCalledWith("/run/media/u/Cofre");
    expect(backend.callsTo("mount_drive").map((call) => call[2])).toEqual(["bad", "good"]);
  });

  it("encrypted drive: unlock errors and RPC failures show a toast; sudo is asked only if needed", async () => {
    backend.on("mount_drive", () => ({ ok: false, error: "device busy" }));
    const first = setup([]);
    act(() => first.result.current.activate(drive({ encrypted: true })));
    await act(async () => (first.getDialog() as any).submit("x"));
    expect(first.getDialog()).toBeNull();
    expect(toaster.toast.mock.calls.at(-1)![0].body).toBe("device busy");

    backend.on("mount_drive", () => { throw new Error("rpc"); });
    const second = setup([]);
    act(() => second.result.current.activate(drive({ encrypted: true })));
    await act(async () => (second.getDialog() as any).submit("x"));
    expect(second.getDialog()).toBeNull();

    backend.on("mount_drive", (_d: string, pw: string | null, passphrase: string | null) => {
      if (passphrase && !pw) return { ok: false, needs_password: true };
      return { ok: true, path: "/run/media/u/Cofre" };
    });
    const third = setup([]);
    act(() => third.result.current.activate(drive({ encrypted: true })));
    await act(async () => (third.getDialog() as any).submit("pass"));
    expect((third.getDialog() as any).title).toBe("Administrator password");
  });

  it("reports mount errors with a toast", async () => {
    backend.on("mount_drive", () => ({ ok: false, error: "bad superblock" }));
    const { result, params } = setup([]);
    await act(async () => result.current.activate(drive()));
    expect(toaster.toast.mock.calls.at(-1)![0].body).toBe("bad superblock");
    expect(params.openPath).not.toHaveBeenCalled();
    backend.on("mount_drive", () => { throw new Error("rpc"); });
    await act(async () => result.current.activate(drive()));
    expect(toaster.toast.mock.calls.at(-1)![0].body).toBe("rpc");
  });

  it("ignores drives without a device", async () => {
    const { result } = setup([]);
    await act(async () => result.current.activate(drive({ device: null })));
    expect(backend.callsTo("mount_drive")).toHaveLength(0);
  });

  it("builds the Y menu only for non-system drives and respects overlays", () => {
    const mounted = drive({ mounted: true, path: "/run/media/u/Jogos" });
    const { result, params } = setup([mounted, drive({ path: "/home/u", system: true, kind: "home", device: null })]);
    act(() => result.current.openDriveMenu("/home/u"));
    expect(showContextMenu).not.toHaveBeenCalled();
    act(() => result.current.openDriveMenu("/missing"));
    expect(showContextMenu).not.toHaveBeenCalled();
    params.overlay.isAnyOverlayOpen.mockReturnValue(true);
    act(() => result.current.openDriveMenu(mounted.path));
    expect(showContextMenu).not.toHaveBeenCalled();
    params.overlay.isAnyOverlayOpen.mockReturnValue(false);
    act(() => result.current.openDriveMenu(mounted.path));
    const menu: any = (showContextMenu as any).mock.calls[0][0];
    const labels = menu.props.children.filter(Boolean).map((child: any) => child.props.children);
    expect(labels).toEqual(["Rename", "Unmount"]);
    expect(params.overlay.contextMenuRef.current).toBeTruthy();
  });

  it("hides Unmount for unmounted drives", () => {
    const { result } = setup([drive()]);
    act(() => result.current.openDriveMenu("/dev/sdb1"));
    const menu: any = (showContextMenu as any).mock.calls[0][0];
    expect(menu.props.children.filter(Boolean).map((c: any) => c.props.children)).toEqual(["Rename"]);
  });

  it("menu actions open the rename dialog and unmount (leaving the unmounted path)", async () => {
    backend.on("unmount_drive", () => ({ ok: true }));
    const mounted = drive({ mounted: true, path: "/run/media/u/Jogos" });
    const { result, params, getDialog } = setup([mounted]);
    act(() => result.current.openDriveMenu(mounted.path));
    const children = (showContextMenu as any).mock.calls[0][0].props.children.filter(Boolean);
    act(() => children[0].props.onClick());
    expect(getDialog()).toEqual({ kind: "driveRename", device: "/dev/sdb1", value: "Jogos" });
    await act(async () => children[1].props.onClick());
    expect(backend.callsTo("unmount_drive")).toEqual([["/dev/sdb1", null]]);
    expect(params.onUnmounted).toHaveBeenCalledWith("/run/media/u/Jogos");
    expect(params.refreshDrives).toHaveBeenCalled();
    act(() => children[1].props.onClick());
    expect(backend.callsTo("unmount_drive")).toHaveLength(1);
  });

  it("renames through the backend, with the password flow", async () => {
    backend.on("rename_drive", (_d: string, _l: string, password: string | null) => (password ? { ok: true, label: "Novo" } : { ok: false, needs_password: true }));
    const { result, params, getDialog } = setup([]);
    await act(async () => result.current.confirmRename({ kind: "driveRename", device: "/dev/sdb1", value: "  Novo  " }));
    expect(backend.callsTo("rename_drive")[0]).toEqual(["/dev/sdb1", "Novo", null]);
    await act(async () => (getDialog() as any).submit("pw"));
    expect(backend.callsTo("rename_drive")[1]).toEqual(["/dev/sdb1", "Novo", "pw"]);
    expect(params.refreshDrives).toHaveBeenCalled();
    await act(async () => result.current.confirmRename({ kind: "driveRename", device: "/dev/sdb1", value: "   " }));
    expect(backend.callsTo("rename_drive")).toHaveLength(2);
  });
});
