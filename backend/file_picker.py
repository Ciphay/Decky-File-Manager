import json
import os
import urllib.parse

from .game_manager import GameManager


class FilePicker(GameManager):

    def set_file_selection(self, file_path: str, result_file: str | None = None) -> dict:
        self._selected_file = file_path
        self._selection_result_file = result_file

        if result_file:
            try:
                result_file = os.path.abspath(result_file)
                if os.path.islink(result_file) or os.path.isdir(result_file):
                    return {"success": False, "error": "Arquivo de resultado inválido"}
                os.makedirs(os.path.dirname(result_file), exist_ok=True)
                with open(result_file, "w", encoding="utf-8") as f:
                    json.dump({"selected_file": file_path}, f)
            except OSError as e:
                import decky
                decky.logger.error(f"Erro ao escrever resultado: {e}")
                return {"success": False, "error": str(e)}

        return {"success": True, "selected_file": file_path}

    async def open_file_picker(self, start_path: str = "", result_file: str | None = None) -> dict:
        self._selection_result_file = result_file
        url = f"/steam-os-file-manager/select?path={urllib.parse.quote(start_path)}"
        if result_file:
            url += f"&resultFile={urllib.parse.quote(result_file)}"
        return {"success": True, "url": url}

    async def open_file_picker_for_game(self, start_path: str = "") -> dict:
        return {"success": True, "url": f"/steam-os-file-manager/select-file?path={urllib.parse.quote(start_path)}"}

    async def validate_executable(self, executable_path: str) -> dict:
        if not executable_path or not os.path.exists(executable_path):
            return {"success": False, "error": f"Arquivo não encontrado: {executable_path}"}
        if not os.path.isfile(executable_path):
            return {"success": False, "error": f"Não é um arquivo: {executable_path}"}

        name = os.path.basename(executable_path).lower()
        return {"success": True, "path": executable_path, "name": os.path.splitext(name)[0]}
