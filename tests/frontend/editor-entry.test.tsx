import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { backend, routerHook, toaster } from "./mocks/decky-api";
import { Router } from "./mocks/decky-ui";
import TextEditor from "../../src/TextEditor";
import { handOffToEditor, takePendingEditorFile } from "../../src/utils/editorHandoff";
import { peekSelectionIntent, setSelectionIntent } from "../../src/utils/launchIntent";
import { t } from "../../src/i18n";
import { useDialogContent } from "../../src/hooks/useDialogContent";

const toastBody = () => toaster.toast.mock.calls.at(-1)?.[0]?.body as string;
const lines = () => Array.from(document.querySelectorAll("input[data-textfield]")).slice(1).map((i) => (i as HTMLInputElement).value);

beforeEach(() => { takePendingEditorFile(); setSelectionIntent(null); window.history.pushState({}, "", "/routes/decky-manager/text-editor"); });

describe("TextEditor", () => {
  it("starts empty with Save disabled", () => {
    render(<TextEditor />);
    expect(lines()).toEqual([""]);
    expect((screen.getByText("Save") as HTMLButtonElement).disabled).toBe(true);
  });

  it("loads a handed-over file, enables Save only after changes and writes the joined content", async () => {
    backend.on("write_file_content", () => ({ success: true }));
    handOffToEditor({ path: "/etc/app.conf", content: "a\nb\nc" });
    render(<TextEditor />);
    await waitFor(() => expect(lines()).toEqual(["a", "b", "c"]));
    expect((screen.getByDisplayValue("/etc/app.conf") as HTMLInputElement).value).toBe("/etc/app.conf");
    const save = screen.getByText("Save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByDisplayValue("b"), { target: { value: "B!" } });
    expect(save.disabled).toBe(false);
    await act(async () => { fireEvent.click(save); });
    expect(backend.callsTo("write_file_content")).toEqual([["/etc/app.conf", "a\nB!\nc"]]);
    expect(toastBody()).toBe("File saved successfully");
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByDisplayValue("B!"), { target: { value: "b" } });
    expect(save.disabled).toBe(false);
  });

  it("Enter splits a line at the cursor and Backspace at the start merges with the previous one (both enable Save)", async () => {
    handOffToEditor({ path: "/f", content: "hello world\nsecond" });
    render(<TextEditor />);
    await waitFor(() => expect(lines()).toEqual(["hello world", "second"]));
    const first = screen.getByDisplayValue("hello world") as HTMLInputElement;
    first.setSelectionRange(5, 5);
    fireEvent.keyDown(first, { key: "Enter" });
    await waitFor(() => expect(lines()).toEqual(["hello", " world", "second"]));
    expect((screen.getByText("Save") as HTMLButtonElement).disabled).toBe(false);
    const second = screen.getByDisplayValue("world") as HTMLInputElement;
    second.setSelectionRange(0, 0);
    fireEvent.keyDown(second, { key: "Backspace" });
    await waitFor(() => expect(lines()).toEqual(["hello world", "second"]));
    expect((screen.getByText("Save") as HTMLButtonElement).disabled).toBe(true);
  });

  it("arrow keys move focus between lines", async () => {
    handOffToEditor({ path: "/f", content: "one\ntwo" });
    render(<TextEditor />);
    await waitFor(() => expect(lines()).toEqual(["one", "two"]));
    fireEvent.keyDown(screen.getByDisplayValue("one"), { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByDisplayValue("two")));
    fireEvent.keyDown(screen.getByDisplayValue("two"), { key: "ArrowUp" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByDisplayValue("one")));
  });

  it("typing in the path field does not change where Save writes", async () => {
    backend.on("write_file_content", () => ({ success: true }));
    handOffToEditor({ path: "/real/file.txt", content: "x" });
    render(<TextEditor />);
    await waitFor(() => expect(lines()).toEqual(["x"]));
    fireEvent.change(screen.getByDisplayValue("/real/file.txt"), { target: { value: "/other/place" } });
    fireEvent.change(screen.getByDisplayValue("x"), { target: { value: "y" } });
    await act(async () => { fireEvent.click(screen.getByText("Save")); });
    expect(backend.callsTo("write_file_content")[0][0]).toBe("/real/file.txt");
  });

  it("loads from the path field with Enter, reporting backend errors", async () => {
    backend.on("read_file_content", (p: string) => (p === "/ok" ? { success: true, content: "dados", path: "/ok" } : { success: false, error: "não existe" }));
    render(<TextEditor />);
    const field = screen.getAllByDisplayValue("")[0];
    fireEvent.keyDown(field, { key: "Enter" });
    expect(toastBody()).toBe("Enter a file path");
    fireEvent.change(field, { target: { value: "/missing" } });
    fireEvent.keyDown(screen.getByDisplayValue("/missing"), { key: "Enter" });
    await waitFor(() => expect(toastBody()).toContain("não existe"));
    fireEvent.change(screen.getByDisplayValue("/missing"), { target: { value: "/ok" } });
    fireEvent.keyDown(screen.getByDisplayValue("/ok"), { key: "Enter" });
    await waitFor(() => expect(lines()).toEqual(["dados"]));
  });

  it("refuses files with too many lines and reports save failures", async () => {
    handOffToEditor({ path: "/big", content: Array.from({ length: 3500 }, () => "x").join("\n") });
    render(<TextEditor />);
    await waitFor(() => expect(toastBody()).toContain("3500"));
    expect(lines()).toEqual([""]);
    handOffToEditor({ path: "/f", content: "a" });
    await waitFor(() => expect(lines()).toEqual(["a"]));
    backend.on("write_file_content", () => ({ success: false, error: "somente leitura" }));
    fireEvent.change(screen.getByDisplayValue("a"), { target: { value: "b" } });
    await act(async () => { fireEvent.click(screen.getByText("Save")); });
    expect(toastBody()).toContain("somente leitura");
    backend.on("write_file_content", () => { throw new Error("rpc"); });
    await act(async () => { fireEvent.click(screen.getByText("Save")); });
    expect(toastBody()).toContain("rpc");
  });

  it("loads the file from the ?path= query and the Open button navigates to the picker mode", async () => {
    backend.on("read_file_content", () => ({ success: true, content: "q", path: "/q.txt" }));
    window.history.pushState({}, "", "/routes/decky-manager/text-editor?path=%2Fq.txt");
    render(<TextEditor />);
    await waitFor(() => expect(lines()).toEqual(["q"]));
    fireEvent.click(screen.getByText("Open"));
    expect(Router.Navigate).toHaveBeenCalledWith(`/steam-os-file-manager?textEditorMode=true&path=${encodeURIComponent("~")}`);
    expect(peekSelectionIntent()).toBe("text-editor");
  });
});

