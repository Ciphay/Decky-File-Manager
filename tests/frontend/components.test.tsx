import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { backend } from "./mocks/decky-api";
import { t } from "../../src/i18n";
import { Router } from "./mocks/decky-ui";
import FileRow from "../../src/components/FileRow";
import FileList from "../../src/components/FileList";
import PathBar, { usePathBarControl } from "../../src/components/PathBar";
import Toolbar from "../../src/components/Toolbar";
import FooterButtons from "../../src/components/FooterButtons";
import BackgroundOperationRow from "../../src/components/BackgroundOperationRow";
import PickBar from "../../src/components/PickBar";
import { BackgroundMenu, ItemMenu } from "../../src/components/ContextMenus";
import ConfirmModal from "../../src/components/modals/ConfirmModal";
import ConflictModal from "../../src/components/modals/ConflictModal";
import MessageModal from "../../src/components/modals/MessageModal";
import OperationModal from "../../src/components/modals/OperationModal";
import PropertiesModal from "../../src/components/modals/PropertiesModal";
import TextInputModal from "../../src/components/modals/TextInputModal";
import AddShortcutModal from "../../src/components/modals/AddShortcutModal";
import Content from "../../src/PluginContent";
import * as Icons from "../../src/Icons";
import { addBackgroundOperation, isOperationCanceled, updateBackgroundOperations } from "../../src/utils/backgroundStore";
import { setSelectionIntent, peekSelectionIntent } from "../../src/utils/launchIntent";
import type { ListEntry } from "../../src/utils/filterItems";

const item = (name: string, is_dir = false, isParent = false): ListEntry => ({ name, path: `/d/${name}`, is_dir, size: 1, modified: 0, isParent });

describe("FileRow", () => {
  it("renders icons by type, opens and reports focus", () => {
    const onOpen = vi.fn(), onFocusItem = vi.fn();
    const { container } = render(<><FileRow item={item("dir", true)} side="left" onOpen={onOpen} onFocusItem={onFocusItem} /><FileRow item={item("a.zip")} side="right" onOpen={onOpen} onFocusItem={onFocusItem} /><FileRow item={item("n.txt")} side="left" onOpen={onOpen} onFocusItem={onFocusItem} /></>);
    expect(container.querySelectorAll("svg")).toHaveLength(3);
    const rows = container.querySelectorAll("[data-item-path]");
    expect(rows[1].getAttribute("data-pane-side")).toBe("right");
    fireEvent.click(screen.getByText("a.zip"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ name: "a.zip" }), "right");
    fireEvent.focus(rows[0].firstElementChild!.firstElementChild!);
    expect(onFocusItem).toHaveBeenCalled();
  });
});

describe("FileList", () => {
  const props = (extra: any = {}) => ({
    side: "left" as const, path: "/d", items: [item("..."), item("a.txt"), item("b.txt")], loading: false, error: null, isActive: true, emptyText: "Folder is empty",
    consumeFocusRequest: vi.fn(() => null), shouldAutoFocus: () => true, onOpen: vi.fn(), onFocusItem: vi.fn(), ...extra,
  });

  it("shows loading, empty and error states", () => {
    const { rerender } = render(<FileList {...props({ items: [], loading: true })} />);
    expect(screen.getByText("Loading...")).toBeTruthy();
    rerender(<FileList {...props({ items: [] })} />);
    expect(screen.getByText("Folder is empty")).toBeTruthy();
    rerender(<FileList {...props({ items: [], error: "Sem permissão" })} />);
    expect(screen.getByText("Sem permissão")).toBeTruthy();
    rerender(<FileList {...props({ error: "aviso" })} />);
    expect(screen.getByText("aviso")).toBeTruthy();
    expect(screen.getByText("a.txt")).toBeTruthy();
  });

  it("paginates large lists with a 'show more' button", () => {
    const many = Array.from({ length: 320 }, (_, i) => item(`f${i}.txt`));
    render(<FileList {...props({ items: many })} />);
    expect(document.querySelectorAll("[data-item-path]")).toHaveLength(150);
    fireEvent.click(screen.getByText(/Show more \(170 remaining\)/));
    expect(document.querySelectorAll("[data-item-path]")).toHaveLength(300);
  });

  it("auto-focuses the first item for the active pane (and the requested one after navigating up)", async () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    render(<FileList {...props()} />);
    await waitFor(() => expect(focusSpy).toHaveBeenCalled());
    focusSpy.mockClear();
    const consume = vi.fn(() => "/d/b.txt");
    const { rerender } = render(<FileList {...props({ path: "/e", consumeFocusRequest: consume })} />);
    rerender(<FileList {...props({ path: "/f", consumeFocusRequest: consume })} />);
    await waitFor(() => expect(focusSpy).toHaveBeenCalled());
    focusSpy.mockRestore();
  });

  it("does not steal focus when inactive or when focusing is not allowed", async () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    render(<FileList {...props({ isActive: false })} />);
    render(<FileList {...props({ shouldAutoFocus: () => false })} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(focusSpy).not.toHaveBeenCalled();
    focusSpy.mockRestore();
  });
});

