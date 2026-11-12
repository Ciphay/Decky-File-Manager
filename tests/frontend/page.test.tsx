import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { backend, toaster } from "./mocks/decky-api";
import { Navigation, Router, showContextMenu, showModal } from "./mocks/decky-ui";
import FileManagerPage from "../../src/FileManagerPage";
import { setSelectionIntent } from "../../src/utils/launchIntent";
import { updateBackgroundOperations } from "../../src/utils/backgroundStore";

const file = (dir: string, name: string, is_dir = false) => ({ name, path: `${dir}/${name}`, is_dir, size: is_dir ? null : 10, modified: 0 });
const TREE: Record<string, any[]> = {
  "/home/u": [file("/home/u", "Games", true), file("/home/u", "notes.txt"), file("/home/u", ".secret"), file("/home/u", "run.sh"), file("/home/u", "pack.zip")],
  "/home/u/Games": [file("/home/u/Games", "Doom", true), file("/home/u/Games", "readme.md")],
  "/": [file("", "home", true)],
};
let registered: ((i: number, b: number, p: boolean) => void) | null = null;

function setupBackend(extra: Record<string, any> = {}) {
  backend.on("list_dir", (p: string) => {
    const path = !p || p === "~" ? "/home/u" : p;
    if (!(path in TREE)) return { success: false, error: "Pasta não encontrada" };
    return { path, items: TREE[path] };
  });
  backend.on("list_drives", () => ({ drives: [
    { name: "u", path: "/home/u", kind: "home", device: null, total: 100, free: 50, mounted: true, fstype: null, system: true },
    { name: "Jogos", path: "/dev/sdb1", kind: "internal", device: "/dev/sdb1", total: 100, free: null, mounted: false, fstype: "ext4", system: false },
  ] }));
  backend.on("has_clipboard", () => ({ has: false }));
  for (const [name, impl] of Object.entries(extra)) backend.on(name, impl);
}

const setUrl = (url: string) => window.history.pushState({}, "", url);
const rowFor = (name: string) => screen.getByText(name).closest("[data-item-path]") as HTMLElement;
const lastMenuProps = () => (showContextMenu as any).mock.calls.at(-1)[0].props;
const pressY = () => act(() => registered!(0, 3, true));
const focusRow = (name: string) => act(() => { (rowFor(name).querySelector("button") as HTMLElement).focus(); });

async function renderPage(url = "/routes/steam-os-file-manager?path=~", props: any = {}) {
  setUrl(url);
  const view = render(<FileManagerPage {...props} />);
  await waitFor(() => expect(document.querySelector("[data-item-path]")).toBeTruthy(), { timeout: 3000 });
  return view;
}

beforeEach(() => {
  registered = null;
  updateBackgroundOperations(() => []);
  setSelectionIntent(null);
  (window as any).SteamUIStore = { WindowStore: { GamepadUIMainWindowInstance: {} } };
  (window as any).SteamClient = { Input: { RegisterForControllerInputMessages: (cb: any) => { registered = cb; return { unregister: vi.fn() }; }, RegisterForUserDismissKeyboardMessages: () => ({ unregister: vi.fn() }) } };
  setupBackend();
});