describe("plugin entry (index.tsx)", () => {
  it("registers routes, hooks and cleans everything on dismount", async () => {
    vi.resetModules();
    vi.doMock("../../src/FileManagerPage", () => ({ default: () => null }));
    const ui: any = await import("@decky/ui");
    const api: any = await import("./mocks/decky-api");
    ui.findModuleByExport.mockReturnValue(undefined);
    (window as any).SteamClient = { System: { OpenFileDialog: vi.fn(), OpenLocalDirectoryInSystemExplorer: vi.fn() } };
    const original = (window as any).SteamClient.System.OpenFileDialog;
    const { default: plugin } = await import("../../src/index");
    const result = (plugin as any)();
    expect(api.routerHook.addRoute.mock.calls.map((c: any[]) => c[0])).toEqual([
      "/steam-os-file-manager", "/steam-os-file-manager/select", "/steam-os-file-manager/select-file", "/decky-manager/file-picker", "/decky-manager/text-editor",
    ]);
    expect(result.name).toBe("Decky File Manager");
    expect((window as any).SteamClient.System.OpenFileDialog).not.toBe(original);
    result.onDismount();
    expect(api.routerHook.removeRoute).toHaveBeenCalledTimes(5);
    expect((window as any).SteamClient.System.OpenFileDialog).toBe(original);
    expect(routerHook).toBeDefined();
    vi.doUnmock("../../src/FileManagerPage");
  });
});

