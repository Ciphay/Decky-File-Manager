import os
import asyncio
import json

from .file_picker import FilePicker


class Lifecycle(FilePicker):

    def _ensure_runtime_dir(self) -> None:
        import decky
        os.makedirs(decky.DECKY_PLUGIN_RUNTIME_DIR, exist_ok=True)

    def _ensure_settings_dir(self) -> None:
        import decky
        os.makedirs(decky.DECKY_PLUGIN_SETTINGS_DIR, exist_ok=True)

    def _load_settings(self) -> None:
        try:
            if os.path.exists(self._settings_file):
                with open(self._settings_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    default_path = data.get("default_path")
                    if isinstance(default_path, str) and default_path.strip():
                        self._settings["default_path"] = os.path.abspath(os.path.expanduser(default_path.strip()))
        except (ValueError, OSError):
            self._settings = {"default_path": os.path.expanduser("~")}

    def _save_settings(self) -> None:
        self._ensure_settings_dir()
        with open(self._settings_file, "w", encoding="utf-8") as f:
            json.dump(self._settings, f, ensure_ascii=False, indent=2)

    def _load_runtime_state(self) -> None:
        try:
            if os.path.exists(self._runtime_file):
                with open(self._runtime_file, "r", encoding="utf-8") as f:
                    data = json.load(f)

                clipboard = data.get("clipboard", {})
                path = clipboard.get("path")
                kind = clipboard.get("kind")
                if path and kind and os.path.exists(path):
                    self._clipboard_path = os.path.abspath(path)
                    self._clipboard_kind = kind
                else:
                    self._clipboard_path = None
                    self._clipboard_kind = None

                last_path = data.get("last_path")
                if last_path and os.path.isdir(last_path):
                    self._last_path = os.path.abspath(last_path)
                else:
                    self._last_path = None
            else:
                self._last_path = None
        except (ValueError, OSError):
            self._clipboard_path = None
            self._clipboard_kind = None
            self._last_path = None

    def _save_runtime_state(self) -> None:
        self._ensure_runtime_dir()
        data = {
            "clipboard": {
                "path": self._clipboard_path,
                "kind": self._clipboard_kind,
            },
            "last_path": self._last_path,
        }
        with open(self._runtime_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    async def read_file_content(self, file_path: str, max_size: int = 10485760) -> dict:
        try:
            resolved_path = self._resolve_case_insensitive_path(file_path)

            if not os.path.isfile(resolved_path):
                return {"success": False, "error": f"Arquivo não encontrado: {file_path}"}

            file_size = os.path.getsize(resolved_path)
            if file_size > max_size:
                return {"success": False, "error": f"Arquivo muito grande ({file_size} bytes, máximo {max_size})"}

            with open(resolved_path, 'r', encoding='utf-8', errors='replace') as f:
                content = f.read()

            return {"success": True, "content": content, "size": file_size}
        except Exception as e:
            return {"success": False, "error": f"Erro ao ler arquivo: {str(e)}"}

    async def write_file_content(self, file_path: str, content: str) -> dict:
        try:
            if not file_path or not str(file_path).strip():
                return {"success": False, "error": "Caminho do arquivo não informado"}

            resolved_path = self._resolve_case_insensitive_path(file_path)
            parent_dir = os.path.dirname(resolved_path)

            if parent_dir and not os.path.exists(parent_dir):
                os.makedirs(parent_dir, exist_ok=True)

            with open(resolved_path, 'w', encoding='utf-8', errors='surrogateescape') as f:
                f.write(content or "")

            return {"success": True, "path": resolved_path}
        except Exception as e:
            return {"success": False, "error": f"Erro ao salvar arquivo: {str(e)}"}

    def _resolve_case_insensitive_path(self, file_path: str) -> str:
        expanded_path = os.path.expanduser(file_path)
        if os.path.exists(expanded_path):
            return expanded_path

        normalized = os.path.normpath(expanded_path)
        parent_dir = os.path.dirname(normalized)
        file_name = os.path.basename(normalized)

        if not parent_dir or parent_dir == normalized:
            return expanded_path

        if not os.path.isdir(parent_dir):
            return expanded_path

        try:
            for entry in os.listdir(parent_dir):
                if entry.lower() == file_name.lower():
                    return os.path.join(parent_dir, entry)
        except OSError:
            pass

        return expanded_path

    async def long_running(self):
        await asyncio.sleep(15)
        pass

    async def _main(self):
        self.loop = asyncio.get_event_loop()

    async def _unload(self):
        pass

    async def _uninstall(self):
        pass

    def start_timer(self):
        if self.loop:
            self.loop.create_task(self.long_running())

    async def _migration(self):
        import decky
        
        decky.logger.info("Migrating")
        decky.migrate_logs(os.path.join(decky.DECKY_USER_HOME,
                               ".config", "decky-file-manager", "plugin.log"))
        decky.migrate_settings(
            os.path.join(decky.DECKY_HOME, "settings", "decky-file-manager.json"),
            os.path.join(decky.DECKY_USER_HOME, ".config", "decky-file-manager"))
        decky.migrate_runtime(
            os.path.join(decky.DECKY_HOME, "decky-file-manager"),
            os.path.join(decky.DECKY_USER_HOME, ".local", "share", "decky-file-manager"))
