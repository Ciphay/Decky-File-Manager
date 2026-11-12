import json
import os
import tempfile

from .file_picker import FilePicker
from .paths import expand_user_path, user_home


class Lifecycle(FilePicker):

    def _ensure_dir(self, directory: str) -> None:
        os.makedirs(directory, exist_ok=True)

    def _write_json_atomic(self, file_path: str, data: dict) -> None:
        self._ensure_dir(os.path.dirname(file_path))
        fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(file_path), suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, file_path)
        except BaseException:
            try:
                os.remove(tmp_path)
            except OSError:
                pass
            raise

    def _read_json(self, file_path: str) -> dict:
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (ValueError, OSError):
            return {}
        return data if isinstance(data, dict) else {}

    def _load_settings(self) -> None:
        self._settings = {"default_path": user_home()}
        default_path = self._read_json(self._settings_file).get("default_path")
        if isinstance(default_path, str) and default_path.strip():
            self._settings["default_path"] = os.path.abspath(expand_user_path(default_path))

    def _save_settings(self) -> None:
        self._write_json_atomic(self._settings_file, self._settings)

    def _load_runtime_state(self) -> None:
        data = self._read_json(self._runtime_file)
        clipboard = data.get("clipboard")
        clipboard = clipboard if isinstance(clipboard, dict) else {}
        path, kind = clipboard.get("path"), clipboard.get("kind")

        if isinstance(path, str) and kind in ("copy", "cut") and os.path.lexists(path):
            self._clipboard_path, self._clipboard_kind = os.path.abspath(path), kind
        else:
            self._clipboard_path = self._clipboard_kind = None

        last_path = data.get("last_path")
        self._last_path = os.path.abspath(last_path) if isinstance(last_path, str) and os.path.isdir(last_path) else None

    def _save_runtime_state(self) -> None:
        try:
            self._write_json_atomic(self._runtime_file, {
                "clipboard": {"path": self._clipboard_path, "kind": self._clipboard_kind},
                "last_path": self._last_path,
            })
        except OSError as e:
            import decky
            decky.logger.warning(f"Não foi possível salvar o estado: {e}")

    def _resolve_case_insensitive_path(self, file_path: str) -> str:
        expanded_path = expand_user_path(file_path)
        if os.path.exists(expanded_path):
            return expanded_path

        parent_dir = os.path.dirname(expanded_path)
        file_name = os.path.basename(expanded_path)
        if not parent_dir or not os.path.isdir(parent_dir):
            return expanded_path

        try:
            for entry in os.listdir(parent_dir):
                if entry.lower() == file_name.lower():
                    return os.path.join(parent_dir, entry)
        except OSError:
            pass
        return expanded_path

    async def read_file_content(self, file_path: str, max_size: int = 2097152) -> dict:
        try:
            resolved_path = self._resolve_case_insensitive_path(file_path)
            if not os.path.isfile(resolved_path):
                return {"success": False, "error": f"Arquivo não encontrado: {file_path}"}

            file_size = os.path.getsize(resolved_path)
            if file_size > max_size:
                return {"success": False, "error": f"Arquivo muito grande ({file_size} bytes, máximo {max_size})"}

            with open(resolved_path, "rb") as f:
                raw = f.read()
            if b"\x00" in raw:
                return {"success": False, "error": "Arquivo binário não pode ser editado como texto"}
            try:
                content = raw.decode("utf-8")
            except UnicodeDecodeError:
                return {"success": False, "error": "O arquivo não está em UTF-8 válido"}
            return {"success": True, "content": content, "size": file_size, "path": resolved_path}
        except Exception as e:
            return {"success": False, "error": f"Erro ao ler arquivo: {e}"}

    async def write_file_content(self, file_path: str, content: str) -> dict:
        try:
            if not file_path or not str(file_path).strip():
                return {"success": False, "error": "Caminho do arquivo não informado"}

            resolved_path = os.path.realpath(self._resolve_case_insensitive_path(file_path))
            parent_dir = os.path.dirname(resolved_path)
            os.makedirs(parent_dir, exist_ok=True)

            mode = None
            if os.path.exists(resolved_path):
                mode = os.stat(resolved_path).st_mode & 0o7777

            fd, tmp_path = tempfile.mkstemp(dir=parent_dir, prefix=".dm-edit-")
            try:
                with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
                    f.write(content or "")
                    f.flush()
                    os.fsync(f.fileno())
                if mode is not None:
                    os.chmod(tmp_path, mode)
                os.replace(tmp_path, resolved_path)
            except BaseException:
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
                raise

            return {"success": True, "path": resolved_path}
        except Exception as e:
            return {"success": False, "error": f"Erro ao salvar arquivo: {e}"}

    async def _main(self):
        import asyncio
        self.loop = asyncio.get_event_loop()

    async def _unload(self):
        pass

    async def _uninstall(self):
        pass

    async def _migration(self):
        import decky

        decky.logger.info("Migrating")
        decky.migrate_logs(os.path.join(decky.DECKY_USER_HOME, ".config", "decky-file-manager", "plugin.log"))
        decky.migrate_settings(
            os.path.join(decky.DECKY_HOME, "settings", "decky-file-manager.json"),
            os.path.join(decky.DECKY_USER_HOME, ".config", "decky-file-manager"))
        decky.migrate_runtime(
            os.path.join(decky.DECKY_HOME, "decky-file-manager"),
            os.path.join(decky.DECKY_USER_HOME, ".local", "share", "decky-file-manager"))
