import { createElement, forwardRef, ReactNode } from "react";
import { vi } from "vitest";

const passthrough = (tag: string) =>
  forwardRef<any, any>(({ children, focusable, navEntryPreferPosition, onActivate, onCancel, onCancelButton, onCancelActionDescription, onOKActionDescription, onOptionsActionDescription, ...props }, ref) =>
    createElement(tag, { ref, ...props }, children));

export const Focusable = passthrough("div");
export const PanelSection = ({ title, children }: { title?: string; children?: ReactNode }) => createElement("section", { "data-title": title }, children);
export const PanelSectionRow = passthrough("div");
export const DialogBody = passthrough("div");
export const ModalRoot = ({ children, onCancel }: { children?: ReactNode; onCancel?: () => void }) =>
  createElement("div", { "data-modal-root": true, ref: (el: HTMLElement | null) => { if (el) (el as any).__cancel = onCancel; } }, children);
export const DialogButton = forwardRef<any, any>(({ children, onClick, disabled, style, ...rest }, ref) =>
  createElement("button", { ref, onClick, disabled, style, "data-dialog-button": true, ...pick(rest) }, children));
export const DialogButtonPrimary = DialogButton;
export const ButtonItem = ({ children, onClick, ...rest }: any) => createElement("button", { onClick, "data-button-item": true, ...pick(rest) }, children);
export const ToggleField = ({ label, checked, onChange }: any) =>
  createElement("label", null, label, createElement("input", { type: "checkbox", checked: !!checked, onChange: (e: any) => onChange?.(e.target.checked) }));
export const DropdownItem = ({ label, rgOptions, selectedOption, onChange, onMenuWillOpen }: any) =>
  createElement("div", { "data-dropdown": label },
    createElement("button", { "data-dropdown-open": true, onClick: () => onMenuWillOpen?.() }, label),
    ...rgOptions.map((option: any) => createElement("button", { key: String(option.data), "data-option": String(option.data), "aria-pressed": option.data === selectedOption, onClick: () => onChange?.(option) }, option.label)));
export const TextField = forwardRef<any, any>(({ value, onChange, onKeyDown, onFocus, onBlur, onClick, bIsPassword, "data-add-game-input": _a, ...rest }, ref) =>
  createElement("input", { ref, value: value ?? "", type: bIsPassword ? "password" : "text", onChange, onKeyDown, onFocus, onBlur, onClick, "data-textfield": true, ...pick(rest) }));
export const Menu = ({ label, children }: any) => createElement("div", { "data-menu": label }, children);
export const MenuItem = ({ children, onClick, onSelected, tone }: any) => createElement("button", { "data-menu-item": true, "data-tone": tone, onClick: onClick ?? onSelected }, children);
export const MenuSeparator = () => createElement("hr");

export const NavEntryPositionPreferences = { FIRST: 0, MAINTAIN_X: 1, MAINTAIN_Y: 2 };

export const Router = {
  CloseSideMenus: vi.fn(),
  Navigate: vi.fn(),
  NavigateBack: vi.fn(),
};
export const Navigation = { NavigateBack: vi.fn() };

export const showContextMenu = vi.fn((..._args: any[]) => ({ Hide: vi.fn() }));
export const showModal = vi.fn((..._args: any[]) => ({ Close: vi.fn(), Update: vi.fn() }));

export const findInReactTree = vi.fn((node: any, filter: (x: any) => boolean): any => {
  const seen = new Set<any>();
  const walk = (value: any): any => {
    if (!value || typeof value !== "object" || seen.has(value)) return undefined;
    seen.add(value);
    if (filter(value)) return value;
    for (const child of Object.values(value)) {
      const found = walk(child);
      if (found) return found;
    }
    return undefined;
  };
  return walk(node);
});
export const findInTree = vi.fn((tree: any, filter: (x: any) => boolean, _opts?: any) => findInReactTree(tree, filter));
export const findModule = vi.fn((_filter: any): any => undefined);
export const findModuleByExport = vi.fn((_filter: any): any => undefined);
export const fakeRenderComponent = vi.fn((_fn: any): any => undefined);
export const afterPatch = vi.fn((_object: any, _property: string, _handler: any) => ({ unpatch: vi.fn() }));

function pick(props: Record<string, unknown>) {
  const allowed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("data-") || key.startsWith("aria-") || key === "title" || key === "tabIndex" || key === "role") allowed[key] = value;
  }
  return allowed;
}
