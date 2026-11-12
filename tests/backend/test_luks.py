import unittest
from unittest import mock

from tests.backend.support import PluginTestCase
from tests.backend.test_drive_actions import FakeProcess, Runner


class LuksTests(PluginTestCase):
    def setUp(self):
        super().setUp()
        which = mock.patch("backend.drive_actions.shutil.which", side_effect=lambda name: f"/usr/bin/{name}")
        which.start()
        self.addCleanup(which.stop)
        which = mock.patch("backend.luks.shutil.which", side_effect=lambda name: f"/usr/bin/{name}")
        which.start()
        self.addCleanup(which.stop)
        self.state = {"cleartext": None}
        patcher = mock.patch("backend.luks.udisks_view.container_state", side_effect=lambda device: {"cleartext": self.state["cleartext"]})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.mounted = []
        self.plugin._fs_info = lambda device: ("crypto_LUKS", "Cofre") if device == "/dev/sdx1" else ("ext4", "Dados")
        self.plugin._mount_point_for_device = lambda device: self.work if device in self.mounted else None

    def test_locked_container_asks_for_the_passphrase(self):
        self.plugin._run = Runner()
        self.assertEqual(self.plugin._mount_blocking("/dev/sdx1", None), {"ok": False, "needs_passphrase": True})
        self.assertEqual(self.plugin._run.commands(), [])

    def test_unlock_sends_the_passphrase_on_stdin_and_mounts_the_cleartext_device(self):
        def mount(_command):
            self.mounted.append("/dev/dm-7")
            return FakeProcess(0, stdout="Mounted")
        runner = Runner({
            ("udisksctl", "unlock"): FakeProcess(0, stdout="Unlocked /dev/sdx1 as /dev/dm-7.\n"),
            ("udisksctl", "mount"): mount,
        })
        self.plugin._run = runner
        result = self.plugin._mount_blocking("/dev/sdx1", None, "segredo")
        self.assertEqual(result, {"ok": True, "path": self.work})
        unlock = [call for call in runner.calls if call[0][:2] == ["udisksctl", "unlock"]][0]
        self.assertEqual(unlock[1], "segredo")
        self.assertIn("/dev/stdin", unlock[0])
        self.assertNotIn("segredo", " ".join(unlock[0]))
        self.assertIn(["udisksctl", "mount", "-b", "/dev/dm-7", "--no-user-interaction"], runner.commands())

    def test_wrong_passphrase_is_reported_for_a_retry(self):
        self.plugin._run = Runner({("udisksctl", "unlock"): FakeProcess(1, "Error unlocking /dev/sdx1: Failed to activate device: Operation not permitted")})
        self.assertEqual(self.plugin._mount_blocking("/dev/sdx1", None, "errada"), {"ok": False, "needs_passphrase": True, "wrong_passphrase": True})

    def test_other_unlock_errors_are_returned(self):
        self.plugin._run = Runner({("udisksctl", "unlock"): FakeProcess(1, "Error: device busy")})
        result = self.plugin._mount_blocking("/dev/sdx1", None, "x")
        self.assertEqual((result["ok"], result["error"]), (False, "Error: device busy"))

    def test_already_unlocked_container_skips_the_unlock(self):
        self.state["cleartext"] = "/dev/dm-3"
        def mount(_command):
            self.mounted.append("/dev/dm-3")
            return FakeProcess(0)
        runner = Runner({("udisksctl", "mount"): mount})
        self.plugin._run = runner
        self.assertTrue(self.plugin._mount_blocking("/dev/sdx1", None)["ok"])
        self.assertFalse(any(c[:2] == ["udisksctl", "unlock"] for c in runner.commands()))

    def test_unlock_without_udisksctl_explains_why(self):
        with mock.patch("backend.luks.shutil.which", return_value=None):
            result = self.plugin._mount_encrypted("/dev/sdx1", None, "x")
        self.assertIn("udisksctl", result["error"])

    def test_unlock_falls_back_to_reading_the_cleartext_device_from_udisks(self):
        def unlock(_command):
            self.state["cleartext"] = "/dev/dm-9"
            return FakeProcess(0, stdout="Unlocked")
        def mount(_command):
            self.mounted.append("/dev/dm-9")
            return FakeProcess(0)
        self.plugin._run = Runner({("udisksctl", "unlock"): unlock, ("udisksctl", "mount"): mount})
        self.assertTrue(self.plugin._mount_blocking("/dev/sdx1", None, "x")["ok"])

    def test_unmount_locks_the_backing_container(self):
        self.mounted.append("/dev/dm-7")
        runner = Runner()
        self.plugin._run = runner

        def unmount(_command):
            self.mounted.clear()
            return FakeProcess(0)
        runner.responses[("udisksctl", "unmount")] = unmount
        with mock.patch("backend.drive_actions.udisks_view.backing_device", return_value="/dev/sdx1"):
            self.assertTrue(self.plugin._unmount_blocking("/dev/dm-7", None)["ok"])
        self.assertIn(["udisksctl", "lock", "-b", "/dev/sdx1", "--no-user-interaction"], runner.commands())

    def test_unmount_without_backing_does_not_lock(self):
        self.mounted.append("/dev/sdq1")
        runner = Runner({("udisksctl", "unmount"): lambda _c: (self.mounted.clear(), FakeProcess(0))[1]})
        self.plugin._run = runner
        with mock.patch("backend.drive_actions.udisks_view.backing_device", return_value=None):
            self.assertTrue(self.plugin._unmount_blocking("/dev/sdq1", None)["ok"])
        self.assertFalse(any(c[:2] == ["udisksctl", "lock"] for c in runner.commands()))

    def test_lock_without_udisksctl_is_a_noop(self):
        runner = Runner()
        self.plugin._run = runner
        with mock.patch("backend.luks.shutil.which", return_value=None):
            self.plugin._lock("/dev/sdx1")
        self.assertEqual(runner.commands(), [])

    def test_public_mount_api_forwards_the_passphrase(self):
        self.plugin._check_block_device = lambda device: device
        self.plugin._run = Runner()
        result = self.run_async(self.plugin.mount_drive("/dev/sdx1"))
        self.assertTrue(result["needs_passphrase"])


if __name__ == "__main__":
    unittest.main()
