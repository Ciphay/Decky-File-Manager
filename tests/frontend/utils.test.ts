import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  composeOperationLabel, isCancellationError, isGenericOperationText, isPermissionError, normalizeOperationLabelAndDetail,
  normalizePathLikeName, sanitizeOperationText,
} from "../../src/utils/operationText";
import { getDirectoryOf, getParentDirectory, messageOf, stripExtension } from "../../src/utils/paths";
import { buildListEntries, getParentEntry } from "../../src/utils/filterItems";
import { formatBytes, isArchiveFile } from "../../src/utils/file";
import { peekSelectionIntent, setSelectionIntent } from "../../src/utils/launchIntent";
import { handOffToEditor, subscribeEditorFile, takePendingEditorFile } from "../../src/utils/editorHandoff";
import { patternsForDefaultFilter } from "../../src/fileDialog/patterns";
import { unregisterSteamCallback } from "../../src/utils/steamInput";
import { isGamepadUi } from "../../src/fileDialog/steamEnv";
import type { FileEntry } from "../../src/api";

describe("operationText", () => {
  it("sanitizes trailing ellipsis and spaces", () => {
    expect(sanitizeOperationText("Copiando...  ")).toBe("Copiando");
    expect(sanitizeOperationText("a   b")).toBe("a b");
    expect(sanitizeOperationText(undefined)).toBe("");
  });

  it("detects generic texts", () => {
    for (const word of ["OK", "done", "Concluído", " success ", "operacao"]) expect(isGenericOperationText(word)).toBe(true);
    expect(isGenericOperationText("foto.png")).toBe(false);
  });

  it("normalizes path-like names", () => {
    expect(normalizePathLikeName("/a/b/c.txt")).toBe("c.txt");
    expect(normalizePathLikeName("C:\\x\\y.bin")).toBe("y.bin");
    expect(normalizePathLikeName("ok")).toBe("");
    expect(normalizePathLikeName("   ")).toBe("");
  });

  it("splits label and detail", () => {
    expect(normalizeOperationLabelAndDetail("Copiando: foo/bar.txt", "")).toEqual({ baseLabel: "Copiando", fileName: "bar.txt" });
    expect(normalizeOperationLabelAndDetail("Copiando", "x.txt")).toEqual({ baseLabel: "Copiando", fileName: "x.txt" });
    expect(normalizeOperationLabelAndDetail("Só rótulo", "")).toEqual({ baseLabel: "Só rótulo", fileName: "" });
  });

  it("composes display labels ignoring generic detail", () => {
    expect(composeOperationLabel("Copiando", "a.txt")).toBe("Copiando: a.txt");
    expect(composeOperationLabel("Copiando: velho", "novo")).toBe("Copiando: novo");
    expect(composeOperationLabel("Copiando", "OK")).toBe("Copiando");
    expect(composeOperationLabel("Copiando", undefined)).toBe("Copiando");
  });

  it("classifies cancellation and permission errors", () => {
    expect(isCancellationError(new Error("Operação cancelada"))).toBe(true);
    expect(isCancellationError("operation cancelled")).toBe(true);
    expect(isCancellationError(new Error("outra coisa"))).toBe(false);
    expect(isPermissionError("Sem permissão: x")).toBe(true);
    expect(isPermissionError(new Error("Permission denied"))).toBe(true);
    expect(isPermissionError(null)).toBe(false);
  });
});

describe("paths", () => {
  it("computes parents", () => {
    expect(getParentDirectory("/a/b/c")).toBe("/a/b");
    expect(getParentDirectory("/a")).toBe("/");
    expect(getParentDirectory("/")).toBe("/");
    expect(getParentDirectory("")).toBe("/");
    expect(getDirectoryOf("/x/y.txt")).toBe("/x");
  });

  it("base names, extensions and messages", () => {
    expect(stripExtension("x.tar.gz")).toBe("x.tar");
    expect(stripExtension(".bashrc")).toBe(".bashrc");
    expect(messageOf(new Error("boom"))).toBe("boom");
    expect(messageOf("texto")).toBe("texto");
    expect(messageOf({ message: "m" })).toBe("m");
    expect(messageOf(null, "padrão")).toBe("padrão");
  });
});

describe("file helpers", () => {
  it("detects archives", () => {
    for (const name of ["a.zip", "A.TAR.GZ", "x.7z", "y.iso", "z.tgz", "w.rar", "q.zst"]) expect(isArchiveFile(name)).toBe(true);
    expect(isArchiveFile("notes.txt")).toBe(false);
  });

  it("formats bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.50 KB");
    expect(formatBytes(50 * 1024 ** 3)).toBe("50 GB");
    expect(formatBytes(5 * 1024 ** 2)).toBe("5.00 MB");
  });
});