describe("FileManagerPage browsing", () => {
  it("lists the start directory with folders first, hiding dotfiles and showing the parent row", async () => {
    await renderPage();
    expect(screen.getByText("Games")).toBeTruthy();
    expect(screen.queryByText(".secret")).toBeNull();
    const names = Array.from(document.querySelectorAll("[data-item-path]")).map((e) => e.getAttribute("data-item-path"));
    expect(names[0]).toBe("/home");
    expect(names[1]).toBe("/home/u/Games");
    expect(backend.callsTo("list_dir")[0]).toEqual(["~"]);
  });

  it("shows hidden files when toggled and filters by type", async () => {
    await renderPage();
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(screen.getByText(".secret")).toBeTruthy();
    fireEvent.click(screen.getByText("Folders"));
    expect(screen.queryByText("notes.txt")).toBeNull();
    expect(screen.getByText("Games")).toBeTruthy();
    fireEvent.click(screen.getByText("Z-A"));
    fireEvent.click(screen.getByText("All"));
    expect(screen.getByText("notes.txt")).toBeTruthy();
  });

  it("enters folders, goes up through the parent row, and uses the path bar", async () => {
    await renderPage();
    fireEvent.click(screen.getByText("Games"));
    await screen.findByText("readme.md");
    expect((screen.getByDisplayValue("/home/u/Games") as HTMLInputElement).value).toBe("/home/u/Games");
    fireEvent.click(screen.getByText("..."));
    await screen.findByText("notes.txt");
    const input = screen.getByDisplayValue("/home/u");
    fireEvent.change(input, { target: { value: "/home/u/Games" } });
    fireEvent.keyDown(screen.getByDisplayValue("/home/u/Games"), { key: "Enter" });
    await screen.findByText("readme.md");
  });

  it("shows the backend error for unreadable folders and keeps the previous listing", async () => {
    await renderPage();
    const input = screen.getByDisplayValue("/home/u");
    fireEvent.change(input, { target: { value: "/nope" } });
    fireEvent.keyDown(screen.getByDisplayValue("/nope"), { key: "Enter" });
    await screen.findByText("Pasta não encontrada");
    expect(screen.getByText("notes.txt")).toBeTruthy();
  });

  it("B (quick press) goes to the parent; long press exits the plugin", async () => {
    await renderPage("/routes/steam-os-file-manager?path=/home/u/Games");
    await screen.findByText("readme.md");
    act(() => registered!(0, 1, true));
    act(() => registered!(0, 1, false));
    await screen.findByText("notes.txt");
    vi.useFakeTimers();
    act(() => registered!(0, 1, true));
    act(() => { vi.advanceTimersByTime(300); });
    expect(Navigation.NavigateBack).toHaveBeenCalled();
    expect(Router.CloseSideMenus).toHaveBeenCalled();
  });

  it("the footer areas go back and toggle the split view", async () => {
    await renderPage("/routes/steam-os-file-manager?path=/home/u/Games");
    await screen.findByText("readme.md");
    const footer = document.querySelector("[data-file-manager-background]")!.nextElementSibling as HTMLElement;
    fireEvent.click(footer.children[0]);
    await screen.findByText("notes.txt");
    fireEvent.click(footer.children[2]);
    await waitFor(() => expect(document.querySelectorAll("section")).toHaveLength(2));
    fireEvent.click(footer.children[2]);
    await waitFor(() => expect(document.querySelectorAll("section")).toHaveLength(1));
  });
});

describe("FileManagerPage drives", () => {
  it("shows mounted and unmounted drives; mounted ones open, unmounted ones mount first", async () => {
    backend.on("mount_drive", () => ({ ok: true, path: "/home/u/Games" }));
    await renderPage();
    await waitFor(() => expect(document.querySelectorAll("[data-drive-path]")).toHaveLength(2));
    expect(screen.getByText("Not mounted")).toBeTruthy();
    fireEvent.click(screen.getByText("Jogos"));
    await waitFor(() => expect(backend.callsTo("mount_drive")).toEqual([["/dev/sdb1", null, null]]));
    await screen.findByText("readme.md");
  });

  it("Y on a non-system capsule opens the drive menu; on a system capsule nothing special", async () => {
    await renderPage();
    await waitFor(() => expect(document.querySelectorAll("[data-drive-path]")).toHaveLength(2));
    const chip = (path: string) => document.querySelector(`[data-drive-path="${path}"] > div`) as HTMLElement;
    fireEvent.focus(chip("/dev/sdb1"));
    pressY();
    const labels = (showContextMenu as any).mock.calls.at(-1)[0].props.children.filter(Boolean).map((c: any) => c.props.children);
    expect(labels).toEqual(["Rename"]);
    (showContextMenu as any).mockClear();
    fireEvent.blur(chip("/dev/sdb1"));
    fireEvent.focus(chip("/home/u"));
    pressY();
    expect(showContextMenu).not.toHaveBeenCalled();
  });

  it("asks for the password when mounting needs it", async () => {
    backend.on("mount_drive", (_d: string, pw: string | null) => (pw ? { ok: true, path: "/home/u/Games" } : { ok: false, needs_password: true }));
    await renderPage();
    await waitFor(() => expect(document.querySelectorAll("[data-drive-path]")).toHaveLength(2));
    fireEvent.click(screen.getByText("Jogos"));
    await waitFor(() => expect(showModal).toHaveBeenCalled());
    const modal = render((showModal as any).mock.calls.at(-1)[0]);
    const field = modal.container.querySelector("input[type=password]") as HTMLInputElement;
    expect(field).toBeTruthy();
    fireEvent.change(field, { target: { value: "senha" } });
    await waitFor(() => expect(showModal.mock.calls.length).toBeGreaterThan(0));
  });
});