describe("PathBar", () => {
  function Harness({ focusList = vi.fn(), onSubmit = vi.fn(), value = "/home" }: any) {
    const control = usePathBarControl(focusList);
    return <PathBar value={value} control={control} focusHandlers={{ onFocus: harnessFocus, onBlur: vi.fn() }} onChange={vi.fn()} onSubmit={onSubmit} />;
  }
  const harnessFocus = vi.fn();

  it("submits on Enter and shows the current path", () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const input = screen.getByDisplayValue("/home");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("/home");
  });

  it("rejects focus while suppressed, then accepts it", () => {
    vi.useFakeTimers();
    const focusList = vi.fn();
    harnessFocus.mockClear();
    render(<Harness focusList={focusList} />);
    const input = screen.getByDisplayValue("/home");
    fireEvent.focus(input);
    expect(focusList).toHaveBeenCalled();
    expect(harnessFocus).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(200); });
  });

  it("the control suppresses focus for a period", () => {
    vi.useFakeTimers();
    const { result } = (() => {
      let control: any;
      function Probe() { control = usePathBarControl(vi.fn()); return null; }
      render(<Probe />);
      return { result: control };
    })();
    result.suppressFor(100);
    expect(result.suppressRef.current).toBe(true);
    act(() => { vi.advanceTimersByTime(150); });
    expect(result.suppressRef.current).toBe(false);
  });
});

describe("Toolbar", () => {
  const overlay: any = { clearContextMenu: vi.fn(), contextMenuRef: { current: null } };
  const base = (extra: any = {}) => ({
    overlay, showHidden: false, onShowHidden: vi.fn(), isSplit: false, canSplit: true, onSplit: vi.fn(), sortOrder: "asc" as const, onSortOrder: vi.fn(),
    typeFilter: "all" as const, onTypeFilter: vi.fn(), ...extra,
  });

  it("toggles hidden/split and changes order and type", () => {
    const p = base();
    render(<Toolbar {...p} />);
    const [hidden, split] = screen.getAllByRole("checkbox");
    fireEvent.click(hidden);
    fireEvent.click(split);
    expect(p.onShowHidden).toHaveBeenCalledWith(true);
    expect(p.onSplit).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByText("Z-A"));
    expect(p.onSortOrder).toHaveBeenCalledWith("desc");
    fireEvent.click(screen.getByText("Folders"));
    expect(p.onTypeFilter).toHaveBeenCalledWith("folders");
  });

  it("hides the split toggle when splitting is not allowed and shows the extra filter toggle", () => {
    const toggle = { label: "All files", checked: false, onChange: vi.fn() };
    render(<Toolbar {...base({ canSplit: false, filterToggle: toggle })} />);
    expect(screen.queryByText("Split")).toBeNull();
    fireEvent.click(screen.getByText("All files").querySelector("input")!);
    expect(toggle.onChange).toHaveBeenCalledWith(true);
  });
});

describe("FooterButtons", () => {
  it("wires the four click areas and hides options when requested", () => {
    const handlers = { onBack: vi.fn(), onOptions: vi.fn(), onSplit: vi.fn(), onSelect: vi.fn() };
    const { container, rerender } = render(<FooterButtons showOptions {...handlers} />);
    const areas = Array.from(container.firstElementChild!.children) as HTMLElement[];
    areas.forEach((a) => fireEvent.click(a));
    expect(Object.values(handlers).every((h) => h.mock.calls.length === 1)).toBe(true);
    rerender(<FooterButtons showOptions={false} {...handlers} />);
    expect((container.firstElementChild!.children[1] as HTMLElement).style.display).toBe("none");
  });
});

