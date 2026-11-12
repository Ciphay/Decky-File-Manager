import { DialogButton } from "@decky/ui";
import { t, getLocale } from "../../i18n";
import { PropertiesData } from "../../api";
import { formatBytes } from "../../utils/file";
import ModalFrame from "./ModalFrame";

const formatDate = (timestamp: number): string => {
  try {
    return new Intl.DateTimeFormat(getLocale(), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp * 1000));
  } catch {
    return new Date(timestamp * 1000).toLocaleString();
  }
};

const formatPermissions = (permissions: PropertiesData["permissions"]): string =>
  [permissions.owner, permissions.immutable ? t("properties.permission.immutable") : null].filter(Boolean).join(" • ");

export default function PropertiesModal({ data, calculating, onClose }: { data: PropertiesData; calculating: boolean; onClose: () => void }) {
  const size = data.type === "folder" && calculating ? t("properties.calculating") : data.size !== null ? formatBytes(data.size) : t("state.not_available");
  const rows: Array<[string, string]> = [
    [t("properties.name"), data.name],
    [t("properties.path"), data.path],
    [t("properties.type"), data.type === "folder" ? t("properties.type.folder") : t("properties.type.file")],
    [t("properties.size"), size],
    [t("properties.created"), formatDate(data.created)],
    [t("properties.modified"), formatDate(data.modified)],
    [t("properties.permissions"), formatPermissions(data.permissions)],
  ];

  return (
    <ModalFrame title={t("menu.properties")} onCancel={onClose} lockBackground={false}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, wordBreak: "break-all" }}>
        {rows.map(([label, value]) => (
          <div key={label}><strong>{label}</strong> {value}</div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
        <DialogButton onClick={onClose}>{t("action.close")}</DialogButton>
      </div>
    </ModalFrame>
  );
}
