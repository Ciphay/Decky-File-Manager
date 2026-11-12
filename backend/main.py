import os
import subprocess
import threading
from contextvars import ContextVar

import decky

from .drive_actions import DriveActions
from .drives import Drives
from .lifecycle import Lifecycle


class Plugin(Lifecycle, Drives, DriveActions):

    def __init__(self):
        self._clipboard_path: str | None = None
        self._clipboard_kind: str | None = None
        self._last_path: str | None = None
        self._selected_file: str | None = None
        self._selection_result_file: str | None = None

        self._settings: dict = {}
        self._settings_file = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")
        self._runtime_file = os.path.join(decky.DECKY_PLUGIN_RUNTIME_DIR, "runtime.json")
        self.loop = None

        self._active_operation_process: subprocess.Popen | None = None
        self._operation_progress_lock = threading.Lock()
        self._operation_states: dict[str, dict] = {}
        self._current_operation_id: ContextVar[str | None] = ContextVar("current_operation_id", default=None)

        self._load_settings()
        self._load_runtime_state()


__all__ = ["Plugin"]
