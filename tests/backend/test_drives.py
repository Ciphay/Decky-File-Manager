import json
import os
import subprocess
import unittest
from unittest import mock

from backend import drive_probe as probe
from backend import udisks_view
from tests.backend.support import PluginTestCase


class ProbeHelperTests(unittest.TestCase):
    def test_unescape_mount_field(self):
        self.assertEqual(probe.unescape_mount_field("/run/media/a\\040b"), "/run/media/a b")
        self.assertEqual(probe.unescape_mount_field("plain"), "plain")
        self.assertEqual(probe.unescape_mount_field("tab\\011x"), "tab\tx")
        self.assertEqual(probe.unescape_mount_field("end\\04"), "end\\04")

    def test_in_removable_root_respects_path_boundaries(self):
        roots = ("/run/media", "/media", "/mnt")
        self.assertTrue(probe.in_removable_root("/run/media/rafael/X", roots))
        self.assertTrue(probe.in_removable_root("/mnt", roots))
        self.assertFalse(probe.in_removable_root("/mntfoo", roots))
        self.assertFalse(probe.in_removable_root("/media2/x", roots))

    def test_boot_partition_labels(self):
        for label in ("EFI", "esp", "BOOT", "e_fi", " Boot "):
            self.assertTrue(probe.is_boot_partition_label(label), label)
        self.assertFalse(probe.is_boot_partition_label("Games"))
        self.assertFalse(probe.is_boot_partition_label(None))

    def test_parent_block_device_by_name_without_sysfs(self):
        with mock.patch.object(probe, "SYS_BLOCK", "/nonexistent-sysfs"):
            for name, parent in {"nvme0n1p2": "nvme0n1", "sda1": "sda", "mmcblk0p1": "mmcblk0", "sdb": "sdb", "zzz": "zzz"}.items():
                self.assertEqual(probe.parent_block_device(name), parent, name)


class FakeSysfsTests(unittest.TestCase):

    def setUp(self):
        import tempfile
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(__import__("shutil").rmtree, self.tmp, True)
        disk = os.path.join(self.tmp, "devices/pci/sdq")
        os.makedirs(os.path.join(disk, "sdq1"))
        os.makedirs(os.path.join(disk, "sdq2"))
        os.makedirs(os.path.join(disk, "device"))
        for name, content in {"sdq/removable": "1\n", "sdq/size": "2000\n", "sdq/device/model": "Pendrive X\n", "sdq/sdq1/partition": "1\n", "sdq/sdq2/partition": "2\n", "sdq/sdq1/size": "0\n", "sdq/sdq2/size": "999\n"}.items():
            with open(os.path.join(self.tmp, "devices/pci", name), "w") as handle:
                handle.write(content)
        self.sys_block = os.path.join(self.tmp, "class/block")
        os.makedirs(self.sys_block)
        for name in ("sdq", "sdq1", "sdq2"):
            target = disk if name == "sdq" else os.path.join(disk, name)
            os.symlink(target, os.path.join(self.sys_block, name))
        patcher = mock.patch.object(probe, "SYS_BLOCK", self.sys_block)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_partition_detection_and_parent(self):
        self.assertEqual(probe.parent_block_device("sdq2"), "sdq")
        self.assertEqual(probe.parent_block_device("sdq"), "sdq")

    def test_removable_size_and_model(self):
        self.assertTrue(probe.is_removable_block("sdq1"))
        self.assertIsNone(probe.is_removable_block("ghost"))
        self.assertEqual(probe.device_name_fallback("sdq1"), "Pendrive X")
        self.assertEqual(probe.device_name_fallback("ghost"), "GHOST")


class LsblkFilterTests(unittest.TestCase):
    def node(self, **overrides):
        base = {"name": "sdb1", "path": "/dev/sdb1", "fstype": "ext4", "label": "Dados", "size": 1000, "type": "part",
                "mountpoints": [None], "parttype": "0fc63daf-8483-4772-8e79-3d69d8477de4", "rm": False, "hotplug": False}
        base.update(overrides)
        return base

    def test_visible_partition(self):
        self.assertTrue(probe.is_visible_unmounted(self.node()))

    def test_hidden_cases(self):
        hidden = [
            self.node(fstype=None), self.node(fstype="swap"), self.node(fstype="LVM2_member"), self.node(fstype="crypto_LUKS"),
            self.node(mountpoints=["/mnt/x"]), self.node(parttype=probe.ESP_PART_TYPE.upper()), self.node(type="loop"),
            self.node(parttype="0xef"), self.node(type="disk", has_partitions=True),
            self.node(type="rom"), self.node(name="zram0", type="disk"), self.node(name="loop3", type="disk"),
        ]
        for node in hidden:
            self.assertFalse(probe.is_visible_unmounted(node), node)

    def test_lsblk_devices_flattens_tree(self):
        tree = {"blockdevices": [{"name": "sda", "children": [{"name": "sda1"}, {"name": "sda2", "children": [{"name": "x"}]}]}]}
        result = subprocess.CompletedProcess([], 0, stdout=json.dumps(tree), stderr="")
        with mock.patch("shutil.which", return_value="/usr/bin/lsblk"), mock.patch("subprocess.run", return_value=result):
            self.assertEqual([n["name"] for n in probe.lsblk_devices()], ["sda", "sda1", "sda2", "x"])
        with mock.patch("shutil.which", return_value=None):
            self.assertEqual(probe.lsblk_devices(), [])
        with mock.patch("shutil.which", return_value="/x"), mock.patch("subprocess.run", side_effect=OSError):
            self.assertEqual(probe.lsblk_devices(), [])

    def test_read_mount_table_parses_proc_mounts(self):
        content = "/dev/sda1 /run/media/u/My\\040Disk ext4 rw 0 0\nproc /proc proc rw 0 0\nbad\n"
        with mock.patch("builtins.open", mock.mock_open(read_data=content)):
            table = probe.read_mount_table()
        self.assertEqual(table[0], ("/dev/sda1", "/run/media/u/My Disk", "ext4"))
        self.assertEqual(len(table), 2)