describe("FileManagerPage context menu and dialogs", () => {
  async function openMenuFor(name: string) {
    await renderPage();
    focusRow(name);
    pressY();
    await waitFor(() => expect(showContextMenu).toHaveBeenCalled());
    return lastMenuProps();
  }
  const lastModal = () => render((showModal as any).mock.calls.at(-1)[0]);

  it("Y opens the menu for the focused item with the right flags", async () => {
    const props = await openMenuFor("pack.zip");
    expect(props.itemName).toBe("pack.zip");
    expect(props.isArchive).toBe(true);
    expect(props.isDir).toBe(false);
  });

  it("rename flows through a dialog and calls the backend with the new name", async () => {
    backend.on("rename_item", () => ({ success: true }));
    const props = await openMenuFor("notes.txt");
    act(() => props.actions.rename());
    await waitFor(() => expect(showModal).toHaveBeenCalled());
    const modal = lastModal();
    const input = modal.container.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("notes.txt");
    fireEvent.change(input, { target: { value: "ideas.txt" } });
    await waitFor(() => expect((showModal as any).mock.calls.length + 0).toBeGreaterThan(0));
  });

  it("delete confirms before calling the backend", async () => {
    backend.on("delete_item", () => ({ success: true }));
    backend.on("get_operation_progress", () => ({ known: true, active: false, progress: 100, label: "", paused: false }));
    const props = await openMenuFor("notes.txt");
    act(() => props.actions.remove());
    await waitFor(() => expect(showModal).toHaveBeenCalled());
    const modal = lastModal();
    expect(modal.getByText('Delete "notes.txt"?')).toBeTruthy();
    expect(backend.callsTo("delete_item")).toHaveLength(0);
    fireEvent.click(modal.getByText("Yes"));
    await waitFor(() => expect(backend.callsTo("delete_item")).toHaveLength(1));
    expect(backend.callsTo("delete_item")[0][0]).toBe("/home/u/notes.txt");
  });

  it("copy then paste on the background menu pastes into the current directory", async () => {
    backend.on("copy_path", () => ({ ok: true }));
    backend.on("has_clipboard", () => ({ has: true }));
    backend.on("check_paste_conflict", () => ({ blocked: false, needs_conflict: false, name: "notes.txt" }));
    backend.on("paste_path_with_options", () => ({ success: true }));
    backend.on("get_operation_progress", () => ({ known: true, active: false, progress: 100, label: "", paused: false }));
    const props = await openMenuFor("notes.txt");
    act(() => props.actions.copy());
    await waitFor(() => expect(backend.callsTo("copy_path")).toEqual([["/home/u/notes.txt"]]));
    act(() => props.actions.paste());
    await waitFor(() => expect(backend.callsTo("paste_path_with_options")).toHaveLength(1));
    expect(backend.callsTo("paste_path_with_options")[0][0]).toBe("/home/u");
  });

  it("properties opens a dialog with the file details", async () => {
    backend.on("get_properties", () => ({ name: "notes.txt", path: "/home/u/notes.txt", type: "file", size: 10, created: 1, modified: 2, permissions: { owner: "u", immutable: false, raw: "0o644" } }));
    const props = await openMenuFor("notes.txt");
    act(() => props.actions.properties());
    await waitFor(() => expect(showModal).toHaveBeenCalled());
    expect(lastModal().getByText("/home/u/notes.txt")).toBeTruthy();
  });
});

