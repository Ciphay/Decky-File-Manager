

import os
import decky
import asyncio
import subprocess
import threading
from contextvars import ContextVar
from .lifecycle import Lifecycle
from .file_management import FileManagement
from .drives import Drives
from .transfer import Transfer


class Plugin(Lifecycle):


    def __init__(self):
        self._clipboard_path: str | None = None
        self._clipboard_kind: str | None = None
        self._last_path: str | None = None
        self._selected_file: str | None = None
        self._selection_result_file: str | None = None
        
        self._settings: dict = {"default_path": os.path.expanduser("~")}
        self._settings_file = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")
        self._runtime_file = os.path.join(decky.DECKY_PLUGIN_RUNTIME_DIR, "runtime.json")
        self.loop = None
        
        self._operation_progress = 0.0
        self._operation_progress_active = False
        self._operation_progress_label = ""
        self._operation_cancel_requested = False
        self._active_operation_process: subprocess.Popen | None = None
        self._operation_progress_lock = threading.Lock()
        self._operation_states: dict[str, dict] = {}
        self._current_operation_id: ContextVar[str | None] = ContextVar("current_operation_id", default=None)
        
        self._load_settings()
        self._load_runtime_state()

    async def start_timer(self):
        if self.loop:
            self.loop.create_task(self.long_running())


Plugin.list_drives = Drives.list_drives
Plugin.mount_drive = Drives.mount_drive
Plugin.check_transfer_conflict = Transfer.check_transfer_conflict
Plugin.transfer_path = Transfer.transfer_path
Plugin._validate_transfer = Transfer._validate_transfer
Plugin._PSEUDO_FILESYSTEMS = Drives._PSEUDO_FILESYSTEMS
Plugin._REMOVABLE_MOUNT_ROOTS = Drives._REMOVABLE_MOUNT_ROOTS
Plugin._unescape_mount_field = staticmethod(Drives._unescape_mount_field)
Plugin._device_labels = staticmethod(Drives._device_labels)
Plugin._is_removable_device = staticmethod(Drives._is_removable_device)
Plugin._disk_usage = Drives._disk_usage
Plugin._make_drive = Drives._make_drive
Plugin._collect_drives = Drives._collect_drives


__all__ = ["Plugin"]
