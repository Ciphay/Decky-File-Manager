import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { backend, toaster } from "./mocks/decky-api";
import { t } from "../../src/i18n";
import { Router } from "./mocks/decky-ui";
import { useOperationRunner } from "../../src/hooks/useOperationRunner";
import { useClipboardActions } from "../../src/hooks/useClipboardActions";
import { useItemActions } from "../../src/hooks/useItemActions";
import { useAddShortcut } from "../../src/hooks/useAddShortcut";
import { addBackgroundOperation, getBackgroundOperations, isOperationCanceled, updateBackgroundOperations } from "../../src/utils/backgroundStore";
import { takePendingEditorFile } from "../../src/utils/editorHandoff";
import type { DialogState } from "../../src/dialogs";

const entry = (name: string, is_dir = false) => ({ name, path: `/d/${name}`, is_dir, size: 1, modified: 0 });
const lastToast = () => toaster.toast.mock.calls.at(-1)?.[0];

beforeEach(() => updateBackgroundOperations(() => []));

describe("useOperationRunner", () => {
  const setup = () => {
    const onFinished = vi.fn(async () => undefined);
    return { onFinished, ...renderHook(() => useOperationRunner(onFinished)) };
  };

  it("runs an operation with a progress modal, polls progress and closes at the end", async () => {
    let release!: (v: any) => void;
    backend.on("get_operation_progress", () => ({ known: true, active: true, progress: 60, label: "Copying", detail: "a.txt", paused: false }));
    const { result, onFinished } = setup();
    let promise!: Promise<any>;
    act(() => { promise = result.current.runOperation("Copying: a.txt", () => new Promise((r) => { release = r; }), { showBackground: true }); });
    expect(result.current.operationModal).toMatchObject({ label: "Copying: a.txt", progress: 0, showBackground: true, paused: false });
    await waitFor(() => expect(result.current.operationModal?.progress).toBe(60));
    expect(result.current.operationModal?.label).toBe("Copying: a.txt");
    await act(async () => { release({ success: true }); await promise; });
    expect(result.current.operationModal).toBeNull();
    expect(onFinished).toHaveBeenCalledTimes(1);
    await expect(promise).resolves.toEqual({ success: true });
  });

  it("works without a modal when showProgress is false", async () => {
    const { result } = setup();
    await act(async () => { await result.current.runOperation("x", async () => ({ ok: true }), { showProgress: false }); });
    expect(result.current.operationModal).toBeNull();
    expect(backend.callsTo("get_operation_progress")).toHaveLength(0);
  });

  it("calls onError for failures (in-band and thrown) and toasts by default", async () => {
    const { result } = setup();
    const onError = vi.fn();
    await act(async () => { await result.current.runOperation("x", async () => ({ success: false, error: "Sem permissão" }), { showProgress: false, onError }); });
    expect(onError.mock.calls[0][0].message).toBe("Sem permissão");
    await act(async () => { await result.current.runOperation("x", async () => { throw new Error("rpc"); }, { showProgress: false }); });
    expect(lastToast()).toMatchObject({ title: "Failed", body: "rpc" });
  });

  it("treats cancellation as silent", async () => {
    const { result } = setup();
    const onError = vi.fn();
    expect(await result.current.runOperation("x", async () => ({ cancelled: true }), { showProgress: false, onError })).toBeNull();
    expect(await result.current.runOperation("x", async () => { throw new Error("Operação cancelada"); }, { showProgress: false, onError })).toBeNull();
    expect(onError).not.toHaveBeenCalled();
    expect(toaster.toast).not.toHaveBeenCalled();
  });

  it("moves to background, and leaves failure reporting to the background poller", async () => {
    let fail!: (e: Error) => void;
    backend.on("get_operation_progress", () => ({ known: true, active: true, progress: 10, label: "Copying", paused: false }));
    const { result } = setup();
    const onError = vi.fn();
    let promise!: Promise<any>;
    act(() => { promise = result.current.runOperation("Copying", () => new Promise((_, reject) => { fail = reject; }), { showBackground: true, onError }); });
    act(() => result.current.moveToBackground());
    expect(result.current.operationModal).toBeNull();
    expect(getBackgroundOperations()).toHaveLength(1);
    await act(async () => { fail(new Error("disk full")); await promise; });
    expect(onError).not.toHaveBeenCalled();
    expect(getBackgroundOperations()).toHaveLength(1);
  });

  it("cancels: marks the id, tells the backend, clears modal and background entry", async () => {
    backend.on("cancel_operation", () => ({ ok: true }));
    backend.on("get_operation_progress", () => ({ known: true, active: true, progress: 5, label: "x", paused: false }));
    const { result } = setup();
    act(() => { void result.current.runOperation("x", () => new Promise(() => undefined)); });
    const id = result.current.operationModal!.operationId;
    await act(async () => { await result.current.requestCancel(); });
    expect(backend.callsTo("cancel_operation")).toEqual([[id]]);
    expect(isOperationCanceled(id)).toBe(true);
    expect(result.current.operationModal).toBeNull();
    await act(async () => { await result.current.requestCancel(); });
    expect(backend.callsTo("cancel_operation")).toHaveLength(1);
  });

  it("un-marks cancellation if the backend call fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    backend.on("cancel_operation", () => { throw new Error("rpc"); });
    const { result } = setup();
    await act(async () => { await result.current.requestCancel("op-x"); });
    expect(isOperationCanceled("op-x")).toBe(false);
  });

  it("toggles pause for the modal and for background operations", async () => {
    backend.on("pause_operation", () => ({ ok: true }));
    backend.on("resume_operation", () => ({ ok: true }));
    backend.on("get_operation_progress", () => ({ known: true, active: true, progress: 5, label: "x", paused: false }));
    const { result } = setup();
    act(() => { void result.current.runOperation("x", () => new Promise(() => undefined)); });
    const id = result.current.operationModal!.operationId;
    await act(async () => { await result.current.requestPauseToggle(); });
    expect(backend.callsTo("pause_operation")).toEqual([[id]]);
    expect(result.current.operationModal?.paused).toBe(true);
    await act(async () => { await result.current.requestPauseToggle(); });
    expect(backend.callsTo("resume_operation")).toEqual([[id]]);
    addBackgroundOperation({ operationId: "bg", label: "x", progress: 1, paused: true });
    await act(async () => { await result.current.requestPauseToggle("bg"); });
    expect(backend.callsTo("resume_operation")[1]).toEqual(["bg"]);
    expect(getBackgroundOperations()[0].paused).toBe(false);
  });
});