describe("buildListEntries", () => {
  const item = (name: string, is_dir = false): FileEntry => ({ name, path: `/d/${name}`, is_dir, size: is_dir ? null : 1, modified: 0 });
  const items = [item("b.txt"), item("A.txt"), item(".hidden"), item("zdir", true), item("Adir", true), item("file10.txt"), item("file2.txt")];
  const base = { showHidden: false, typeFilter: "all" as const, sortOrder: "asc" as const };

  it("puts parent first, folders before files, natural sort, hides dotfiles", () => {
    const names = buildListEntries(items, "/d", base).map((e) => e.name);
    expect(names).toEqual(["...", "Adir", "zdir", "A.txt", "b.txt", "file2.txt", "file10.txt"]);
  });

  it("supports descending, hidden, type filters and root without parent", () => {
    expect(buildListEntries(items, "/", base)[0].isParent).toBeUndefined();
    expect(buildListEntries(items, "/d", { ...base, showHidden: true }).map((e) => e.name)).toContain(".hidden");
    expect(buildListEntries(items, "/d", { ...base, sortOrder: "desc" }).slice(1, 3).map((e) => e.name)).toEqual(["zdir", "Adir"]);
    expect(buildListEntries(items, "/d", { ...base, typeFilter: "folders" }).filter((e) => !e.isParent).every((e) => e.is_dir)).toBe(true);
    expect(buildListEntries(items, "/d", { ...base, typeFilter: "files" }).filter((e) => !e.isParent).every((e) => !e.is_dir)).toBe(true);
  });

  it("filters files by name patterns but keeps folders", () => {
    const entries = buildListEntries(items, "/d", { ...base, namePatterns: [/\.txt$/i] }).map((e) => e.name);
    expect(entries).toContain("Adir");
    expect(entries).toContain("A.txt");
    expect(buildListEntries([item("x.exe")], "/d", { ...base, namePatterns: [/\.txt$/i] }).map((e) => e.name)).toEqual(["..."]);
  });

  it("builds the parent entry", () => {
    expect(getParentEntry("/a/b")).toMatchObject({ path: "/a", is_dir: true, isParent: true });
    expect(getParentEntry("/")).toBeNull();
    expect(getParentEntry(null)).toBeNull();
  });
});

describe("launchIntent and editorHandoff", () => {
  beforeEach(() => setSelectionIntent(null));

  it("keeps an intent only for a few seconds", () => {
    vi.useFakeTimers();
    setSelectionIntent("shortcut");
    expect(peekSelectionIntent()).toBe("shortcut");
    vi.advanceTimersByTime(6000);
    expect(peekSelectionIntent()).toBeNull();
    setSelectionIntent("text-editor");
    setSelectionIntent(null);
    expect(peekSelectionIntent()).toBeNull();
  });

  it("hands files to the editor and notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeEditorFile(listener);
    handOffToEditor({ path: "/a", content: "x" });
    expect(listener).toHaveBeenCalledWith({ path: "/a", content: "x" });
    expect(takePendingEditorFile()).toEqual({ path: "/a", content: "x" });
    expect(takePendingEditorFile()).toBeNull();
    unsubscribe();
    handOffToEditor({ path: "/b", content: "" });
    expect(listener).toHaveBeenCalledTimes(1);
    takePendingEditorFile();
  });
});

describe("filter patterns", () => {
  const filters = (patterns: string[], isDefault = true) => [{ name: "f", patterns, isDefault }];

  it("compiles globs case-insensitively", () => {
    const regexes = patternsForDefaultFilter(filters(["*.AppImage", "*.sh", "run?.bin"]))!;
    const matches = (name: string) => regexes.some((r) => r.test(name));
    expect(matches("game.appimage")).toBe(true);
    expect(matches("start.SH")).toBe(true);
    expect(matches("run1.bin")).toBe(true);
    expect(matches("run12.bin")).toBe(false);
    expect(matches("readme.txt")).toBe(false);
    expect(matches("a.shx")).toBe(false);
  });

  it("returns null for catch-all, empty and missing filters", () => {
    expect(patternsForDefaultFilter(filters(["*"]))).toBeNull();
    expect(patternsForDefaultFilter(filters([]))).toBeNull();
    expect(patternsForDefaultFilter([])).toBeNull();
  });

  it("uses the default filter, falling back to the first", () => {
    const list = [{ name: "a", patterns: ["*.a"], isDefault: false }, { name: "b", patterns: ["*.b"], isDefault: true }];
    expect(patternsForDefaultFilter(list)![0].test("x.b")).toBe(true);
    expect(patternsForDefaultFilter([{ name: "a", patterns: ["*.a"], isDefault: false }])![0].test("x.a")).toBe(true);
  });

  it("escapes regex characters in globs", () => {
    const [regex] = patternsForDefaultFilter(filters(["a+b(1).txt"]))!;
    expect(regex.test("a+b(1).txt")).toBe(true);
    expect(regex.test("aab1.txt")).toBe(false);
  });
});

describe("steam input and environment", () => {
  it("unregisters in every supported shape", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fn = vi.fn();
    unregisterSteamCallback(fn);
    const lower = vi.fn();
    unregisterSteamCallback({ unregister: lower });
    const upper = vi.fn();
    unregisterSteamCallback({ Unregister: upper });
    unregisterSteamCallback(undefined);
    unregisterSteamCallback(null);
    unregisterSteamCallback({ unregister: () => { throw new Error("x"); } });
    expect([fn, lower, upper].every((f) => f.mock.calls.length === 1)).toBe(true);
  });

  it("detects the gamepad UI", () => {
    expect(isGamepadUi()).toBe(false);
    (window as any).SteamUIStore = { WindowStore: { GamepadUIMainWindowInstance: {} } };
    expect(isGamepadUi()).toBe(true);
  });
});