describe("useDialogContent", () => {
  const setup = (dialog: any, operationModal: any = null) => {
    const stubs: any = {
      closeDialog: vi.fn(), setDialog: vi.fn(), bind: () => ({ onFocus: vi.fn(), onBlur: vi.fn() }),
      clipboard: { resolveConflict: vi.fn() }, itemActions: { confirmCreateFolder: vi.fn(), confirmRename: vi.fn(), confirmDelete: vi.fn() },
      shortcut: { confirmAddShortcut: vi.fn() }, runner: { moveToBackground: vi.fn(), requestPauseToggle: vi.fn(), requestCancel: vi.fn() }, drives: { confirmRename: vi.fn() },
    };
    const hook = renderHook(() => useDialogContent({ dialog, operationModal, ...stubs }));
    return { ...hook, ...stubs, view: () => render(<>{hook.result.current}</>) };
  };

  it("returns nothing without a dialog and prefers the operation modal", () => {
    expect(setup(null).result.current).toBeNull();
    const op = setup(null, { label: "Copying", progress: 10, operationId: "o", showBackground: false, paused: false });
    const view = op.view();
    expect(view.getByText("Copying")).toBeTruthy();
    fireEvent.click(view.getByText("Cancel"));
    expect(op.runner.requestCancel).toHaveBeenCalled();
  });

  it("renders every dialog kind and wires its confirm action", () => {
    const kinds: Array<[any, string, string, (s: any) => any]> = [
      [{ kind: "rename", path: "/a", value: "x" }, "Save", "Rename", (s) => s.itemActions.confirmRename],
      [{ kind: "createFolder", parentDir: "/d", name: "n" }, "Create", "New folder", (s) => s.itemActions.confirmCreateFolder],
      [{ kind: "delete", path: "/a", name: "a" }, "Yes", t("modal.confirm_delete"), (s) => s.itemActions.confirmDelete],
      [{ kind: "driveRename", device: "/dev/x", value: "V" }, "Save", "Rename drive", (s) => s.drives.confirmRename],
      [{ kind: "password", title: "Admin", message: "m", value: "p", error: null, submit: vi.fn() }, "Confirm", "Admin", (s) => s.__password],
      [{ kind: "addShortcut", path: "/a.sh", name: "A", error: null }, "Yes", "Add A ?", (s) => s.shortcut.confirmAddShortcut],
    ];
    for (const [dialog, button, title, pick] of kinds) {
      const s = setup(dialog);
      const view = s.view();
      expect(view.getByText(title), dialog.kind).toBeTruthy();
      fireEvent.click(view.getByText(button));
      if (dialog.kind === "password") expect(dialog.submit).toHaveBeenCalledWith("p");
      else expect(pick(s), dialog.kind).toHaveBeenCalledWith(dialog);
      view.unmount();
    }
  });

  it("renders conflict, message and properties dialogs", () => {
    const conflict = setup({ kind: "conflict", title: "Exists", message: "dup", targetDir: "/d", itemName: "dup", isFolder: false });
    const view = conflict.view();
    fireEvent.click(view.getByText("Replace"));
    expect(conflict.clipboard.resolveConflict).toHaveBeenCalledWith("/d", "dup", "replace");
    view.unmount();
    const message = setup({ kind: "message", title: "Aviso", message: "texto" });
    const mv = message.view();
    fireEvent.click(mv.getByText("Close"));
    expect(message.closeDialog).toHaveBeenCalled();
    mv.unmount();
    const props = setup({ kind: "properties", calculating: false, data: { name: "n", path: "/p", type: "file", size: 1, created: 1, modified: 1, permissions: { owner: "u", immutable: false, raw: "0o1" } } });
    expect(props.view().getByText("/p")).toBeTruthy();
  });

  it("typing updates the dialog state through setDialog", () => {
    const s = setup({ kind: "rename", path: "/a", value: "x" });
    const view = s.view();
    fireEvent.change(view.getByDisplayValue("x"), { target: { value: "y" } });
    const updater = s.setDialog.mock.calls.at(-1)[0];
    expect(updater({ kind: "rename", path: "/a", value: "x" })).toEqual({ kind: "rename", path: "/a", value: "y" });
    expect(updater({ kind: "delete", path: "/a", name: "a" })).toEqual({ kind: "delete", path: "/a", name: "a" });
  });
});