describe("useClipboardActions", () => {
  const setup = () => {
    let dialog: DialogState = null;
    const setDialog = vi.fn((d: DialogState) => { dialog = d; });
    const runOperation: any = vi.fn(async (_l: string, action: (id: string) => Promise<any>) => action("op-1"));
    backend.on("has_clipboard", () => ({ has: true }));
    const hook = renderHook(() => useClipboardActions({ runOperation, setDialog }));
    return { ...hook, runOperation, setDialog, getDialog: () => dialog };
  };

  it("tracks clipboard presence", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.clipboardHas).toBe(true));
    backend.on("has_clipboard", () => { throw new Error("x"); });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await act(async () => { expect(await result.current.refreshClipboard()).toBe(false); });
    expect(result.current.clipboardHas).toBe(false);
  });

  it("copy and cut call the backend and refresh", async () => {
    backend.on("copy_path", () => ({ ok: true }));
    backend.on("cut_path", () => ({ ok: true }));
    const { result } = setup();
    await act(async () => { await result.current.copy(entry("a")); await result.current.cut(entry("b")); });
    expect(backend.callsTo("copy_path")).toEqual([["/d/a"]]);
    expect(backend.callsTo("cut_path")).toEqual([["/d/b"]]);
    backend.on("copy_path", () => { throw new Error("nope"); });
    await act(async () => { await result.current.copy(entry("a")); });
    expect(lastToast()).toMatchObject({ body: "nope" });
  });

  it("pastes directly when there is no conflict", async () => {
    backend.on("check_paste_conflict", () => ({ blocked: false, needs_conflict: false, name: "a.txt" }));
    backend.on("paste_path_with_options", () => ({ success: true, skipped_count: 0 }));
    const { result, runOperation } = setup();
    await act(async () => { await result.current.paste("/dest"); });
    expect(runOperation.mock.calls[0][0]).toBe("Copying: a.txt");
    expect(backend.callsTo("paste_path_with_options")[0].slice(0, 3)).toEqual(["/dest", "keep-both", false]);
    expect(backend.callsTo("paste_path_with_options")[0][5]).toBe("op-1");
  });

  it("opens the conflict dialog and resolves it with the chosen strategy", async () => {
    backend.on("check_paste_conflict", () => ({ blocked: false, needs_conflict: true, name: "dup", is_dir: true }));
    backend.on("paste_path_with_options", () => ({ success: true }));
    const { result, getDialog } = setup();
    await act(async () => { await result.current.paste("/dest"); });
    expect(getDialog()).toMatchObject({ kind: "conflict", isFolder: true, targetDir: "/dest", itemName: "dup" });
    await act(async () => { await result.current.resolveConflict("/dest", "dup", "merge"); });
    expect(getDialog()).toBeNull();
    expect(backend.callsTo("paste_path_with_options")[0][1]).toBe("merge");
  });

  it("shows a warning for blocked pastes and a toast for check failures", async () => {
    backend.on("check_paste_conflict", () => ({ blocked: true, reason: "same-directory", name: "x" }));
    const { result, getDialog } = setup();
    await act(async () => { await result.current.paste("/dest"); });
    expect(getDialog()).toMatchObject({ kind: "message", message: t("error.same_directory") });
    backend.on("check_paste_conflict", () => ({ blocked: true, reason: "self-directory", name: "x" }));
    await act(async () => { await result.current.paste("/dest"); });
    expect((getDialog() as any).message).toBe(t("paste.blocked"));
    backend.on("check_paste_conflict", () => { throw new Error("falhou"); });
    await act(async () => { await result.current.paste("/dest"); });
    expect(lastToast().body).toBe("falhou");
  });

  it("reports skipped (unreadable) items after a paste", async () => {
    backend.on("check_paste_conflict", () => ({ blocked: false, needs_conflict: false, name: "pasta" }));
    backend.on("paste_path_with_options", () => ({ success: true, skipped_count: 2, skipped_items: ["a.bin", "b.bin"] }));
    const { result, getDialog } = setup();
    await act(async () => { await result.current.paste("/dest"); });
    expect((getDialog() as any).message).toContain("2 item(s)");
    expect((getDialog() as any).message).toContain("a.bin, b.bin");
  });

  it("permission errors become the permission dialog", async () => {
    backend.on("check_paste_conflict", () => ({ blocked: false, needs_conflict: false, name: "x" }));
    const { result, runOperation, getDialog } = setup();
    runOperation.mockImplementation(async (_l: string, _a: any, options: any) => { options.onError(new Error("Sem permissão: x")); return null; });
    await act(async () => { await result.current.paste("/dest"); });
    expect(getDialog()).toMatchObject({ kind: "message", title: "Permission denied" });
  });

  it("transfers to the other pane, refusing identical directories", async () => {
    backend.on("copy_path", () => ({ ok: true }));
    backend.on("cut_path", () => ({ ok: true }));
    backend.on("check_paste_conflict", () => ({ blocked: false, needs_conflict: false, name: "a" }));
    backend.on("paste_path_with_options", () => ({ success: true }));
    const { result, getDialog } = setup();
    await act(async () => { await result.current.transferToOtherPane(entry("a"), "copy", "/same", "/same"); });
    expect(getDialog()).toMatchObject({ kind: "message" });
    expect(backend.callsTo("copy_path")).toHaveLength(0);
    await act(async () => { await result.current.transferToOtherPane(entry("a"), "cut", "/left", "/right"); });
    expect(backend.callsTo("cut_path")).toEqual([["/d/a"]]);
    expect(backend.callsTo("paste_path_with_options")[0][0]).toBe("/right");
  });
});

