import asyncio
import os
import re
from pathlib import Path

from .clipboard import Clipboard
from .paths import user_home
from .shortcuts_vdf import read_shortcuts

MIN_NAME_SCORE = 60
SHORTCUT_EXTENSIONS = {".appimage", ".exe", ".sh", ".desktop", ".bat", ".cmd", ".bin"}


class GameManager(Clipboard):

    def _get_steam_root_candidates(self) -> list[Path]:
        home = Path(user_home())
        roots = [
            home / ".local" / "share" / "Steam",
            home / ".steam" / "steam",
            home / ".var" / "app" / "com.valvesoftware.Steam" / ".local" / "share" / "Steam",
        ]
        candidates: list[Path] = []
        seen: set[str] = set()
        for root in roots:
            real = os.path.realpath(root)
            if root.exists() and real not in seen:
                candidates.append(root)
                seen.add(real)
        return candidates

    def _get_shortcuts_vdf_candidates(self) -> list[Path]:
        candidates: list[Path] = []
        for root in self._get_steam_root_candidates():
            userdata = root / "userdata"
            if not userdata.is_dir():
                continue
            for user_dir in userdata.iterdir():
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
        for match in re.findall(r'"path"\s+"([^"]+)"', content):
            candidate = Path(match.replace("\\\\", "\\"))
            if candidate.exists() and candidate not in paths:
                paths.append(candidate)
        return paths

    def _steam_library_roots(self) -> list[Path]:
        libraries: list[Path] = []
        seen: set[str] = set()

        def add(path: Path) -> None:
            real = os.path.realpath(path)
            if real not in seen and path.exists():
                seen.add(real)
                libraries.append(path)

        for steam_root in self._get_steam_root_candidates():
            add(steam_root)
            for vdf in (steam_root / "steamapps" / "libraryfolders.vdf", steam_root / "config" / "libraryfolders.vdf", steam_root / "libraryfolders.vdf"):
                if vdf.is_file():
                    for library in self._read_vdf_paths(vdf):
                        add(library)
        return libraries

    def _resolve_steam_appmanifest_path(self, appid: int) -> str | None:
        manifest_name = f"appmanifest_{int(appid)}.acf"
        for library in self._steam_library_roots():
            manifest_path = library / "steamapps" / manifest_name
            if not manifest_path.is_file():
                continue
            try:
                text = manifest_path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            match = re.search(r'"installdir"\s+"([^"]+)"', text)
            installdir = match.group(1).strip() if match else ""
            if not installdir:
                continue
            common_dir = library / "steamapps" / "common" / installdir
            if common_dir.is_dir():
                return str(common_dir)
        return None

    def _normalize_shortcut_name(self, value: str | None) -> str:
        candidate = os.path.basename((value or "").strip().strip('"'))
        if Path(candidate).suffix.lower() in SHORTCUT_EXTENSIONS:
            candidate = Path(candidate).stem
        return re.sub(r"[^a-z0-9]+", "", candidate.strip().lower())

    def _shortcut_name_match_score(self, incoming_name: str | None, entry_name: str | None) -> int:
        incoming = self._normalize_shortcut_name(incoming_name)
        entry = self._normalize_shortcut_name(entry_name)
        if not incoming or not entry:
            return 0
        if incoming == entry:
            return 100
        if incoming.startswith(entry) or entry.startswith(incoming):
            return 60
        return 0

    def _resolve_nonsteam_install_dir(self, name: str | None = None, appid: int | None = None) -> str | None:
        best: dict | None = None
        best_score = 0

        for shortcuts_path in self._get_shortcuts_vdf_candidates():
            for entry in read_shortcuts(str(shortcuts_path)):
                score = 1000 if appid and entry.get("appid") == (appid & 0xFFFFFFFF) else self._shortcut_name_match_score(name, entry.get("name"))
                if score >= MIN_NAME_SCORE and score > best_score:
                    best, best_score = entry, score

        if best is None:
            return None

        start_dir = best["start_dir"].strip().strip('"')
        if start_dir and os.path.isdir(start_dir):
            return os.path.abspath(start_dir)
        exe_dir = os.path.dirname(best["exe"].strip().strip('"'))
        if exe_dir and os.path.isdir(exe_dir):
            return os.path.abspath(exe_dir)
        return None

    async def get_game_install_dir(self, appid: int, name: str | None = None) -> dict:
        normalized_name = (name or "").strip()

        if appid:
            path = await asyncio.to_thread(self._resolve_steam_appmanifest_path, appid)
            if path:
                return {"success": True, "path": path}

        if normalized_name or appid:
            path = await asyncio.to_thread(self._resolve_nonsteam_install_dir, normalized_name, appid or None)
            if path:
                return {"success": True, "path": path}

        return {"success": False, "error": "Diretório do jogo não encontrado"}

    def _resolve_screenshots_dir(self, appid: int = 0) -> str | None:
        newest: tuple[float, str] | None = None
        for root in self._get_steam_root_candidates():
            userdata = root / "userdata"
            if not userdata.is_dir():
                continue
            for user_dir in userdata.iterdir():
                remote = user_dir / "760" / "remote"
                candidate = remote / str(int(appid)) / "screenshots" if appid else remote
                if candidate.is_dir():
                    mtime = candidate.stat().st_mtime
                    if newest is None or mtime > newest[0]:
                        newest = (mtime, str(candidate))
        return newest[1] if newest else None

    async def get_screenshots_dir(self, appid: int = 0) -> dict:
        path = await asyncio.to_thread(self._resolve_screenshots_dir, appid)
        if path:
            return {"success": True, "path": path}
        return {"success": False, "error": "Pasta de capturas de tela não encontrada"}

