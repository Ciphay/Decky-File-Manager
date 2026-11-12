import { FocusHandlers } from "../../hooks/useInputGuards";
import { t, tf } from "../../i18n";
import TextInputModal from "./TextInputModal";

export default function AddShortcutModal({
  name,
  error,
  focusHandlers,
  onChangeName,
  onConfirm,
  onCancel,
}: {
  name: string;
  error: string | null;
  focusHandlers: FocusHandlers;
  onChangeName: (name: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <TextInputModal
      title={tf("modal.add_shortcut_title", { name })}
      value={name}
      error={error}
      confirmLabel={t("action.yes")}
      focusHandlers={focusHandlers}
      onChange={onChangeName}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
