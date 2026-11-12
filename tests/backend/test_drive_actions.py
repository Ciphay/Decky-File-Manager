import os
import shutil
import subprocess
import unittest
from unittest import mock

from tests.backend.support import PluginTestCase


class FakeProcess:
    def __init__(self, returncode=0, stderr="", stdout=""):
        self.returncode, self.stderr, self.stdout = returncode, stderr, stdout


class Runner:

    def __init__(self, responses=None, default=None):
        self.responses = responses or {}
        self.default = default or FakeProcess()
        self.calls = []

    def __call__(self, command, input_text=None, timeout=60):
        self.calls.append((list(command), input_text))
        for prefix, response in self.responses.items():
            if command[: len(prefix)] == list(prefix):
                return response(command) if callable(response) else response
        return self.default

    def commands(self):
        return [call[0] for call in self.calls]


class PrivilegedTests(PluginTestCase):
    def setUp(self):
        super().setUp()
        patcher = mock.patch("backend.drive_actions.os.geteuid", return_value=1000)
        patcher.start()
        self.addCleanup(patcher.stop)
        which = mock.patch("backend.drive_actions.shutil.which", side_effect=lambda name: f"/usr/bin/{name}")
        which.start()
        self.addCleanup(which.stop)

    def test_passwordless_sudo_success_and_failure(self):
        self.plugin._run = Runner(default=FakeProcess(0))
        self.assertEqual(self.plugin._privileged(["mount", "x"], None), ("ok", ""))
        self.assertEqual(self.plugin._run.commands()[0][:2], ["sudo", "-n"])
        self.plugin._run = Runner(default=FakeProcess(1, "mount: wrong fs type"))
        self.assertEqual(self.plugin._privileged(["mount", "x"], None), ("error", "mount: wrong fs type"))

    def test_password_required_and_wrong_password(self):
        self.plugin._run = Runner(default=FakeProcess(1, "sudo: a password is required"))
        self.assertEqual(self.plugin._privileged(["x"], None)[0], "needs_password")
        self.plugin._run = Runner(default=FakeProcess(1, "sudo: 1 incorrect password attempt"))
        self.assertEqual(self.plugin._privileged(["x"], "bad")[0], "wrong_password")
        self.plugin._run = Runner(default=FakeProcess(1, "Sorry, try again."))
        self.assertEqual(self.plugin._privileged(["x"], "bad")[0], "wrong_password")

    def test_password_is_sent_on_stdin_only(self):
        runner = Runner(default=FakeProcess(0))
        self.plugin._run = runner
        self.assertEqual(self.plugin._privileged(["umount", "/x"], "s3cret")[0], "ok")
        command, stdin = runner.calls[0]
        self.assertEqual(command, ["sudo", "-S", "-p", "", "-k", "umount", "/x"])
        self.assertEqual(stdin, "s3cret\n")
        self.assertNotIn("s3cret", " ".join(command))

    def test_missing_sudo_and_root(self):
        with mock.patch("backend.drive_actions.shutil.which", return_value=None):
            self.assertEqual(self.plugin._privileged(["x"], None)[0], "error")
        with mock.patch("backend.drive_actions.os.geteuid", return_value=0):
            self.plugin._run = Runner(default=FakeProcess(0, stdout="fine"))
            self.assertEqual(self.plugin._privileged(["x"], None), ("ok", "fine"))
            self.assertEqual(self.plugin._run.commands()[0], ["x"])

    def test_outcome_mapping(self):
        self.assertEqual(self.plugin._outcome("needs_password", "", "f"), {"ok": False, "needs_password": True})
        self.assertEqual(self.plugin._outcome("wrong_password", "", "f"), {"ok": False, "needs_password": True, "wrong_password": True})
        self.assertEqual(self.plugin._outcome("error", "boom", "f")["error"], "boom")
        self.assertEqual(self.plugin._outcome("error", "", "fallback")["error"], "fallback")


