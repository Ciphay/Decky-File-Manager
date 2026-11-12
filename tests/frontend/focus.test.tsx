import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { showContextMenu } from "./mocks/decky-ui";
import Toolbar from "../../src/components/Toolbar";
import {
  ModalFocusScope, getFocusableElements, getOverlaySelector, isElementActuallyVisible, isSteamMainMenuOpenInDom, isSteamQuickAccessMenuOpenInDom,
  isTextInputElement, safeBlur, safeClick, safeFocus, safeSetAttribute,
} from "../../src/utils/focus";

const sized = (el: HTMLElement, width = 100, height = 40) => { el.getBoundingClientRect = () => ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0 } as DOMRect); return el; };

describe("focus helpers", () => {
  it("getFocusableElements skips hidden, inert, aria-hidden and disabled elements", () => {
    const root = document.createElement("div");
    root.innerHTML = `<button id="ok">a</button><button disabled>b</button><button aria-hidden="true">c</button><div inert><button>d</button></div><button style="display:none">e</button><a href="#x">f</a><div tabindex="0">g</div><div tabindex="-1">h</div>`;
    document.body.appendChild(root);
    expect(getFocusableElements(root).map((e) => e.textContent)).toEqual(["a", "f", "g"]);
    expect(getFocusableElements(null)).toEqual([]);
    root.remove();
  });

  it("detects text inputs", () => {
    expect(isTextInputElement(document.createElement("input"))).toBe(true);
    expect(isTextInputElement(document.createElement("textarea"))).toBe(true);
    expect(isTextInputElement(document.createElement("select"))).toBe(true);
    expect(isTextInputElement(document.createElement("button"))).toBe(false);
    expect(isTextInputElement(null)).toBe(false);
    const editable = document.createElement("div");
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect(isTextInputElement(editable)).toBe(true);
  });

  it("the safe* helpers never throw", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bad: any = { focus() { throw new Error("x"); }, blur() { throw new Error("x"); }, click() { throw new Error("x"); }, setAttribute() { throw new Error("x"); } };
    safeFocus(bad); safeBlur(bad); safeClick(bad); safeSetAttribute(bad, "a", "b");
    safeFocus(null); safeBlur(undefined); safeClick(null); safeSetAttribute(null, "a", "b");
    const button = document.createElement("button");
    const onClick = vi.fn();
    button.addEventListener("click", onClick);
    safeClick(button);
    safeSetAttribute(button, "data-x", "1");
    expect(onClick).toHaveBeenCalled();
    expect(button.getAttribute("data-x")).toBe("1");
  });

  it("visibility rules and the overlay selector", () => {
    expect(isElementActuallyVisible(null)).toBe(false);
    const hidden = document.createElement("div");
    hidden.style.display = "none";
    expect(isElementActuallyVisible(hidden)).toBe(false);
    const invisible = document.createElement("div");
    invisible.style.visibility = "hidden";
    expect(isElementActuallyVisible(invisible)).toBe(false);
    const transparent = document.createElement("div");
    transparent.style.opacity = "0";
    expect(isElementActuallyVisible(transparent)).toBe(false);
    expect(isElementActuallyVisible(sized(document.createElement("div")))).toBe(true);
    expect(isElementActuallyVisible(document.createElement("div"))).toBe(false);
    expect(getOverlaySelector()).toContain("[role='menu']");
    expect(getOverlaySelector()).toContain("#QuickAccess-Menu");
  });

  it("detects the quick access menu by DOM id, by navigation tree and by window name", () => {
    expect(isSteamQuickAccessMenuOpenInDom()).toBe(false);
    const menu = sized(document.createElement("div"));
    menu.id = "QuickAccess-Menu";
    document.body.appendChild(menu);
    expect(isSteamQuickAccessMenuOpenInDom()).toBe(true);
    menu.remove();
    (window as any).GamepadNavTree = { m_context: { m_ActiveContext: { m_rgGamepadNavigationTrees: [{ id: "QuickAccess_tree", m_Root: { m_element: { ownerDocument: { hidden: false } } } }] } } };
    expect(isSteamQuickAccessMenuOpenInDom()).toBe(true);
    (window as any).GamepadNavTree = { m_context: { m_ActiveContext: { m_rgGamepadNavigationTrees: [{ id: "QuickAccess_tree", m_Root: { m_element: { ownerDocument: { hidden: true } } } }] } } };
    expect(isSteamQuickAccessMenuOpenInDom()).toBe(false);
    delete (window as any).GamepadNavTree;
    const original = window.name;
    window.name = "QuickAccess_uid3";
    expect(isSteamQuickAccessMenuOpenInDom()).toBe(true);
    window.name = original;
  });

  it("detects the Steam main menu by DOM and by navigation tree", () => {
    expect(isSteamMainMenuOpenInDom()).toBe(false);
    const menu = sized(document.createElement("div"));
    menu.id = "MainMenu";
    document.body.appendChild(menu);
    expect(isSteamMainMenuOpenInDom()).toBe(true);
    menu.remove();
    (window as any).FocusNavController = { m_ActiveContext: { m_rgGamepadNavigationTrees: [{ id: "SteamMenu_tree", m_Root: { m_element: { ownerDocument: { hidden: false } } } }] } };
    expect(isSteamMainMenuOpenInDom()).toBe(true);
    delete (window as any).FocusNavController;
    expect(isSteamMainMenuOpenInDom()).toBe(false);
  });
});