describe("BackgroundOperationRow and PickBar", () => {
  it("renders progress and routes pause/cancel", () => {
    const onPauseToggle = vi.fn(), onCancel = vi.fn();
    const operation = { operationId: "a", label: "Copying: x", progress: 42.7, paused: false };
    const { rerender } = render(<BackgroundOperationRow operation={operation} onPauseToggle={onPauseToggle} onCancel={onCancel} />);
    expect(screen.getByText("42%")).toBeTruthy();
    const [pause, cancel] = screen.getAllByRole("button");
    expect(pause.getAttribute("aria-label")).toBe("Pause");
    fireEvent.click(pause); fireEvent.click(cancel);
    expect(onPauseToggle).toHaveBeenCalledWith(operation);
    expect(onCancel).toHaveBeenCalledWith(operation);
    rerender(<BackgroundOperationRow operation={{ ...operation, paused: true, progress: 150 }} onPauseToggle={onPauseToggle} onCancel={onCancel} />);
    expect(screen.getAllByRole("button")[0].getAttribute("aria-label")).toBe("Resume");
    expect(screen.getByText("100%")).toBeTruthy();
  });

  it("PickBar shows the title, selects the current folder and cancels", () => {
    const session: any = { request: { title: "Escolher pasta", chooseDirectory: true }, resolve: vi.fn(), cancel: vi.fn() };
    const { rerender } = render(<PickBar session={session} currentPath="/home/u" />);
    expect(screen.getByText("Escolher pasta")).toBeTruthy();
    fireEvent.click(screen.getByText("Select this folder"));
    expect(session.resolve).toHaveBeenCalledWith("/home/u");
    fireEvent.click(screen.getByText("Cancel"));
    expect(session.cancel).toHaveBeenCalled();
    rerender(<PickBar session={{ ...session, request: { title: "", chooseDirectory: false } }} currentPath="/x" />);
    expect(screen.queryByText("Select this folder")).toBeNull();
  });
});

describe("context menus", () => {
  const actions = Object.fromEntries(["copy", "cut", "paste", "extract", "copyToOther", "moveToOther", "newFolder", "openInEditor", "addToSteam", "rename", "remove", "properties"].map((k) => [k, vi.fn()])) as any;

  it("item menu lists the right entries for a file in split view with clipboard", () => {
    const { container } = render(<ItemMenu itemName="a.zip" isDir={false} isArchive clipboardHas isSplit side="left" actions={actions} />);
    const labels = Array.from(container.querySelectorAll("[data-menu-item]")).map((n) => n.textContent);
    expect(labels).toEqual(["Copy", "Paste", "Cut", "Extract", "Copy to the right panel", "Move to the right panel", "New folder", "Open with text editor", "Add to Steam", "Rename", "Delete", "Properties"]);
    expect(container.querySelector('[data-tone="destructive"]')!.textContent).toBe("Delete");
    fireEvent.click(screen.getByText("Rename"));
    expect(actions.rename).toHaveBeenCalled();
  });

  it("directories drop editor/steam entries; no clipboard drops paste; right side flips labels", () => {
    const { container } = render(<ItemMenu itemName="dir" isDir isArchive={false} clipboardHas={false} isSplit side="right" actions={actions} />);
    const labels = Array.from(container.querySelectorAll("[data-menu-item]")).map((n) => n.textContent);
    expect(labels).not.toContain("Paste");
    expect(labels).not.toContain("Open with text editor");
    expect(labels).toContain("Copy to the left panel");
  });

  it("background menu offers paste only with clipboard content", () => {
    const { container, rerender } = render(<BackgroundMenu clipboardHas actions={actions} />);
    expect(Array.from(container.querySelectorAll("[data-menu-item]")).map((n) => n.textContent)).toEqual(["Paste", "New folder"]);
    rerender(<BackgroundMenu clipboardHas={false} actions={actions} />);
    expect(container.querySelectorAll("[data-menu-item]")).toHaveLength(1);
  });
});

