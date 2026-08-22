import os
import re
import subprocess
from pathlib import Path

from .clipboard import Clipboard


class GameManager(Clipboard):

    def _get_steam_root_candidates(self) -> list[Path]:
        roots = [
            Path.home() / ".local" / "share" / "Steam",
            Path.home() / ".steam" / "steam",
        ]

        candidates: list[Path] = []
        seen: set[Path] = set()
        for root in roots:
            if root.exists() and root not in seen:
                candidates.append(root)
                seen.add(root)
        return candidates

    def _get_shortcuts_vdf_candidates(self) -> list[Path]:
        candidates: list[Path] = []
        roots = [
            Path.home() / ".local" / "share" / "Steam" / "userdata",
            Path.home() / ".steam" / "steam" / "userdata",
        ]

        for root in roots:
            if not root.exists():
                continue
            for user_dir in root.iterdir():
                if not user_dir.is_dir():
                    continue
                shortcut_path = user_dir / "config" / "shortcuts.vdf"
                if shortcut_path.is_file():
                    candidates.append(shortcut_path)

        return candidates

    def _read_vdf_paths(self, libraryfolders_path: Path) -> list[Path]:
        try:
            content = libraryfolders_path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            return []

        paths: list[Path] = []
        seen: set[Path] = set()
        for match in re.findall(r'"path"\s+"([^"]+)"', content):
            candidate = Path(match)
            if not candidate.exists() or candidate in seen:
                continue
            paths.append(candidate)
            seen.add(candidate)
        return paths

    def _resolve_steam_appmanifest_path(self, appid: int) -> str | None:
        manifest_name = f"appmanifest_{appid}.acf"

        for steam_root in self._get_steam_root_candidates():
            steamapps_root = steam_root / "steamapps"
            manifest_path = steamapps_root / manifest_name
            if not manifest_path.is_file():
                continue

            try:
                manifest_text = manifest_path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue

            installdir_match = re.search(r'"installdir"\s+"([^"]+)"', manifest_text)
            if not installdir_match:
                continue

            installdir = installdir_match.group(1).strip()
            if not installdir:
                continue

            library_paths: list[Path] = [steam_root]
            libraryfolders_path = steam_root / "libraryfolders.vdf"
            if libraryfolders_path.is_file():
                library_paths.extend(self._read_vdf_paths(libraryfolders_path))

            for library_root in library_paths:
                common_dir = library_root / "steamapps" / "common" / installdir
                if common_dir.exists():
                    return str(common_dir)

            common_dir = steamapps_root / "common" / installdir
            if common_dir.exists():
                return str(common_dir)

        return None

    def _is_steam_game(self, appid: int) -> bool:
        return self._resolve_steam_appmanifest_path(appid) is not None

    def _is_nonsteam_game(self, name: str | None = None) -> bool:
        return self._resolve_nonsteam_install_dir(name) is not None

    def _resolve_steam_install_dir(self, appid: int) -> str | None:
        return self._resolve_steam_appmanifest_path(appid)

    def _normalize_shortcut_name(self, value: str | None) -> str:
        if not value:
            return ""

        candidate = (value or "").strip().strip('"')
        if not candidate:
            return ""

        candidate = os.path.basename(candidate)
        suffix = Path(candidate).suffix.lower()
        if suffix in {".appimage", ".exe", ".sh", ".desktop", ".bat", ".cmd", ".bin"}:
            candidate = Path(candidate).stem

        candidate = candidate.strip().lower()
        return re.sub(r"[^a-z0-9]+", "", candidate)

    def _shortcut_name_match_score(self, incoming_name: str | None, entry_name: str | None) -> int:
        incoming = self._normalize_shortcut_name(incoming_name)
        entry = self._normalize_shortcut_name(entry_name)

        if not incoming or not entry:
            return 0

        if incoming == entry:
            return 100

        if incoming.startswith(entry) or entry.startswith(incoming):
            return 60

        if incoming in entry or entry in incoming:
            return 40

        return 0

    def _shortcut_name_matches(self, incoming_name: str | None, entry_name: str | None) -> bool:
        return self._shortcut_name_match_score(incoming_name, entry_name) > 0

    def _resolve_nonsteam_install_dir(self, name: str | None = None) -> str | None:
        if not name:
            return None

        best_entry: dict | None = None
        best_score = 0

        for shortcuts_path in self._get_shortcuts_vdf_candidates():
            for entry in self._extract_shortcuts_entries(shortcuts_path):
                entry_name = entry.get("name")
                score = self._shortcut_name_match_score(name, entry_name)
                if score <= best_score:
                    continue

                best_entry = entry
                best_score = score

        if best_entry is None:
            return None

        start_dir = (best_entry.get("start_dir") or "").strip().strip('"')
        if start_dir:
            return os.path.abspath(start_dir)

        exe_path = (best_entry.get("exe") or "").strip().strip('"')
        if exe_path:
            exe_dir = os.path.dirname(exe_path)
            if exe_dir:
                return os.path.abspath(exe_dir)

        return None

    def _extract_shortcuts_entries(self, shortcuts_path: Path) -> list[dict]:
        try:
            result = subprocess.run(
                ["strings", "-n", "4", str(shortcuts_path)],
                capture_output=True,
                text=True,
                check=False,
            )
        except (FileNotFoundError, OSError):
            return []

        lines = [line.strip().strip('"') for line in result.stdout.splitlines() if line.strip()]
        entries: list[dict] = []
        i = 0

        while i < len(lines) - 1:
            if lines[i] != "appid":
                i += 1
                continue

            i += 1
            if i >= len(lines):
                break

            if lines[i] == "AppName":
                i += 1
                if i >= len(lines):
                    break
                app_name = lines[i]
                i += 1

                exe_path = lines[i] if i < len(lines) else ""
                i += 1

                start_dir = ""
                while i < len(lines):
                    if lines[i] == "StartDir":
                        if i + 1 < len(lines):
                            start_dir = lines[i + 1]
                        break
                    i += 1

                entries.append({
                    "name": app_name,
                    "exe": exe_path,
                    "start_dir": start_dir,
                })

            else:
                i += 1

        return entries

    async def get_game_install_dir(self, appid: int, name: str | None = None) -> dict:
        normalized_name = (name or "").strip()
        is_steam_app = False

        if appid and appid != 0:
            manifest_path = self._resolve_steam_appmanifest_path(appid)
            if manifest_path:
                is_steam_app = True
                return {"success": True, "path": manifest_path}

            steam_path = self._resolve_steam_install_dir(appid)
            if steam_path:
                is_steam_app = True
                return {"success": True, "path": steam_path}

        if normalized_name:
            nonsteam_path = self._resolve_nonsteam_install_dir(normalized_name)
            if nonsteam_path:
                return {"success": True, "path": nonsteam_path}

        if normalized_name and not is_steam_app:
            return {"success": False, "error": "Atalho não-Steam não encontrado no shortcuts.vdf"}

        return {"success": False, "error": "Diretório do jogo não encontrado"}

    async def get_nonsteam_game_install_dir(self, name: str | None = None) -> dict:
        normalized_name = (name or "").strip()
        if not normalized_name:
            return {"success": False, "error": "Nome do atalho não informado"}

        nonsteam_path = self._resolve_nonsteam_install_dir(normalized_name)
        if nonsteam_path:
            return {"success": True, "path": nonsteam_path}

        return {"success": False, "error": "Diretório do atalho não-Steam não encontrado"}
