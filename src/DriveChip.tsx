import { DialogButton, Focusable, NavEntryPositionPreferences } from "@decky/ui";
import { t } from "./i18n";
import { formatBytes } from "./utils/file";

type Props = {
  name: string;
  path: string;
  free?: number | null;
  mounted?: boolean;
  onSelect?: (path: string) => void;
};

export default function DriveChip({ name, path, free, mounted = true, onSelect }: Props) {
  const isMounted = mounted !== false;

  return (
    <Focusable
      navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
      style={{ flex: "0 0 170px", width: 170, display: "flex" }}
    >
      <DialogButton
        disabled={!isMounted}
        onClick={() => {
          if (isMounted) {
            onSelect?.(path);
          }
        }}
        style={{
          width: 170,
          minWidth: 170,
          maxWidth: 170,
          minHeight: 52,
          height: 52,
          padding: "8px 12px",
          textAlign: "left",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          boxSizing: "border-box",
          margin: 0,
          opacity: isMounted ? 1 : 0.7,
          flexShrink: 0,
        }}
        focusable
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4, minWidth: 0, width: "100%" }}>
          <span
            style={{
              fontSize: name.length > 12 ? 12 : 16,
              fontWeight: 600,
              lineHeight: 1.2,
              wordBreak: "break-word",
              overflowWrap: "anywhere",
              width: "100%",
            }}
          >
            {name}
          </span>
          <span style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.2, width: "100%" }}>
            {isMounted
              ? (free !== null && free !== undefined
                ? t("drive.free_space").replace("{value}", formatBytes(free))
                : t("drive.free_space_available"))
              : t("drive.not_mounted")}
          </span>
        </div>
      </DialogButton>
    </Focusable>
  );
}