class MountTests(PluginTestCase):
    def setUp(self):
        super().setUp()
        for target in ("backend.drive_actions.shutil.which",):
            patcher = mock.patch(target, side_effect=lambda name: f"/usr/bin/{name}")
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = mock.patch("backend.drive_actions.os.geteuid", return_value=1000)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.state = {"mount": None}
        self.plugin._mount_point_for_device = lambda device: self.state["mount"]

    def test_already_mounted(self):
        self.state["mount"] = self.work
        self.assertEqual(self.plugin._mount_blocking("/dev/sdx1", None), {"ok": True, "path": self.work})

    def test_udisks_mount_success(self):
        def udisks(_command):
            self.state["mount"] = self.work
            return FakeProcess(0, stdout="Mounted")
        self.plugin._run = Runner({("udisksctl", "mount"): udisks})
        self.assertEqual(self.plugin._mount_blocking("/dev/sdx1", None), {"ok": True, "path": self.work})
        mount = [c for c in self.plugin._run.commands() if c[:2] == ["udisksctl", "mount"]]
        self.assertIn("--no-user-interaction", mount[0])

    def test_udisks_hard_error_is_returned(self):
        self.plugin._run = Runner({("udisksctl", "mount"): FakeProcess(1, "Error: unknown filesystem type")})
        result = self.plugin._mount_blocking("/dev/sdx1", None)
        self.assertFalse(result["ok"])
        self.assertIn("unknown filesystem", result["error"])

    def test_udisks_not_aware_of_volume_falls_back_when_it_has_a_filesystem(self):
        runner = Runner({
            ("udisksctl", "mount"): FakeProcess(1, "Object is not a mountable filesystem."),
            ("lsblk",): FakeProcess(0, stdout='FSTYPE="ext4" LABEL="Novo"'),
        })
        self.plugin._run = runner
        result = self.plugin._mount_blocking("/dev/sdx1", "pw")
        self.assertTrue(result["ok"])
        self.assertTrue(any(c[:5] == ["sudo", "-S", "-p", "", "-k"] and "mount" in c[5:6] for c in runner.commands()))

    def test_unauthorized_falls_back_to_privileged_mount_and_asks_for_password(self):
        runner = Runner({
            ("udisksctl", "mount"): FakeProcess(1, "GDBus.Error:org.freedesktop.UDisks2.Error.NotAuthorizedCanObtain"),
            ("lsblk",): FakeProcess(0, stdout='FSTYPE="ntfs" LABEL="Jogos"'),
            ("sudo", "-n"): FakeProcess(1, "sudo: a password is required"),
        })
        self.plugin._run = runner
        self.assertEqual(self.plugin._mount_blocking("/dev/sdx1", None), {"ok": False, "needs_password": True})

    def test_privileged_mount_with_password_uses_user_ownership_options(self):
        runner = Runner({
            ("udisksctl", "mount"): FakeProcess(1, "NotAuthorized"),
            ("lsblk",): FakeProcess(0, stdout='FSTYPE="ntfs" LABEL="Meus Jogos"'),
        })
        self.plugin._run = runner
        result = self.plugin._mount_blocking("/dev/sdx1", "pw")
        self.assertTrue(result["ok"])
        self.assertTrue(result["path"].endswith("/Meus_Jogos"))
        mount_cmd = [c for c in runner.commands() if "mount" in c and c[0] == "sudo"][-1]
        self.assertIn("-o", mount_cmd)
        self.assertRegex(" ".join(mount_cmd), r"uid=\d+,gid=\d+,umask=022")

    def test_ext4_mount_has_no_ownership_options(self):
        runner = Runner({("udisksctl", "mount"): FakeProcess(1, "NotAuthorized"), ("lsblk",): FakeProcess(0, stdout='FSTYPE="ext4" LABEL=""')})
        self.plugin._run = runner
        self.plugin._mount_blocking("/dev/sdx1", "pw")
        mount_cmd = [c for c in runner.commands() if c[:5] == ["sudo", "-S", "-p", "", "-k"] and c[5] == "mount"][0]
        self.assertNotIn("-o", mount_cmd)

    def test_failed_privileged_mount_cleans_up_mountpoint(self):
        def sudo(command):
            return FakeProcess(1, "mount: bad superblock") if "mount" in command[5:6] else FakeProcess(0)
        runner = Runner({("udisksctl", "mount"): FakeProcess(1, "NotAuthorized"), ("lsblk",): FakeProcess(0, stdout='FSTYPE="ext4" LABEL="X"'), ("sudo",): sudo})
        self.plugin._run = runner
        result = self.plugin._mount_blocking("/dev/sdx1", "pw")
        self.assertFalse(result["ok"])
        self.assertTrue(any("rmdir" in c for c in runner.commands()))

    def test_public_mount_rejects_invalid_devices(self):
        for device in ("", "/etc/passwd", "/nonexistent"):
            self.assertEqual(self.run_async(self.plugin.mount_drive(device))["error"], "Dispositivo inválido")
        self.assertFalse(self.run_async(self.plugin.unmount_drive("/etc/passwd"))["ok"])
        self.assertFalse(self.run_async(self.plugin.rename_drive("/etc/passwd", "x"))["ok"])