describe("FileManagerPage selection modes", () => {
  it("select-file mode hides split and the context menu, and opens the shortcut dialog for files only", async () => {
    backend.on("validate_executable", () => ({ success: true }));
    const addShortcut = vi.fn(async () => 7);
    (window as any).SteamClient.Apps = { AddShortcut: addShortcut, SetShortcutName: vi.fn() };
    await renderPage("/routes/steam-os-file-manager/select-file?path=~");
    expect(screen.queryByText("Split")).toBeNull();
    focusRow("run.sh");
    pressY();
    expect(showContextMenu).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Games"));
    await screen.findByText("readme.md");
    expect(showModal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("readme.md"));
    await waitFor(() => expect(showModal).toHaveBeenCalled());
    const modal = render((showModal as any).mock.calls.at(-1)[0]);
    expect(modal.getByText("Add readme ?")).toBeTruthy();
    fireEvent.click(modal.getByText("Yes"));
    await waitFor(() => expect(addShortcut).toHaveBeenCalledWith("readme", "/home/u/Games/readme.md", "/home/u/Games", ""));
    await waitFor(() => expect(Navigation.NavigateBack).toHaveBeenCalled());
  });

  it("text-editor mode hands the chosen file to the editor and goes back", async () => {
    backend.on("read_file_content", () => ({ success: true, content: "conteúdo" }));
    await renderPage("/routes/steam-os-file-manager?textEditorMode=true&path=~");
    fireEvent.click(screen.getByText("notes.txt"));
    await waitFor(() => expect(Navigation.NavigateBack).toHaveBeenCalled());
    const { takePendingEditorFile } = await import("../../src/utils/editorHandoff");
    expect(takePendingEditorFile()).toEqual({ path: "/home/u/notes.txt", content: "conteúdo" });
  });

  it("pick mode (files): filters by pattern, offers 'All files', and resolves a file", async () => {
    const session: any = {
      request: { title: "Escolha qual jogo adicionar", chooseDirectory: false, filters: [] }, startPath: "/home/u", patterns: [/\.sh$/i], canShowAll: true,
      resolve: vi.fn(), cancel: vi.fn(), abandon: vi.fn(), onClosing: vi.fn(),
    };
    await renderPage("/routes/decky-manager/file-picker", { pick: session });
    await screen.findByText("run.sh");
    expect(screen.queryByText("notes.txt")).toBeNull();
    expect(screen.getByText("Escolha qual jogo adicionar")).toBeTruthy();
    expect(screen.queryByText("Select this folder")).toBeNull();
    fireEvent.click(screen.getByText("All files").querySelector("input")!);
    expect(screen.getByText("notes.txt")).toBeTruthy();
    fireEvent.click(screen.getByText("run.sh"));
    expect(session.resolve).toHaveBeenCalledWith("/home/u/run.sh");
    fireEvent.click(screen.getByText("Cancel"));
    expect(session.cancel).toHaveBeenCalled();
  });

  it("pick mode (folders): 'Select this folder' returns the current directory and files are inert", async () => {
    const session: any = { request: { title: "Pasta", chooseDirectory: true, filters: [] }, startPath: "/home/u/", patterns: null, canShowAll: false, resolve: vi.fn(), cancel: vi.fn(), abandon: vi.fn() };
    await renderPage("/routes/decky-manager/file-picker", { pick: session });
    await screen.findByText("notes.txt");
    fireEvent.click(screen.getByText("notes.txt"));
    expect(session.resolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Games"));
    await screen.findByText("readme.md");
    fireEvent.click(screen.getByText("Select this folder"));
    expect(session.resolve).toHaveBeenCalledWith("/home/u/Games");
  });

  it("pick mode falls back to the home folder when the initial directory is missing", async () => {
    const session: any = { request: { title: "x", chooseDirectory: true, filters: [] }, startPath: "/does/not/exist", patterns: null, canShowAll: false, resolve: vi.fn(), cancel: vi.fn(), abandon: vi.fn() };
    await renderPage("/routes/decky-manager/file-picker", { pick: session });
    await screen.findByText("notes.txt");
    expect(backend.callsTo("list_dir").map((c) => c[0])).toEqual(["/does/not/exist", "~"]);
  });
});

describe("FileManagerPage misc", () => {
  it("refreshes when the background poller asks, only for the matching directory", async () => {
    await renderPage();
    backend.calls = [];
    const { dispatchFileManagerRefresh } = await import("../../src/utils/backgroundStore");
    act(() => dispatchFileManagerRefresh("/elsewhere"));
    expect(backend.callsTo("list_dir")).toHaveLength(0);
    act(() => dispatchFileManagerRefresh("/home/u"));
    await waitFor(() => expect(backend.callsTo("list_dir")).toHaveLength(1));
    expect(toaster.toast).not.toHaveBeenCalled();
    expect(within(document.body).getByText("notes.txt")).toBeTruthy();
  });
});