describe("useItemActions", () => {
  const setup = () => {
    let dialog: DialogState = null;
    const setDialog: any = vi.fn((u: any) => { dialog = typeof u === "function" ? u(dialog) : u; });
    const runOperation: any = vi.fn(async (_label: string, action: (id: string) => Promise<any>) => action("op-9"));
    return { ...renderHook(() => useItemActions({ runOperation, setDialog })), runOperation, setDialog, getDialog: () => dialog };
  };

  it("opens the create/rename/delete dialogs", () => {
    const { result, getDialog } = setup();
    act(() => result.current.openCreateFolder("/d"));
    expect(getDialog()).toEqual({ kind: "createFolder", parentDir: "/d", name: "" });
    act(() => result.current.openRename(entry("a.txt")));
    expect(getDialog()).toEqual({ kind: "rename", path: "/d/a.txt", value: "a.txt" });
    act(() => result.current.openDelete(entry("a.txt")));
    expect(getDialog()).toEqual({ kind: "delete", path: "/d/a.txt", name: "a.txt" });
  });

  it("creates, renames and deletes through the backend", async () => {
    backend.on("create_folder", () => ({ success: true }));
    backend.on("rename_item", () => ({ success: true }));
    backend.on("delete_item", () => ({ success: true }));
    const { result, getDialog } = setup();
    await act(async () => { await result.current.confirmCreateFolder({ kind: "createFolder", parentDir: "/d", name: " nova " }); });
    expect(backend.callsTo("create_folder")).toEqual([["/d", "nova", "op-9"]]);
    expect(getDialog()).toBeNull();
    await act(async () => { await result.current.confirmRename({ kind: "rename", path: "/d/a", value: "b" }); });
    expect(backend.callsTo("rename_item")).toEqual([["/d/a", "b", "op-9"]]);
    await act(async () => { await result.current.confirmDelete({ kind: "delete", path: "/d/a", name: "a" }); });
    expect(backend.callsTo("delete_item")[0].slice(0, 1)).toEqual(["/d/a"]);
  });

  it("rejects invalid names before calling the backend", async () => {
    const { result } = setup();
    for (const name of ["", " ", ".", "..", "a/b", "a\\b"]) {
      await act(async () => { await result.current.confirmCreateFolder({ kind: "createFolder", parentDir: "/d", name }); });
      await act(async () => { await result.current.confirmRename({ kind: "rename", path: "/d/a", value: name }); });
    }
    expect(backend.callsTo("create_folder")).toHaveLength(0);
    expect(backend.callsTo("rename_item")).toHaveLength(0);
    expect(lastToast().body).toBe("Invalid name");
  });

  it("extracts archives with the target directory", async () => {
    backend.on("extract_archive", () => ({ success: true }));
    const { result } = setup();
    await act(async () => { await result.current.extract(entry("p.zip"), "/out"); });
    expect(backend.callsTo("extract_archive")[0].slice(0, 2)).toEqual(["/d/p.zip", "/out"]);
  });

  it("shows properties and fills in the folder size later", async () => {
    const props = { name: "dir", path: "/d/dir", type: "folder", size: null, created: 1, modified: 2, permissions: { owner: "u", immutable: false, raw: "0o755" } };
    backend.on("get_properties", () => props);
    backend.on("get_directory_size", () => ({ size: 1234, path: "/d/dir" }));
    const { result, getDialog } = setup();
    await act(async () => { await result.current.showProperties(entry("dir", true)); });
    expect(getDialog()).toMatchObject({ kind: "properties", calculating: false });
    expect((getDialog() as any).data.size).toBe(1234);
    backend.on("get_directory_size", () => { throw new Error("x"); });
    await act(async () => { await result.current.showProperties(entry("dir", true)); });
    expect((getDialog() as any).data.size).toBeNull();
    backend.on("get_properties", () => ({ ...props, type: "file", size: 9 }));
    await act(async () => { await result.current.showProperties(entry("f")); });
    expect((getDialog() as any).calculating).toBe(false);
    backend.on("get_properties", () => { throw new Error("denied"); });
    await act(async () => { await result.current.showProperties(entry("f")); });
    expect(lastToast().body).toBe("denied");
  });

  it("opens a file in the text editor through the handoff", async () => {
    backend.on("read_file_content", () => ({ success: true, content: "olá" }));
    const { result } = setup();
    await act(async () => { await result.current.openInTextEditor(entry("n.txt")); });
    expect(takePendingEditorFile()).toEqual({ path: "/d/n.txt", content: "olá" });
    expect(Router.Navigate).toHaveBeenCalledWith("/decky-manager/text-editor");
    backend.on("read_file_content", () => ({ success: false, error: "binário" }));
    await act(async () => { await result.current.openInTextEditor(entry("b.bin")); });
    expect(lastToast().body).toBe("binário");
    expect(takePendingEditorFile()).toBeNull();
  });
});