class UnmountTests(PluginTestCase):
    def setUp(self):
        super().setUp()
        for target, kwargs in (("backend.drive_actions.shutil.which", {"side_effect": lambda name: f"/usr/bin/{name}"}), ("backend.drive_actions.os.geteuid", {"return_value": 1000})):
            patcher = mock.patch(target, **kwargs)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.state = {"mount": "/run/media/rafael/X"}
        self.plugin._mount_point_for_device = lambda device: self.state["mount"]

    def test_not_mounted_is_success(self):
        self.state["mount"] = None
        self.assertEqual(self.plugin._unmount_blocking("/dev/sdx1", None), {"ok": True})

    def test_udisks_unmount(self):
        def udisks(_command):
            self.state["mount"] = None
            return FakeProcess(0)
        self.plugin._run = Runner({("udisksctl", "unmount"): udisks})
        self.assertEqual(self.plugin._unmount_blocking("/dev/sdx1", None), {"ok": True})

    def test_busy_volume_is_lazily_unmounted(self):
        def sudo(command):
            args = command[2:]
            if args[:2] == ["umount", "-l"]:
                self.state["mount"] = None
                return FakeProcess(0)
            if args[:1] == ["umount"]:
                return FakeProcess(1, "umount: /run/media/rafael/X: target is busy.")
            return FakeProcess(0)
        runner = Runner({("udisksctl", "unmount"): FakeProcess(1, "Error: target is busy"), ("sudo",): sudo})
        self.plugin._run = runner
        self.assertEqual(self.plugin._unmount_blocking("/dev/sdx1", None), {"ok": True, "lazy": True})
        commands = runner.commands()
        self.assertIn(["sync"], commands)
        self.assertLess(commands.index(["sync"]), next(i for i, c in enumerate(commands) if "-l" in c))
        self.assertTrue(any("rmdir" in c for c in commands))

    def test_unauthorized_asks_for_password(self):
        runner = Runner({("udisksctl", "unmount"): FakeProcess(1, "NotAuthorized"), ("sudo", "-n"): FakeProcess(1, "sudo: a password is required")})
        self.plugin._run = runner
        self.assertEqual(self.plugin._unmount_blocking("/dev/sdx1", None), {"ok": False, "needs_password": True})

    def test_other_udisks_errors_surface(self):
        self.plugin._run = Runner({("udisksctl", "unmount"): FakeProcess(1, "Error: device is gone")})
        self.assertIn("gone", self.plugin._unmount_blocking("/dev/sdx1", None)["error"])


