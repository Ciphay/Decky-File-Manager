import unittest
from unittest import mock

from tests.backend.support import PluginTestCase


class SessionTests(PluginTestCase):
    def comm(self, names):
        def fake_open(path, *args, **kwargs):
            pid = path.split("/")[2]
            if pid not in names:
                raise FileNotFoundError(path)
            return mock.mock_open(read_data=names[pid] + "\n")()
        return fake_open

    def test_detects_a_running_gamescope(self):
        listing = ["1", "42", "self", "cpuinfo", "77"]
        with mock.patch("os.listdir", return_value=listing), mock.patch("builtins.open", self.comm({"1": "systemd", "42": "gamescope-wl"})):
            self.assertTrue(self.plugin._is_gamescope_running())
        with mock.patch("os.listdir", return_value=listing), mock.patch("builtins.open", self.comm({"1": "systemd", "42": "gamescope"})):
            self.assertTrue(self.plugin._is_gamescope_running())

    def test_no_gamescope_and_unreadable_proc(self):
        with mock.patch("os.listdir", return_value=["1", "2"]), mock.patch("builtins.open", self.comm({"1": "systemd", "2": "plasmashell"})):
            self.assertFalse(self.plugin._is_gamescope_running())
        with mock.patch("os.listdir", side_effect=OSError):
            self.assertFalse(self.plugin._is_gamescope_running())

    def test_public_api(self):
        with mock.patch.object(self.plugin, "_is_gamescope_running", return_value=True):
            self.assertEqual(self.run_async(self.plugin.is_gamescope_session()), {"gamescope": True})


if __name__ == "__main__":
    unittest.main()
