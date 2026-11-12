import { createElement } from "react";
import { MenuItem, findInReactTree } from "@decky/ui";
import { t } from "../i18n";

export const EXPLORE_ITEM_KEY = "decky-manager-explore-local-files";

const APP_MENU_MARKERS = ["launchSource", "AppProperties", "RemoveShortcut", "ManageShortcut"];

export const getMenuOwnerComponent = (menuItems: unknown) => {
  if (!Array.isArray(menuItems)) {
    return null;
  }
  const found = findInReactTree(menuItems, (x: any) => x?.stateNode && typeof x.stateNode.forceUpdate === "function");
  return found?.stateNode ?? null;
};

export const forceMenuUpdate = (menuItems: unknown) => {
  const owner = getMenuOwnerComponent(menuItems);
  if (owner && typeof owner.forceUpdate === "function") {
    owner.forceUpdate();
  }
};

export const isOpeningAppContextMenu = (items: unknown): boolean => {
  if (!Array.isArray(items) || !items.length) {
    return false;
  }
  return !!findInReactTree(items, (x: any) => {
    const handler = x?.onSelected ?? x?.props?.onSelected;
    if (typeof handler !== "function") {
      return false;
    }
    const text = handler.toString();
    return APP_MENU_MARKERS.some((marker) => text.includes(marker));
  });
};

export const removeExploreItem = (items: unknown[]) => {
  const index = items.findIndex((item: any) => item?.key === EXPLORE_ITEM_KEY);
  if (index !== -1) {
    items.splice(index, 1);
  }
};

const findPropertiesIndex = (children: unknown[]): number => {
  const byHandler = children.findIndex((item) => findInReactTree(item, (x: any) => x?.onSelected && x.onSelected.toString().includes("AppProperties")));
  if (byHandler !== -1) {
    return byHandler;
  }
  return children.findIndex((item) =>
    findInReactTree(item, (x: any) => {
      const label = typeof x?.label === "string" ? x.label.toLowerCase() : "";
      const title = typeof x?.title === "string" ? x.title.toLowerCase() : "";
      return label === "properties" || title === "properties" || x?.key === "properties";
    }),
  );
};

const isTopLevelMenu = (children: unknown[]): boolean =>
  children.some((item: any) => {
    const text = `${item?.props?.label ?? ""} ${item?.props?.title ?? ""}`.toLowerCase();
    return text.includes("manage") || text.includes("gerenciar");
  });

export const spliceExploreLocalFilesItem = (children: unknown[], onSelect: () => void): boolean => {
  if (!Array.isArray(children)) {
    return false;
  }
  if (children.some((item: any) => item?.key === EXPLORE_ITEM_KEY)) {
    return true;
  }

  const propertiesIndex = findPropertiesIndex(children);
  const insertIndex = propertiesIndex !== -1 ? propertiesIndex : children.length;
  const hidden = isTopLevelMenu(children);

  children.splice(
    insertIndex,
    0,
    createElement(
      MenuItem as any,
      {
        key: EXPLORE_ITEM_KEY,
        style: hidden ? { display: "none" } : undefined,
        role: hidden ? "presentation" : undefined,
        "aria-hidden": hidden ? true : undefined,
        tabIndex: hidden ? -1 : undefined,
        focusable: hidden ? false : undefined,
        disabled: hidden ? true : undefined,
        onClick: onSelect,
      },
      t("action.explore_local_files"),
    ),
  );
  return true;
};
