import { beforeEach, describe, expect, it, vi } from "vitest";
import { backend, toaster } from "./mocks/decky-api";
import {
  addBackgroundOperation, dispatchFileManagerRefresh, getBackgroundOperations, isOperationCanceled, markOperationCanceled,
  patchBackgroundOperation, removeBackgroundOperation, subscribeBackgroundOperations, subscribeFileManagerRefresh,
  unmarkOperationCanceled, updateBackgroundOperations,
} from "../../src/utils/backgroundStore";
import { showErrorToast, showOperationToast } from "../../src/utils/operationToast";
import { startBackgroundPolling } from "../../src/backgroundPolling";

const op = (id: string, extra = {}) => ({ operationId: id, label: `Copiando: ${id}`, progress: 0, paused: false, ...extra });

beforeEach(() => updateBackgroundOperations(() => []));

describe("backgroundStore", () => {
  it("adds, replaces, patches and removes operations notifying subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeBackgroundOperations(listener);
    addBackgroundOperation(op("a"));
    addBackgroundOperation(op("b"));
    addBackgroundOperation(op("a", { progress: 50 }));
    expect(getBackgroundOperations().map((o) => [o.operationId, o.progress])).toEqual([["a", 50], ["b", 0]]);
    const callsBefore = listener.mock.calls.length;
    patchBackgroundOperation("a", { progress: 50 });
    expect(listener.mock.calls.length).toBe(callsBefore);
    patchBackgroundOperation("a", { paused: true });
    patchBackgroundOperation("ghost", { paused: true });
    expect(getBackgroundOperations()[0].paused).toBe(true);
    removeBackgroundOperation("a");
    removeBackgroundOperation("a");
    expect(getBackgroundOperations().map((o) => o.operationId)).toEqual(["b"]);
    unsubscribe();
    addBackgroundOperation(op("c"));
    expect(listener.mock.calls.length).toBeGreaterThan(0);
  });

  it("returns the same array when nothing changes", () => {
    addBackgroundOperation(op("a"));
    const before = getBackgroundOperations();
    updateBackgroundOperations((current) => current);
    expect(getBackgroundOperations()).toBe(before);
  });

  it("tracks canceled ids", () => {
    markOperationCanceled("x");
    expect(isOperationCanceled("x")).toBe(true);
    unmarkOperationCanceled("x");
    expect(isOperationCanceled("x")).toBe(false);
  });

  it("dispatches and subscribes to refresh events", () => {
    const handler = vi.fn();
    const unsubscribe = subscribeFileManagerRefresh(handler);
    dispatchFileManagerRefresh();
    dispatchFileManagerRefresh("/dest");
    expect(handler.mock.calls).toEqual([[undefined], ["/dest"]]);
    unsubscribe();
    dispatchFileManagerRefresh("/x");
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe("operation toasts", () => {
  const lastToast = () => toaster.toast.mock.calls.at(-1)![0];

  it("picks the verb from the label", () => {
    const cases: Array<[string, string]> = [
      ["Extracting", "extracted"], ["Copying", "copied"], ["Pasting", "completed"], ["Moving", "moved"], ["Deleting", "deleted"], ["Renaming", "renamed"], ["Creating folder", "created"], ["Whatever", "completed"],
    ];
    for (const [label, key] of cases) {
      showOperationToast(label, "file.txt");
      expect(lastToast().body, label).toContain("file.txt");
      expect(lastToast().body, label).toContain(({ extracted: "extracted", copied: "copied", moved: "moved", deleted: "deleted", renamed: "renamed", created: "created", completed: "" } as any)[key]);
    }
  });

  it("recognizes the plugin's own translated labels in every language", async () => {
    const LABELS: Array<[string, string]> = [
      ["action.extracting", "toast.success_extracted"], ["action.pasting", "toast.success_copied"], ["action.moving", "toast.success_moved"],
      ["action.deleting", "toast.success_deleted"], ["action.renaming", "toast.success_renamed"], ["action.creating_folder", "toast.success_created"],
    ];
    for (const language of ["en", "pt-BR", "es", "fr", "de", "zh-CN"]) {
      vi.resetModules();
      (window as any).SteamClient = { GetCurrentLanguage: () => language };
      const i18n = await import("../../src/i18n");
      const toast = await import("../../src/utils/operationToast");
      const api = await import("./mocks/decky-api");
      for (const [labelKey, successKey] of LABELS) {
        toast.showOperationToast(`${i18n.t(labelKey)}: arquivo.bin`, "arquivo.bin");
        const body = api.toaster.toast.mock.calls.at(-1)![0].body as string;
        expect(body, `${language} ${labelKey}`).toBe(`arquivo.bin ${i18n.t(successKey)}`);
      }
    }
  });

  it("formats cancelled and failed outcomes", () => {
    showOperationToast("Copying", "a.txt", "cancelled");
    expect(lastToast()).toMatchObject({ title: "Operation cancelled", body: "a.txt" });
    showOperationToast("Copying", "a.txt", "failed", "disk full");
    expect(lastToast()).toMatchObject({ title: "Failed", body: "a.txt: disk full" });
    showOperationToast("Copying", "", "failed");
    expect(lastToast().body).toBe("Copying");
    showOperationToast("OK", "OK");
    expect(lastToast().body).toBe("Operation completed successfully");
  });

  it("shows error toasts", () => {
    showErrorToast("falhou");
    expect(lastToast()).toMatchObject({ title: "Failed", body: "falhou", showToast: true });
  });
});

describe("background polling", () => {
  const status = (extra = {}) => ({ known: true, active: true, progress: 40, label: "Copying", detail: "a.txt", paused: false, ...extra });

  const tick = async () => { await vi.advanceTimersByTimeAsync(450); };

  beforeEach(() => vi.useFakeTimers());

  it("updates progress of active operations", async () => {
    backend.on("get_operation_progress", () => status());
    addBackgroundOperation(op("a"));
    const stop = startBackgroundPolling();
    await tick();
    expect(getBackgroundOperations()[0]).toMatchObject({ progress: 40, label: "Copying: a.txt", paused: false });
    stop();
  });

  it("toasts success once, refreshes and removes finished operations", async () => {
    const refresh = vi.fn();
    subscribeFileManagerRefresh(refresh);
    backend.on("get_operation_progress", () => status({ active: false, progress: 100, target_dir: "/dest" }));
    addBackgroundOperation(op("a"));
    const stop = startBackgroundPolling();
    await tick();
    expect(getBackgroundOperations()).toEqual([]);
    expect(toaster.toast).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith("/dest");
    await tick();
    expect(toaster.toast).toHaveBeenCalledTimes(1);
    stop();
  });

  it("reports failures", async () => {
    backend.on("get_operation_progress", () => status({ active: false, failed: true, error: "sem espaço" }));
    addBackgroundOperation(op("a"));
    const stop = startBackgroundPolling();
    await tick();
    expect(toaster.toast.mock.calls[0][0]).toMatchObject({ title: "Failed" });
    expect(toaster.toast.mock.calls[0][0].body).toContain("sem espaço");
    stop();
  });

  it("drops canceled and unknown operations silently", async () => {
    backend.on("get_operation_progress", (id: string) => (id === "c" ? status({ cancel_requested: true }) : status({ known: false })));
    addBackgroundOperation(op("c"));
    addBackgroundOperation(op("u"));
    markOperationCanceled("pre");
    addBackgroundOperation(op("pre"));
    const stop = startBackgroundPolling();
    await tick();
    expect(getBackgroundOperations()).toEqual([]);
    expect(toaster.toast).not.toHaveBeenCalled();
    stop();
  });

  it("dispatches a refresh when the first item is processed and keeps operations on errors", async () => {
    const refresh = vi.fn();
    subscribeFileManagerRefresh(refresh);
    backend.on("get_operation_progress", (id: string) => {
      if (id === "boom") throw new Error("rede");
      return status({ first_item_processed: true, target_dir: "/d" });
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    addBackgroundOperation(op("ok"));
    addBackgroundOperation(op("boom"));
    const stop = startBackgroundPolling();
    await tick();
    await tick();
    expect(refresh.mock.calls.filter(([dir]) => dir === "/d")).toHaveLength(1);
    expect(getBackgroundOperations().map((o) => o.operationId).sort()).toEqual(["boom", "ok"]);
    stop();
  });

  it("does nothing without operations and stops when asked", async () => {
    const stop = startBackgroundPolling();
    await tick();
    expect(backend.callsTo("get_operation_progress")).toHaveLength(0);
    stop();
    backend.on("get_operation_progress", () => status());
    addBackgroundOperation(op("a"));
    await tick();
    expect(backend.callsTo("get_operation_progress")).toHaveLength(0);
  });
});