describe("ModalFocusScope", () => {
  it("focuses the first control, traps Tab, handles arrows and restores focus on unmount", () => {
    const outside = document.createElement("button");
    outside.textContent = "outside";
    document.body.appendChild(outside);
    outside.focus();
    const { unmount } = render(
      <ModalFocusScope>
        <button style={{ display: "block" }}>one</button>
        <button>two</button>
        <input aria-label="field" />
      </ModalFocusScope>,
    );
    const scope = document.querySelector("[data-modal-focus-scope]") as HTMLElement;
    const buttons = within(scope).getAllByRole("button");
    buttons.forEach((b) => sized(b));
    sized(screen.getByLabelText("field"));
    expect(scope.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(buttons[1]);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByLabelText("field"));
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByLabelText("field"));
    buttons[1].focus();
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByLabelText("field"));
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByLabelText("field"));
    buttons[1].focus();
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(document.activeElement).toBe(buttons[0]);
    outside.focus();
    fireEvent.keyDown(document, { key: "x" });
    expect(scope.contains(document.activeElement)).toBe(true);
    unmount();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("pulls focus back when something outside takes it", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    render(<ModalFocusScope><button>inside</button></ModalFocusScope>);
    sized(screen.getByText("inside"));
    fireEvent.focusIn(outside);
    expect(document.activeElement).toBe(screen.getByText("inside"));
    outside.remove();
  });
});

describe("Toolbar dropdown context menus", () => {
  it("opens a context menu for the order and type dropdowns and applies the choice", () => {
    const overlay: any = { clearContextMenu: vi.fn(), contextMenuRef: { current: null } };
    const onSortOrder = vi.fn(), onTypeFilter = vi.fn();
    render(<Toolbar overlay={overlay} showHidden={false} onShowHidden={vi.fn()} isSplit={false} canSplit onSplit={vi.fn()} sortOrder="asc" onSortOrder={onSortOrder} typeFilter="all" onTypeFilter={onTypeFilter} />);
    const [orderOpen, typeOpen] = Array.from(document.querySelectorAll("[data-dropdown-open]")) as HTMLElement[];
    fireEvent.click(orderOpen);
    const orderMenu: any = (showContextMenu as any).mock.calls.at(-1)[0];
    expect(orderMenu.props.label).toBe("Order");
    orderMenu.props.children[1].props.onClick();
    expect(onSortOrder).toHaveBeenCalledWith("desc");
    expect(overlay.clearContextMenu).toHaveBeenCalled();
    expect(overlay.contextMenuRef.current).toBeTruthy();
    fireEvent.click(typeOpen);
    const typeMenu: any = (showContextMenu as any).mock.calls.at(-1)[0];
    typeMenu.props.children[2].props.onSelected();
    expect(onTypeFilter).toHaveBeenCalledWith("files");
  });
});
