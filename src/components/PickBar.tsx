import { DialogButton, Focusable, NavEntryPositionPreferences } from "@decky/ui";
import { t } from "../i18n";
import { PickSession } from "../fileDialog/pickerSession";

export default function PickBar({ session, currentPath }: { session: PickSession; currentPath: string }) {
  return (
    <div style={{ padding: "0 15px 8px" }}>
      {session.request.title ? <div style={{ fontSize: 18, fontWeight: 600, padding: "4px 0 8px" }}>{session.request.title}</div> : null}
      <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X} style={{ display: "flex", gap: 12 }}>
        {session.request.chooseDirectory ? (
          <DialogButton style={{ flex: 2, minWidth: 0 }} onClick={() => session.resolve(currentPath)}>
            {t("picker.select_folder")}
          </DialogButton>
        ) : null}
        <DialogButton style={{ flex: 1, minWidth: 0 }} onClick={session.cancel}>{t("action.cancel")}</DialogButton>
      </Focusable>
    </div>
  );
}