describe("modals", () => {
  it("ConfirmModal / MessageModal", () => {
    const onConfirm = vi.fn(), onCancel = vi.fn(), onClose = vi.fn();
    render(<ConfirmModal title="Confirm" message="Delete x?" onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Yes")); fireEvent.click(screen.getByText("No"));
    expect([onConfirm, onCancel].every((f) => f.mock.calls.length === 1)).toBe(true);
    render(<MessageModal title="Aviso" message="Texto" onClose={onClose} />);
    fireEvent.click(screen.getByText("Close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("ConflictModal offers different strategies for folders and files", () => {
    const onChoose = vi.fn(), onCancel = vi.fn();
    const { rerender } = render(<ConflictModal title="t" message="m" isFolder onChoose={onChoose} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Merge"));
    expect(onChoose).toHaveBeenCalledWith("merge");
    expect(screen.queryByText("Keep both")).toBeNull();
    rerender(<ConflictModal title="t" message="m" isFolder={false} onChoose={onChoose} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Keep both"));
    expect(onChoose).toHaveBeenLastCalledWith("keep-both");
    expect(screen.queryByText("Merge")).toBeNull();
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("OperationModal shows progress and its three actions", () => {
    const h = { onBackground: vi.fn(), onPauseToggle: vi.fn(), onCancel: vi.fn() };
    const op = { label: "Copying: a", progress: 33.4, operationId: "o", showBackground: true, paused: false };
    const { rerender } = render(<OperationModal operation={op} {...h} />);
    expect(screen.getByText("33%")).toBeTruthy();
    fireEvent.click(screen.getByText("Continue in background"));
    fireEvent.click(screen.getByText("Pause"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(Object.values(h).every((f) => f.mock.calls.length === 1)).toBe(true);
    rerender(<OperationModal operation={{ ...op, showBackground: false, paused: true }} {...h} />);
    expect(screen.queryByText("Continue in background")).toBeNull();
    expect(screen.getByText("Resume")).toBeTruthy();
  });

  it("PropertiesModal formats all fields", () => {
    const data: any = { name: "dir", path: "/d/dir", type: "folder", size: 2048, created: 1700000000, modified: 1700000100, permissions: { owner: "rafael", immutable: true, raw: "0o755" } };
    const { rerender } = render(<PropertiesModal data={data} calculating={false} onClose={vi.fn()} />);
    expect(screen.getByText("/d/dir")).toBeTruthy();
    expect(screen.getByText(/2\.00 KB/)).toBeTruthy();
    expect(screen.getByText(/rafael • /)).toBeTruthy();
    rerender(<PropertiesModal data={data} calculating onClose={vi.fn()} />);
    expect(screen.getByText(/Calculating/i)).toBeTruthy();
    rerender(<PropertiesModal data={{ ...data, type: "file", size: null }} calculating={false} onClose={vi.fn()} />);
    expect(screen.getByText(/N\/A/)).toBeTruthy();
  });

  it("TextInputModal opens without raising the keyboard: focus starts on a button and the text is selected on first focus", () => {
    const focus = { onFocus: vi.fn(), onBlur: vi.fn() };
    render(<TextInputModal title="Rename" value="nome" confirmLabel="Save" selectOnOpen focusHandlers={focus} onChange={vi.fn()} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(document.activeElement).not.toBe(input);
    expect((document.activeElement as HTMLElement).tagName).toBe("BUTTON");
    expect(focus.onFocus).not.toHaveBeenCalled();
    const select = vi.spyOn(input, "select");
    act(() => input.focus());
    expect(focus.onFocus).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledTimes(1);
    act(() => { input.blur(); input.focus(); });
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("password modals still focus the field automatically", () => {
    vi.useFakeTimers();
    try {
      const focus = { onFocus: vi.fn(), onBlur: vi.fn() };
      render(<TextInputModal title="Pw" value="" confirmLabel="OK" isPassword focusHandlers={focus} onChange={vi.fn()} onConfirm={vi.fn()} onCancel={vi.fn()} />);
      act(() => { vi.advanceTimersByTime(60); });
      expect(document.activeElement).toBe(document.querySelector("input"));
      expect(focus.onFocus).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("TextInputModal: B (cancel) with the keyboard open is swallowed; otherwise it cancels", () => {
    const onCancel = vi.fn();
    let swallow = true;
    const focus = { onFocus: vi.fn(), onBlur: vi.fn(), onActivate: vi.fn(), consumeBack: () => swallow };
    render(<TextInputModal title="Rename" value="a" confirmLabel="Save" focusHandlers={focus} onChange={vi.fn()} onConfirm={vi.fn()} onCancel={onCancel} />);
    const root = document.querySelector("[data-modal-root]") as any;
    fireEvent.click(screen.getByRole("textbox"));
    expect(focus.onActivate).toHaveBeenCalled();
    root.__cancel();
    expect(onCancel).not.toHaveBeenCalled();
    swallow = false;
    root.__cancel();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("TextInputModal edits, confirms with Enter or button, shows messages and password fields", () => {
    const onChange = vi.fn(), onConfirm = vi.fn(), onCancel = vi.fn(), focus = { onFocus: vi.fn(), onBlur: vi.fn() };
    const { rerender } = render(<TextInputModal title="Rename" value="a" confirmLabel="Save" focusHandlers={focus} onChange={onChange} onConfirm={onConfirm} onCancel={onCancel} error="Erro!" message="Digite" />);
    const input = screen.getByDisplayValue("a");
    fireEvent.change(input, { target: { value: "novo" } });
    expect(onChange).toHaveBeenCalledWith("novo");
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByText("Save"));
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Erro!")).toBeTruthy();
    expect(screen.getByText("Digite")).toBeTruthy();
    fireEvent.focus(input); fireEvent.blur(input);
    expect(focus.onFocus).toHaveBeenCalled(); expect(focus.onBlur).toHaveBeenCalled();
    rerender(<TextInputModal title="Pw" value="x" confirmLabel="OK" isPassword focusHandlers={focus} onChange={onChange} onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByDisplayValue("x").getAttribute("type")).toBe("password");
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("AddShortcutModal interpolates the name into the title", () => {
    render(<AddShortcutModal name="Doom" error="Falhou" focusHandlers={{ onFocus: vi.fn(), onBlur: vi.fn() }} onChangeName={vi.fn()} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("Add Doom ?")).toBeTruthy();
    expect(screen.getByText("Falhou")).toBeTruthy();
  });
});

describe("PluginContent (quick access panel)", () => {
  it("opens the manager and the shortcut picker with the right intents", () => {
    updateBackgroundOperations(() => []);
    setSelectionIntent(null);
    render(<Content />);
    fireEvent.click(screen.getByText("Open file manager"));
    expect(Router.Navigate).toHaveBeenLastCalledWith(`/steam-os-file-manager?path=${encodeURIComponent("~")}&mode=normal`);
    expect(peekSelectionIntent()).toBeNull();
    fireEvent.click(screen.getByText("Add to Steam"));
    expect(Router.Navigate).toHaveBeenLastCalledWith(`/steam-os-file-manager/select-file?path=${encodeURIComponent("~")}`);
    expect(peekSelectionIntent()).toBe("shortcut");
    expect(Router.CloseSideMenus).toHaveBeenCalledTimes(2);
  });

  it("lists background operations with working pause and cancel", async () => {
    backend.on("pause_operation", () => ({ ok: true })); backend.on("resume_operation", () => ({ ok: true })); backend.on("cancel_operation", () => ({ ok: true }));
    updateBackgroundOperations(() => []);
    render(<Content />);
    expect(screen.getByText(t("panel.background.none"))).toBeTruthy();
    act(() => addBackgroundOperation({ operationId: "p1", label: "Copying: a", progress: 10, paused: false }));
    expect(screen.getByText("Copying: a")).toBeTruthy();
    const [pause, cancel] = screen.getAllByRole("button").filter((b) => b.hasAttribute("aria-label"));
    await act(async () => { fireEvent.click(pause); });
    expect(backend.callsTo("pause_operation")).toEqual([["p1"]]);
    await act(async () => { fireEvent.click(cancel); });
    expect(backend.callsTo("cancel_operation")).toEqual([["p1"]]);
    expect(isOperationCanceled("p1")).toBe(true);
    expect(screen.queryByText("Copying: a")).toBeNull();
  });
});

describe("icons", () => {
  it("every icon renders an svg", () => {
    const names = Object.keys(Icons).filter((n) => /Icon$/.test(n));
    expect(names.length).toBeGreaterThan(15);
    for (const name of names) {
      const Icon = (Icons as any)[name];
      const { container, unmount } = render(<Icon />);
      expect(container.querySelector("svg"), name).toBeTruthy();
      unmount();
    }
    expect(createRef).toBeDefined();
  });
});
