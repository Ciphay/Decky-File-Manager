import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { backend } from "./mocks/decky-api";
import DriveChip from "../../src/DriveChip";
import DrivesBar from "../../src/DrivesBar";
import { useDrives } from "../../src/hooks/useDrives";
import { getDriveDisplayName, listDrives, type DriveInfo } from "../../src/utils/drives";

const drive = (extra: Partial<DriveInfo> = {}): DriveInfo => ({
  name: "Interno", path: "/run/media/rafael/Interno", kind: "internal", device: "/dev/sda1", total: 100 * 1024 ** 3, free: 50 * 1024 ** 3, mounted: true, fstype: "ext4", system: false, ...extra,
});

describe("drive utils", () => {
  it("maps display names", () => {
    expect(getDriveDisplayName({ name: "deck", path: "/home/deck" })).toBe("Home");
    expect(getDriveDisplayName({ name: "/", path: "/" })).toBe("System");
    expect(getDriveDisplayName({ name: "Jogos", path: "/mnt/j" })).toBe("Jogos");
    expect(getDriveDisplayName({ name: "", path: "/mnt/x" })).toBe("Drive");
  });

  it("lists drives and tolerates bad backend answers", async () => {
    backend.on("list_drives", () => ({ drives: [drive()] }));
    expect(await listDrives()).toHaveLength(1);
    backend.on("list_drives", () => null);
    expect(await listDrives()).toEqual([]);
    backend.on("list_drives", () => ({ drives: "nope" }));
    expect(await listDrives()).toEqual([]);
    backend.on("list_drives", () => { throw new Error("x"); });
    expect(await listDrives()).toEqual([]);
  });
});

describe("DriveChip", () => {
  const renderChip = (d: DriveInfo, onActivate = vi.fn(), onFocusChange = vi.fn()) => {
    const view = render(<DriveChip drive={d} onActivate={onActivate} onFocusChange={onFocusChange} />);
    return { ...view, onActivate, onFocusChange };
  };

  it("shows name, free space, icon and a capsule shape", () => {
    const { container } = renderChip(drive());
    expect(screen.getByText("Interno")).toBeTruthy();
    expect(screen.getByText("50 GB free")).toBeTruthy();
    expect(container.querySelector("svg")).toBeTruthy();
    expect((container.querySelector("button") as HTMLElement).style.borderRadius).toBe("999px");
    expect(container.querySelector("[data-drive-path]")!.getAttribute("data-drive-system")).toBe("0");
  });

  it("draws the usage bar proportionally and turns red above 90%", () => {
    const { container, rerender } = renderChip(drive({ free: 25 * 1024 ** 3, total: 100 * 1024 ** 3 }));
    const fill = () => container.querySelector("button div div div") as HTMLElement;
    expect(fill().style.width).toBe("75%");
    expect(fill().style.background).toBe("rgb(78, 138, 217)");
    rerender(<DriveChip drive={drive({ free: 5 * 1024 ** 3 })} onActivate={vi.fn()} onFocusChange={vi.fn()} />);
    expect(fill().style.width).toBe("95%");
    expect(fill().style.background).toBe("rgb(217, 83, 79)");
  });

  it("shows unmounted drives as 'Not mounted' with an empty bar, and system flag", () => {
    const { container } = renderChip(drive({ mounted: false, free: null, system: true, kind: "usb" }));
    expect(screen.getByText("Not mounted")).toBeTruthy();
    expect((container.querySelector("button div div div") as HTMLElement).style.width).toBe("0%");
    expect(container.querySelector("[data-drive-path]")!.getAttribute("data-drive-system")).toBe("1");
  });

  it("shows read-only volumes (like ISO sticks) as 'Read-only' with a neutral full bar instead of a red one", () => {
    const { container } = renderChip(drive({ read_only: true, free: 0, total: 9 * 1024 ** 3, fstype: "iso9660" }));
    expect(screen.getByText("Read-only")).toBeTruthy();
    const fill = container.querySelector("button div div div") as HTMLElement;
    expect(fill.style.width).toBe("100%");
    expect(fill.style.background).not.toBe("rgb(217, 83, 79)");
  });

  it("shows locked encrypted volumes as 'Encrypted'", () => {
    renderChip(drive({ encrypted: true, mounted: false, free: null }));
    expect(screen.getByText("Encrypted")).toBeTruthy();
  });

  it("keeps 'Not mounted' for read-only volumes that are not mounted", () => {
    renderChip(drive({ read_only: true, mounted: false, free: null }));
    expect(screen.getByText("Not mounted")).toBeTruthy();
  });

  it("uses the right icon per kind and handles missing free space", () => {
    for (const kind of ["home", "usb", "sdcard", "internal", "root"]) {
      const { container, unmount } = renderChip(drive({ kind, free: null }));
      expect(container.querySelector("svg"), kind).toBeTruthy();
      unmount();
    }
    renderChip(drive({ free: null }));
    expect(screen.getByText("Available space")).toBeTruthy();
  });

  it("activates on click and reports focus changes", () => {
    const { container, onActivate, onFocusChange } = renderChip(drive());
    fireEvent.click(container.querySelector("button")!);
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ device: "/dev/sda1" }));
    const focusable = container.querySelector("[data-drive-path] > div") as HTMLElement;
    fireEvent.focus(focusable);
    fireEvent.blur(focusable);
    expect(onFocusChange.mock.calls).toEqual([["/run/media/rafael/Interno"], [null]]);
  });
});

describe("DrivesBar and useDrives", () => {
  it("renders one chip per drive", () => {
    const drives = [drive(), drive({ device: "/dev/sdb1", path: "/dev/sdb1", name: "Outro", mounted: false })];
    render(<DrivesBar drives={drives} onActivate={vi.fn()} onFocusChange={vi.fn()} />);
    expect(document.querySelectorAll("[data-drive-path]")).toHaveLength(2);
  });

  it("polls, only updates state when something changed, and stops on unmount", async () => {
    vi.useFakeTimers();
    let payload = [drive()];
    backend.on("list_drives", () => ({ drives: payload }));
    const { result, unmount } = renderHook(() => useDrives());
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(result.current.drives).toHaveLength(1);
    const first = result.current.drives;
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    expect(result.current.drives).toBe(first);
    payload = [drive(), drive({ device: "/dev/sdc1", path: "/dev/sdc1", mounted: false })];
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    expect(result.current.drives).toHaveLength(2);
    const calls = backend.callsTo("list_drives").length;
    unmount();
    await vi.advanceTimersByTimeAsync(7000);
    expect(backend.callsTo("list_drives").length).toBe(calls);
  });

  it("refresh() can be forced and skips while the window is hidden", async () => {
    backend.on("list_drives", () => ({ drives: [drive()] }));
    const { result } = renderHook(() => useDrives());
    await waitFor(() => expect(result.current.drives).toHaveLength(1));
    const before = backend.callsTo("list_drives").length;
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    await act(async () => { await result.current.refresh(); });
    expect(backend.callsTo("list_drives").length).toBe(before);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    await act(async () => { await result.current.refresh(); });
    expect(backend.callsTo("list_drives").length).toBe(before + 1);
  });
});
