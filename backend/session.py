import asyncio
import os

GAMESCOPE_PROCESS_NAMES = {"gamescope", "gamescope-wl"}


class Session:

    def _is_gamescope_running(self) -> bool:
        try:
            entries = os.listdir("/proc")
        except OSError:
            return False
        for entry in entries:
            if not entry.isdigit():
                continue
            try:
                with open(f"/proc/{entry}/comm", "r", encoding="utf-8", errors="replace") as handle:
                    if handle.read().strip() in GAMESCOPE_PROCESS_NAMES:
                        return True
            except OSError:
                continue
        return False

    async def is_gamescope_session(self) -> dict:
        return {"gamescope": await asyncio.to_thread(self._is_gamescope_running)}
