
import asyncio
import os
import shutil
import sys
import tempfile
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


_STUB = types.ModuleType("decky")


class _Logger:
    def __getattr__(self, _name):
        return lambda *args, **kwargs: None


_STUB.logger = _Logger()
sys.modules.setdefault("decky", _STUB)


def install_decky_stub(base: str) -> None:
    home = os.path.join(base, "home")
    os.makedirs(home, exist_ok=True)
    _STUB.DECKY_PLUGIN_SETTINGS_DIR = os.path.join(base, "settings")
    _STUB.DECKY_PLUGIN_RUNTIME_DIR = os.path.join(base, "runtime")
    _STUB.DECKY_USER_HOME = home
    _STUB.DECKY_HOME = os.path.join(base, "decky")
    sys.modules["decky"] = _STUB


class PluginTestCase(unittest.TestCase):

    def setUp(self) -> None:
        self.base = tempfile.mkdtemp(prefix="dm-test-")
        install_decky_stub(self.base)
        from backend import Plugin

        self.home = os.path.join(self.base, "home")
        self.work = os.path.join(self.base, "work")
        os.makedirs(self.work)
        self.plugin = Plugin()
        self.addCleanup(self._cleanup)

    def _cleanup(self) -> None:
        for root, dirs, files in os.walk(self.base):
            for name in dirs + files:
                try:
                    os.chmod(os.path.join(root, name), 0o777)
                except OSError:
                    pass
        shutil.rmtree(self.base, ignore_errors=True)

    def run_async(self, coroutine):
        return asyncio.run(coroutine)

    def path(self, *parts: str) -> str:
        return os.path.join(self.work, *parts)

    def write(self, relative: str, content: str | bytes = "x") -> str:
        full = self.path(relative)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "wb" if isinstance(content, bytes) else "w") as handle:
            handle.write(content)
        return full

    def read(self, relative: str) -> str:
        with open(self.path(relative)) as handle:
            return handle.read()

    def read_abs(self, full: str, binary: bool = False):
        with open(full, "rb" if binary else "r") as handle:
            return handle.read()

    def make_dir(self, relative: str) -> str:
        full = self.path(relative)
        os.makedirs(full, exist_ok=True)
        return full