class RenameTests(PluginTestCase):
    def setUp(self):
        super().setUp()
        patcher = mock.patch("backend.drive_actions.shutil.which", side_effect=lambda name: f"/usr/bin/{name}")
        patcher.start()
        self.addCleanup(patcher.stop)
        patcher = mock.patch("backend.drive_actions.os.geteuid", return_value=1000)
        patcher.start()
        self.addCleanup(patcher.stop)

    def run_rename(self, fstype, label, password="pw"):
        runner = Runner({("lsblk",): FakeProcess(0, stdout=f'FSTYPE="{fstype}" LABEL="Velho"')})
        self.plugin._run = runner
        return self.plugin._rename_blocking("/dev/sdx1", label, password), runner

    def test_label_commands_per_filesystem(self):
        expectations = {
            "ext4": ["e2label", "/dev/sdx1", "Novo"], "vfat": ["fatlabel", "/dev/sdx1", "NOVO"], "exfat": ["exfatlabel", "/dev/sdx1", "Novo"],
            "ntfs": ["ntfslabel", "/dev/sdx1", "Novo"], "btrfs": ["btrfs", "filesystem", "label", "/dev/sdx1", "Novo"], "xfs": ["xfs_admin", "-L", "Novo", "/dev/sdx1"],
        }
        for fstype, command in expectations.items():
            result, runner = self.run_rename(fstype, "Novo")
            self.assertEqual(result, {"ok": True, "label": "Novo"}, fstype)
            self.assertEqual(runner.commands()[-1][5:], command, fstype)

    def test_validation(self):
        self.assertIn("não é suportado", self.run_rename("f2fs", "x")[0]["error"])
        self.assertIn("inválido", self.run_rename("ext4", "")[0]["error"])
        self.assertIn("inválido", self.run_rename("ext4", "a/b")[0]["error"])
        self.assertIn("16", self.run_rename("ext4", "x" * 17)[0]["error"])
        self.assertIn("11", self.run_rename("vfat", "x" * 12)[0]["error"])

    def test_password_flow_and_missing_tool(self):
        result, _ = self.run_rename("ext4", "Novo", None)
        self.assertTrue(result["ok"])
        runner = Runner({("lsblk",): FakeProcess(0, stdout='FSTYPE="ext4" LABEL="x"'), ("sudo", "-n"): FakeProcess(1, "sudo: a password is required")})
        self.plugin._run = runner
        self.assertEqual(self.plugin._rename_blocking("/dev/sdx1", "Novo", None), {"ok": False, "needs_password": True})
        with mock.patch("backend.drive_actions.shutil.which", side_effect=lambda name: None if name == "e2label" else f"/usr/bin/{name}"):
            self.assertIn("não instalada", self.plugin._rename_blocking("/dev/sdx1", "Novo", "pw")["error"])

    def test_fs_info_parses_lsblk_pairs(self):
        self.plugin._run = Runner({("lsblk",): FakeProcess(0, stdout='FSTYPE="ntfs" LABEL="A \\"quoted\\" name"')})
        self.assertEqual(self.plugin._fs_info("/dev/sdx1")[0], "ntfs")
        self.plugin._run = Runner({("lsblk",): FakeProcess(0, stdout="")})
        self.assertEqual(self.plugin._fs_info("/dev/sdx1"), (None, None))


@unittest.skipUnless(
    shutil.which("sudo") and shutil.which("losetup") and shutil.which("mkfs.ext4")
    and subprocess.run(["sudo", "-n", "true"], capture_output=True).returncode == 0,
    "precisa de sudo sem senha, losetup e mkfs.ext4",
)
class LoopDeviceIntegrationTests(PluginTestCase):

    def setUp(self):
        super().setUp()
        self.image = self.path("disk.img")
        subprocess.run(["truncate", "-s", "32M", self.image], check=True)
        subprocess.run(["mkfs.ext4", "-q", "-L", "DMTESTLOOP", self.image], check=True)
        self.loop = subprocess.run(["sudo", "-n", "losetup", "-f", "--show", self.image], check=True, capture_output=True, text=True).stdout.strip()
        self.addCleanup(self.teardown_loop)

    def teardown_loop(self):
        mount = self.plugin._mount_point_for_device(self.loop)
        if mount:
            subprocess.run(["sudo", "-n", "umount", "-l", mount], capture_output=True)
        subprocess.run(["sudo", "-n", "losetup", "-d", self.loop], capture_output=True)

    def test_mount_busy_unmount_and_rename(self):
        mounted = self.run_async(self.plugin.mount_drive(self.loop))
        self.assertTrue(mounted["ok"], mounted)
        mount_point = mounted["path"]
        self.assertTrue(os.path.ismount(mount_point))
        drives = {d["device"]: d for d in self.plugin._collect_drives()}
        self.assertTrue(drives[self.loop]["mounted"] if self.loop in drives else True)

        renamed = self.run_async(self.plugin.rename_drive(self.loop, "RENOMEADO"))
        self.assertTrue(renamed["ok"], renamed)
        label = subprocess.run(["sudo", "-n", "e2label", self.loop], capture_output=True, text=True).stdout.strip()
        self.assertEqual(label, "RENOMEADO")

        holder = subprocess.Popen(["sleep", "30"], cwd=mount_point)
        self.addCleanup(lambda: (holder.kill(), holder.wait()))
        result = self.run_async(self.plugin.unmount_drive(self.loop))
        self.assertTrue(result["ok"], result)
        self.assertFalse(os.path.ismount(mount_point))
        self.assertIsNone(self.plugin._mount_point_for_device(self.loop))


if __name__ == "__main__":
    unittest.main()