describe("useAddShortcut", () => {
  const setup = () => {
    let dialog: DialogState = null;
    const setDialog: any = vi.fn((u: any) => { dialog = typeof u === "function" ? u(dialog) : u; });
    const onAdded = vi.fn();
    return { ...renderHook(() => useAddShortcut({ setDialog, onAdded })), onAdded, getDialog: () => dialog };
  };
  const addShortcutDialog = (name = "Jogo", path = "/g/Jogo.sh") => ({ kind: "addShortcut" as const, path, name, error: null });

  it("opens the dialog for files only, stripping the extension", () => {
    const { result, getDialog } = setup();
    act(() => result.current.openAddShortcut(entry("Meu Jogo.AppImage")));
    expect(getDialog()).toMatchObject({ kind: "addShortcut", name: "Meu Jogo" });
    act(() => result.current.openAddShortcut(entry("pasta", true)));
    act(() => result.current.openAddShortcut(null));
    expect((getDialog() as any).name).toBe("Meu Jogo");
  });

  it("validates, then registers the shortcut with a quoted path and sets its name", async () => {
    backend.on("validate_executable", () => ({ success: true }));
    const addShortcut = vi.fn(async () => 1234);
    const setName = vi.fn();
    (window as any).SteamClient = { Apps: { AddShortcut: addShortcut, SetShortcutName: setName } };
    const { result, onAdded, getDialog } = setup();
    await act(async () => { await result.current.confirmAddShortcut(addShortcutDialog("Jogo", "/g/my game/run.sh")); });
    expect(addShortcut).toHaveBeenCalledWith("Jogo", '"/g/my game/run.sh"', "/g/my game", "");
    expect(setName).toHaveBeenCalledWith(1234, "Jogo");
    expect(onAdded).toHaveBeenCalled();
    expect(getDialog()).toBeNull();
    await act(async () => { await result.current.confirmAddShortcut(addShortcutDialog("Jogo", "/g/run.sh")); });
    expect(addShortcut).toHaveBeenLastCalledWith("Jogo", "/g/run.sh", "/g", "");
  });

  it("shows inline errors for empty names, invalid files and missing Steam API", async () => {
    const { result, getDialog, onAdded } = setup();
    act(() => result.current.openAddShortcut(entry("x.sh")));
    await act(async () => { await result.current.confirmAddShortcut(addShortcutDialog("  ")); });
    expect((getDialog() as any).error).toBe(t("shortcut.error.name_required"));
    backend.on("validate_executable", () => ({ success: false, error: "não é arquivo" }));
    await act(async () => { await result.current.confirmAddShortcut(addShortcutDialog()); });
    expect((getDialog() as any).error).toBe("não é arquivo");
    backend.on("validate_executable", () => ({ success: true }));
    await act(async () => { await result.current.confirmAddShortcut(addShortcutDialog()); });
    expect((getDialog() as any).error).toBe(t("shortcut.error.steam_unavailable"));
    (window as any).SteamClient = { Apps: { AddShortcut: async () => { throw new Error("steam caiu"); } } };
    await act(async () => { await result.current.confirmAddShortcut(addShortcutDialog()); });
    expect((getDialog() as any).error).toBe("steam caiu");
    expect(onAdded).not.toHaveBeenCalled();
  });
});
