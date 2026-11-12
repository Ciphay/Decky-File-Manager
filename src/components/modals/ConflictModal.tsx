import { DialogButton } from "@decky/ui";
import { t } from "../../i18n";
import ModalFrame from "./ModalFrame";

export type ConflictStrategy = "merge" | "replace" | "ignore" | "keep-both";

export default function ConflictModal({
  title,
  message,
  isFolder,
  onChoose,
  onCancel,
}: {
  title: string;
  message: string;
  isFolder: boolean;
  onChoose: (strategy: ConflictStrategy) => void;
  onCancel: () => void;
}) {
  const options: Array<[ConflictStrategy, string]> = isFolder
    ? [["merge", t("conflict.merge")], ["replace", t("conflict.replace")], ["ignore", t("conflict.ignore")]]
    : [["replace", t("conflict.replace")], ["keep-both", t("conflict.keep_both")], ["ignore", t("conflict.ignore")]];

  return (
    <ModalFrame title={title} onCancel={onCancel}>
      <div style={{ padding: "6px 0", textAlign: "center" }}>{message}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", marginTop: 16 }}>
        {options.map(([strategy, label]) => (
          <DialogButton key={strategy} onClick={() => onChoose(strategy)}>{label}</DialogButton>
        ))}
        <DialogButton onClick={onCancel}>{t("action.cancel")}</DialogButton>
      </div>
    </ModalFrame>
  );
}
