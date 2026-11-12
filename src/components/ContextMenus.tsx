import { ReactNode } from "react";
import { Menu, MenuItem, MenuSeparator } from "@decky/ui";
import { t } from "../i18n";
import { CopyIcon, CutIcon, DeleteIcon, DocumentIcon, ExtractIcon, NewFolderIcon, PasteIcon, PropertiesIcon, RenameIcon, SteamIcon } from "../Icons";

const Row = ({ icon, children }: { icon?: ReactNode; children: ReactNode }) => (
  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>{icon}{children}</span>
);

export type ItemMenuActions = {
  copy: () => void;
  cut: () => void;
  paste: () => void;
  extract: () => void;
  copyToOther: () => void;
  moveToOther: () => void;
  newFolder: () => void;
  openInEditor: () => void;
  addToSteam: () => void;
  rename: () => void;
  remove: () => void;
  properties: () => void;
};

export function BackgroundMenu({ clipboardHas, actions }: { clipboardHas: boolean; actions: Pick<ItemMenuActions, "paste" | "newFolder"> }) {
  return (
    <Menu label={t("menu.options")}>
      {clipboardHas ? <MenuItem onClick={actions.paste} onSelected={actions.paste}>{t("menu.paste")}</MenuItem> : null}
      <MenuItem onClick={actions.newFolder} onSelected={actions.newFolder}>{t("menu.newFolder")}</MenuItem>
    </Menu>
  );
}

export function ItemMenu({
  itemName,
  isDir,
  isArchive,
  clipboardHas,
  isSplit,
  side,
  actions,
}: {
  itemName: string;
  isDir: boolean;
  isArchive: boolean;
  clipboardHas: boolean;
  isSplit: boolean;
  side: "left" | "right";
  actions: ItemMenuActions;
}) {
  const item = (action: () => void, icon: ReactNode, label: string, tone?: "destructive") => (
    <MenuItem tone={tone} onClick={action} onSelected={action}>
      <Row icon={icon}>{label}</Row>
    </MenuItem>
  );

  return (
    <Menu label={`${t("menu.options")} : ${itemName}`}>
      {item(actions.copy, <CopyIcon />, t("menu.copy"))}
      {clipboardHas ? item(actions.paste, <PasteIcon />, t("menu.paste")) : null}
      {item(actions.cut, <CutIcon />, t("menu.cut"))}
      {isArchive ? item(actions.extract, <ExtractIcon />, t("menu.extract")) : null}

      {isSplit ? (
        <>
          <MenuSeparator />
          {item(actions.copyToOther, <CopyIcon />, side === "left" ? t("panel.copy_to_right") : t("panel.copy_to_left"))}
          {item(actions.moveToOther, <CutIcon />, side === "left" ? t("panel.move_to_right") : t("panel.move_to_left"))}
        </>
      ) : null}

      <MenuSeparator />
      {item(actions.newFolder, <NewFolderIcon />, t("menu.newFolder"))}
      <MenuSeparator />

      {!isDir ? item(actions.openInEditor, <DocumentIcon />, t("menu.openInTextEditor")) : null}
      {!isDir ? item(actions.addToSteam, <SteamIcon />, t("menu.addToSteam")) : null}
      {item(actions.rename, <RenameIcon />, t("menu.rename"))}
      {item(actions.remove, <DeleteIcon />, t("menu.delete"), "destructive")}
      {item(actions.properties, <PropertiesIcon />, t("menu.properties"))}
    </Menu>
  );
}