class CollectDrivesTests(PluginTestCase):
    def collect(self, mounts, nodes, labels=None, visible=None):
        with mock.patch.object(udisks_view, "read_volumes", return_value=visible), \
             mock.patch.object(probe, "read_mount_table", return_value=mounts), \
             mock.patch.object(probe, "lsblk_devices", return_value=nodes), \
             mock.patch.object(probe, "device_labels", return_value=labels or {}), \
             mock.patch.object(probe, "is_removable_block", return_value=False):
            return self.plugin._collect_drives()

    def test_home_and_root_always_present_first(self):
        drives = self.collect([], [])
        self.assertEqual([d["kind"] for d in drives], ["home", "root"])
        self.assertTrue(all(d["system"] for d in drives))
        self.assertEqual(drives[0]["name"], "home")

    def test_mounted_media_drive_and_unmounted_partition(self):
        media = self.make_dir("media/Dados")
        mounts = [("/dev/sdx1", media, "ext4"), ("tmpfs", "/tmp", "tmpfs"), ("/dev/sdy1", "/", "ext4")]
        nodes = [
            {"name": "sdz1", "path": "/dev/sdz1", "fstype": "ntfs", "label": "Jogos", "size": 5000, "type": "part", "mountpoints": [None], "rm": False, "hotplug": True},
            {"name": "sdw1", "path": "/dev/sdw1", "fstype": "vfat", "label": "EFI", "size": 5, "type": "part", "mountpoints": [None]},
        ]
        with mock.patch.object(self.plugin, "_REMOVABLE_MOUNT_ROOTS", (os.path.dirname(media),)):
            drives = self.collect(mounts, nodes, {"/dev/sdx1": "Dados"})
        by_name = {d["name"]: d for d in drives}
        self.assertTrue(by_name["Dados"]["mounted"])
        self.assertEqual(by_name["Dados"]["kind"], "internal")
        jogos = by_name["Jogos"]
        self.assertFalse(jogos["mounted"])
        self.assertEqual((jogos["device"], jogos["fstype"], jogos["total"], jogos["kind"]), ("/dev/sdz1", "ntfs", 5000, "usb"))
        self.assertIsNone(jogos["free"])
        self.assertNotIn("EFI", by_name)
        self.assertEqual(len([d for d in drives if d["kind"] == "root"]), 1)

    def test_sdcard_kind_and_sorting(self):
        nodes = [
            {"name": "mmcblk0p1", "path": "/dev/mmcblk0p1", "fstype": "ext4", "label": "Cartão", "size": 9, "type": "part", "mountpoints": []},
            {"name": "sdb1", "path": "/dev/sdb1", "fstype": "ext4", "label": "Alfa", "size": 9, "type": "part", "mountpoints": []},
        ]
        drives = self.collect([], nodes)
        kinds = [(d["kind"], d["name"]) for d in drives]
        self.assertEqual(kinds[:2], [("home", "home"), ("root", "/")])
        self.assertIn(("sdcard", "Cartão"), kinds)
        self.assertLess(kinds.index(("internal", "Alfa")), kinds.index(("sdcard", "Cartão")))

    def test_unlabeled_partition_uses_fallback_name(self):
        nodes = [{"name": "sdq1", "path": "/dev/sdq1", "fstype": "ext4", "label": None, "size": 9, "type": "part", "mountpoints": []}]
        names = [d["name"] for d in self.collect([], nodes)]
        self.assertIn("SDQ1", names)

    def test_list_drives_api(self):
        with mock.patch.object(probe, "lsblk_devices", return_value=[]), mock.patch.object(udisks_view, "read_volumes", return_value=None):
            result = self.run_async(self.plugin.list_drives())
        self.assertIn("drives", result)
        self.assertTrue(any(d["kind"] == "home" for d in result["drives"]))

    def test_disk_usage_and_make_drive(self):
        total, free = self.plugin._disk_usage(self.work)
        self.assertGreater(total, 0)
        self.assertEqual(self.plugin._disk_usage("/does/not/exist"), (None, None))
        mounted = self.plugin._make_drive(self.work, "n", "internal", "/dev/x", True, "ext4")
        self.assertEqual((mounted["fstype"], mounted["system"], mounted["mounted"], mounted["read_only"]), ("ext4", False, True, False))
        unmounted = self.plugin._make_drive("/dev/x", "n", "usb", "/dev/x", False, "vfat", 77)
        self.assertEqual((unmounted["total"], unmounted["free"]), (77, None))

    def test_read_only_detection(self):
        self.assertTrue(self.plugin._is_read_only("/x", False, "iso9660"))
        self.assertTrue(self.plugin._is_read_only("/x", False, "ext4", flagged=True))
        self.assertFalse(self.plugin._is_read_only("/x", False, "ext4"))
        self.assertFalse(self.plugin._is_read_only(self.work, True, "ext4"))
        self.assertFalse(self.plugin._is_read_only("/does/not/exist", True, "ext4"))
        with mock.patch("os.statvfs", return_value=mock.Mock(f_flag=os.ST_RDONLY)):
            self.assertTrue(self.plugin._is_read_only(self.work, True, "ext4"))

    def test_fallback_hides_whole_disk_with_partitions_esp_and_recovery(self):
        nodes = [
            {"name": "sdc", "path": "/dev/sdc", "fstype": "iso9660", "label": "Live", "size": 9, "type": "disk", "mountpoints": [None], "has_partitions": True},
            {"name": "sdc2", "path": "/dev/sdc2", "fstype": "vfat", "label": None, "size": 9, "type": "part", "mountpoints": [None], "parttype": probe.ESP_PART_TYPE},
            {"name": "sdc3", "path": "/dev/sdc3", "fstype": None, "label": None, "size": 9, "type": "part", "mountpoints": [None]},
            {"name": "sdd1", "path": "/dev/sdd1", "fstype": "ntfs", "label": "Recovery", "size": 9, "type": "part", "mountpoints": [None]},
            {"name": "sde", "path": "/dev/sde", "fstype": "ext4", "label": "Solto", "size": 9, "type": "disk", "mountpoints": [None]},
        ]
        names = [d["name"] for d in self.collect([], nodes) if not d["system"]]
        self.assertEqual(names, ["Solto"])

    def test_fallback_hides_mounted_esp(self):
        media = self.make_dir("media/ESP")
        mounts = [("/dev/sdc2", media, "vfat")]
        nodes = [{"name": "sdc2", "path": "/dev/sdc2", "fstype": "vfat", "type": "part", "parttype": probe.ESP_PART_TYPE}]
        with mock.patch.object(self.plugin, "_REMOVABLE_MOUNT_ROOTS", (os.path.dirname(media),)):
            self.assertEqual([d["kind"] for d in self.collect(mounts, nodes)], ["home", "root"])

    def test_udisks_view_decides_what_is_listed(self):
        media = self.make_dir("media/Live")
        other = self.make_dir("media/EFI")
        mounts = [("/dev/sdc1", media, "iso9660"), ("/dev/sdc2", other, "vfat"), ("/dev/sdc1", media + "-bind", "iso9660")]
        visible = {
            "/dev/sdc1": {"device": "/dev/sdc1", "label": "Bazzite-Live", "fstype": "iso9660", "size": 9, "readonly": False, "removable": True, "mount_points": [media]},
            "/dev/sdf1": {"device": "/dev/sdf1", "label": "Fechado", "fstype": "exfat", "size": 77, "readonly": False, "removable": True, "mount_points": []},
        }
        with mock.patch.object(self.plugin, "_REMOVABLE_MOUNT_ROOTS", (os.path.dirname(media),)):
            drives = self.collect(mounts, [], visible=visible)
        user = [d for d in drives if not d["system"]]
        self.assertEqual([(d["name"], d["mounted"], d["read_only"]) for d in user], [("Bazzite-Live", True, True), ("Fechado", False, False)])
        self.assertEqual(user[1]["total"], 77)
        self.assertEqual(user[1]["kind"], "usb")

    def test_locked_encrypted_volume_is_listed_as_encrypted(self):
        visible = {
            "/dev/sdf1": {"device": "/dev/sdf1", "label": "", "fstype": "crypto_LUKS", "size": 500, "readonly": False, "removable": True, "mount_points": [], "encrypted": True},
        }
        drives = [d for d in self.collect([], [], visible=visible) if not d["system"]]
        self.assertEqual([(d["encrypted"], d["mounted"], d["fstype"], d["total"]) for d in drives], [(True, False, "crypto_LUKS", 500)])
        self.assertEqual(drives[0]["name"], "SDF1")
        self.assertFalse(self.plugin._make_drive(self.work, "n", "usb")["encrypted"])

    def test_mount_point_lookup(self):
        with mock.patch.object(probe, "read_mount_table", return_value=[("/dev/sdx1", "/mnt/x", "ext4")]):
            self.assertEqual(self.plugin._mount_point_for_device("/dev/sdx1"), "/mnt/x")
            self.assertIsNone(self.plugin._mount_point_for_device("/dev/sdy1"))


if __name__ == "__main__":
    unittest.main()
