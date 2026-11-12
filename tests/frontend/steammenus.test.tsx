import { createElement } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Menu, MenuItem, findModule } from "./mocks/decky-ui";
import { installComponentRules } from "../../src/steamMenus/jsxHook";
import { installFolderMenus } from "../../src/steamMenus/folderMenus";

type Runtime = { jsx: (type: any, props: any, key?: any) => any; jsxs: (type: any, props: any, key?: any) => any };

const makeRuntime = (): Runtime => ({
  jsx: (type, props, key) => createElement(type, { ...props, key }),
  jsxs: (type, props, key) => createElement(type, { ...props, key }),
});

const keep = (_value: string): void => undefined;

const item = (label: string) => createElement(MenuItem as any, { key: label, onSelected: () => undefined }, label);

function StorageMenu({ folder }: { folder: any; fnEject: any; fnFormat: any }) {
  keep("#ContentManagement_BrowseFolder");
  return createElement(Menu as any, { label: "folder" }, [item("Make default"), item("Unmount"), item("Format"), false, item("Refresh")]);
}

describe("installComponentRules", () => {
  let runtime: Runtime;
  beforeEach(() => {
    runtime = makeRuntime();
    findModule.mockReturnValue(runtime);
  });
  afterEach(() => findModule.mockReset());

  const rule = (extra: Record<string, unknown> = {}) => ({
    matchesProps: (props: any) => props.marker === true,
    matchesSource: (source: string) => source.includes("needle"),
    wrap: (original: any) => (props: any) => original(props),
    ...extra,
  });

  it("wraps matching components with a stable identity and leaves the rest alone", () => {
    function Target() { return "needle"; }
    function Other() { return null; }
    const restore = installComponentRules([rule()]);
    const first = runtime.jsx(Target, { marker: true });
    const second = runtime.jsxs(Target, { marker: true });
    expect(first.type).not.toBe(Target);
    expect(first.type).toBe(second.type);
    expect(first.type.name).toBe("Target");
    expect(runtime.jsx(Other, { marker: true }).type).toBe(Other);
    expect(runtime.jsx("div", { marker: true }).type).toBe("div");
    restore();
    expect(runtime.jsx(Target, { marker: true }).type).toBe(Target);
  });

  it("remembers components whose source does not match and survives throwing matchers", () => {
    const matchesSource = vi.fn(() => false);
    function Plain() { return null; }
    installComponentRules([rule({ matchesSource })]);
    runtime.jsx(Plain, { marker: true });
    runtime.jsx(Plain, { marker: true });
    expect(matchesSource).toHaveBeenCalledTimes(1);

    const throwing = makeRuntime();
    findModule.mockReturnValue(throwing);
    installComponentRules([rule({ matchesProps: () => { throw new Error("x"); } })]);
    expect(throwing.jsx(Plain, { marker: true }).type).toBe(Plain);
  });

  it("does nothing when the JSX runtime cannot be found", () => {
    findModule.mockReturnValue(undefined);
    const restore = installComponentRules([rule()]);
    expect(() => restore()).not.toThrow();
  });
});

describe("folder menus", () => {
  let runtime: Runtime;
  let restore: () => void;
  const browse = vi.fn();
  const showOnDisk = vi.fn();

  beforeEach(() => {
    runtime = makeRuntime();
    findModule.mockReturnValue(runtime);
    (window as any).SteamClient = { InstallFolder: { BrowseFilesInFolder: browse }, Screenshots: { ShowScreenshotsOnDisk: showOnDisk } };
    restore = installFolderMenus();
  });
  afterEach(() => {
    restore();
    findModule.mockReset();
    browse.mockReset();
    showOnDisk.mockReset();
    delete (window as any).LocalizationManager;
  });

  const renderStorage = (folder: any) => render(runtime.jsx(StorageMenu, { folder, fnEject: null, fnFormat: null }));

  it("adds 'Browse folder' to the storage menu in the empty slot and opens the folder", () => {
    renderStorage({ nFolderIndex: 2, bIsMounted: true });
    const labels = screen.getAllByRole("button").map((button) => button.textContent);
    expect(labels).toEqual(["Make default", "Unmount", "Format", "Browse folder", "Refresh"]);
    fireEvent.click(screen.getByText("Browse folder"));
    expect(browse).toHaveBeenCalledWith(2);
  });

  it("uses Steam's own localized label when it is available", () => {
    (window as any).LocalizationManager = { LocalizeString: (token: string) => (token === "#ContentManagement_BrowseFolder" ? "Explorar pasta" : token) };
    renderStorage({ nFolderIndex: 0, bIsMounted: true });
    expect(screen.getByText("Explorar pasta")).toBeTruthy();
  });

  it("does not add it for folders that are not mounted, nor twice", () => {
    renderStorage({ nFolderIndex: 1, bIsMounted: false });
    expect(screen.queryByText("Browse folder")).toBeNull();
  });

  it("appends the item when there is no free slot and does not duplicate an existing one", () => {
    function FullMenu({ folder }: { folder: any; fnEject: any }) {
      keep("#ContentManagement_BrowseFolder");
      void folder;
      return createElement(Menu as any, { label: "f" }, [item("A"), item("Browse folder")]);
    }
    render(runtime.jsx(FullMenu, { folder: { nFolderIndex: 1, bIsMounted: true }, fnEject: null }));
    expect(screen.getAllByText("Browse folder")).toHaveLength(1);

    function ShortMenu({ folder }: { folder: any; fnEject: any }) {
      keep("#ContentManagement_BrowseFolder");
      void folder;
      return createElement(Menu as any, { label: "s" }, [item("A")]);
    }
    render(runtime.jsx(ShortMenu, { folder: { nFolderIndex: 4, bIsMounted: true }, fnEject: null }));
    expect(screen.getAllByText("Browse folder")).toHaveLength(2);
  });

  it("leaves unrelated components with similar props alone", () => {
    function Unrelated({ folder }: { folder: any; fnEject: any }) { return createElement("i", null, String(folder.nFolderIndex)); }
    const element = runtime.jsx(Unrelated, { folder: { nFolderIndex: 7, bIsMounted: true }, fnEject: null });
    expect(element.type).toBe(Unrelated);
  });

  it("screenshot viewer menu gets the item and it calls ShowScreenshotsOnDisk with the game id", () => {
    function ViewerMenu({ screenshot }: { screenshot: any }) {
      keep("ShowScreenshotsOnDisk");
      void screenshot;
      return createElement(Menu as any, { label: "v" }, [item("Copy"), false]);
    }
    render(runtime.jsx(ViewerMenu, { screenshot: { strGameID: "987" } }));
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Copy", "Show on disk"]);
    fireEvent.click(screen.getByText("Show on disk"));
    expect(showOnDisk).toHaveBeenCalledWith("987");
  });

  it("screenshot grid menu receives the extra option when Steam passes none", () => {
    function GridWrapper({ screenshot }: { screenshot: any }) {
      keep("ShowScreenshotsOnDisk");
      void screenshot;
      return { type: "grid", props: { additionalOptions: [] as any[] } } as any;
    }
    const element = runtime.jsx(GridWrapper, { screenshot: { strGameID: "55" } });
    const out = element.type({ screenshot: { strGameID: "55" } });
    expect(out.props.additionalOptions.map((option: any) => option.label)).toEqual(["Show on disk"]);
    out.props.additionalOptions[0].onSelected();
    expect(showOnDisk).toHaveBeenCalledWith("55");

    function GridWithOption({ screenshot }: { screenshot: any }) {
      keep("ShowScreenshotsOnDisk");
      void screenshot;
      return { type: "grid", props: { additionalOptions: [{ label: "Show on disk", onSelected: () => undefined }] } } as any;
    }
    const existing = runtime.jsx(GridWithOption, { screenshot: { strGameID: "55" } }).type({ screenshot: { strGameID: "55" } });
    expect(existing.props.additionalOptions).toHaveLength(1);
  });
});
