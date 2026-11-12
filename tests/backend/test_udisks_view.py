import subprocess
import unittest
from unittest import mock

from backend import udisks_view

HOME = "/home/rafael"

DUMP = """/org/freedesktop/UDisks2/block_devices/sdc:
  org.freedesktop.UDisks2.Block:
    Device:                     /dev/sdc
    Drive:                      '/org/freedesktop/UDisks2/drives/Cruzer'
    HintIgnore:                 false
    IdType:                     iso9660
    IdUsage:                    filesystem
    Size:                       15664676864
  org.freedesktop.UDisks2.PartitionTable:
    Type:               gpt
/org/freedesktop/UDisks2/block_devices/sdc1:
  org.freedesktop.UDisks2.Block:
    Device:                     /dev/sdc1
    Drive:                      '/org/freedesktop/UDisks2/drives/Cruzer'
    HintIgnore:                 false
    HintName:                   
    IdLabel:                    Bazzite-Live
    IdType:                     iso9660
    ReadOnly:                   true
    Size:                       9675712512
    Symlinks:                   /dev/disk/by-id/a
                                /dev/disk/by-id/b
  org.freedesktop.UDisks2.Filesystem:
    MountPoints:        /run/media/rafael/Bazzite-Live
                        /mnt/outro
    Size:               0
  org.freedesktop.UDisks2.Partition:
    Number:             1
/org/freedesktop/UDisks2/block_devices/sdc2:
  org.freedesktop.UDisks2.Block:
    Device:                     /dev/sdc2
    HintIgnore:                 true
    IdType:                     vfat
  org.freedesktop.UDisks2.Filesystem:
    MountPoints:        /run/media/rafael/F225-994E
/org/freedesktop/UDisks2/block_devices/sdc3:
  org.freedesktop.UDisks2.Block:
    Device:                     /dev/sdc3
    HintIgnore:                 false
  org.freedesktop.UDisks2.Partition:
    Number:             3
/org/freedesktop/UDisks2/block_devices/sdd1:
  org.freedesktop.UDisks2.Block:
    Device:                     /dev/sdd1
    HintIgnore:                 false
    HintName:                   Meu Disco
    IdLabel:                    outro
    IdType:                     ext4
    Drive:                      '/org/freedesktop/UDisks2/drives/Fixo'
    Size:                       500
  org.freedesktop.UDisks2.Filesystem:
    MountPoints:        
/org/freedesktop/UDisks2/block_devices/sde1:
  org.freedesktop.UDisks2.Block:
    Device:                     /dev/sde1
    HintIgnore:                 false
    UserspaceMountOptions:      uhelper=udisks2,x-gdu.hide
  org.freedesktop.UDisks2.Filesystem:
    MountPoints:        
/org/freedesktop/UDisks2/block_devices/sdf1:
  org.freedesktop.UDisks2.Block:
    Device:                     /dev/sdf1
    HintIgnore:                 false
  org.freedesktop.UDisks2.Filesystem:
    MountPoints:        
  org.freedesktop.UDisks2.Swap:
    Active:             true
/org/freedesktop/UDisks2/block_devices/loop0:
  org.freedesktop.UDisks2.Block:
    Device:                     /dev/loop0
    HintIgnore:                 false
  org.freedesktop.UDisks2.Filesystem:
    MountPoints:        
  org.freedesktop.UDisks2.Loop:
    BackingFile:        /var/lib/snap/x.snap
/org/freedesktop/UDisks2/block_devices/loop1:
  org.freedesktop.UDisks2.Block:
    Device:                     /dev/loop1
    HintIgnore:                 false
  org.freedesktop.UDisks2.Filesystem:
    MountPoints:        
  org.freedesktop.UDisks2.Loop:
    BackingFile:        /home/rafael/disco.img
/org/freedesktop/UDisks2/drives/Cruzer:
  org.freedesktop.UDisks2.Drive:
    Removable:          true
/org/freedesktop/UDisks2/drives/Fixo:
  org.freedesktop.UDisks2.Drive:
    Removable:          false
"""


ENCRYPTED = """/org/freedesktop/UDisks2/block_devices/sdg1:
  org.freedesktop.UDisks2.Block:
    Device:                     /dev/sdg1
    Drive:                      '/org/freedesktop/UDisks2/drives/Cruzer'
    HintIgnore:                 false
    IdLabel:                    Cofre
    IdType:                     crypto_LUKS
    IdUsage:                    crypto
    Size:                       500
  org.freedesktop.UDisks2.Encrypted:
    CleartextDevice:            '/'
/org/freedesktop/UDisks2/block_devices/sdh1:
  org.freedesktop.UDisks2.Block:
    Device:                     /dev/sdh1
    HintIgnore:                 false
    IdType:                     crypto_LUKS
    Drive:                      '/org/freedesktop/UDisks2/drives/Cruzer'
  org.freedesktop.UDisks2.Encrypted:
    CleartextDevice:            '/org/freedesktop/UDisks2/block_devices/dm_2d0'
/org/freedesktop/UDisks2/block_devices/dm_2d0:
  org.freedesktop.UDisks2.Block:
    Device:                     /dev/dm-0
    CryptoBackingDevice:        '/org/freedesktop/UDisks2/block_devices/sdh1'
    HintIgnore:                 false
    IdLabel:                    Aberto
    IdType:                     ext4
  org.freedesktop.UDisks2.Filesystem:
    MountPoints:        /run/media/rafael/Aberto
/org/freedesktop/UDisks2/block_devices/sdi1:
  org.freedesktop.UDisks2.Block:
    Device:                     /dev/sdi1
    HintIgnore:                 true
    IdType:                     crypto_LUKS
  org.freedesktop.UDisks2.Encrypted:
    CleartextDevice:            '/'
/org/freedesktop/UDisks2/drives/Cruzer:
  org.freedesktop.UDisks2.Drive:
    Removable:          true
"""


class EncryptedVolumesTests(unittest.TestCase):
    def volumes(self):
        return {v["device"]: v for v in udisks_view.volumes_from_dump(ENCRYPTED, HOME)}

    def test_locked_containers_are_listed_as_encrypted_but_unlocked_ones_are_replaced_by_their_cleartext(self):
        shown = self.volumes()
        self.assertEqual(sorted(shown), ["/dev/dm-0", "/dev/sdg1"])
        locked = shown["/dev/sdg1"]
        self.assertEqual((locked["encrypted"], locked["fstype"], locked["label"], locked["mount_points"]), (True, "crypto_LUKS", "Cofre", []))
        opened = shown["/dev/dm-0"]
        self.assertEqual((opened["encrypted"], opened["label"], opened["mount_points"]), (False, "Aberto", ["/run/media/rafael/Aberto"]))
        self.assertTrue(opened["removable"])

    def test_container_state_and_backing_device(self):
        with mock.patch.object(udisks_view, "read_dump", return_value=ENCRYPTED):
            self.assertEqual(udisks_view.container_state("/dev/sdg1"), {"cleartext": None})
            self.assertEqual(udisks_view.container_state("/dev/sdh1"), {"cleartext": "/dev/dm-0"})
            self.assertIsNone(udisks_view.container_state("/dev/dm-0"))
            self.assertIsNone(udisks_view.container_state("/dev/nada"))
            self.assertEqual(udisks_view.backing_device("/dev/dm-0"), "/dev/sdh1")
            self.assertIsNone(udisks_view.backing_device("/dev/sdg1"))
            self.assertIsNone(udisks_view.backing_device("/dev/nada"))
        with mock.patch.object(udisks_view, "read_dump", return_value=None):
            self.assertIsNone(udisks_view.container_state("/dev/sdg1"))
            self.assertIsNone(udisks_view.backing_device("/dev/dm-0"))


class UdisksViewTests(unittest.TestCase):
    def volumes(self):
        return {v["device"]: v for v in udisks_view.volumes_from_dump(DUMP, HOME)}

    def test_parse_dump_joins_continuation_lines(self):
        objects = udisks_view.parse_dump(DUMP)
        block = objects["/org/freedesktop/UDisks2/block_devices/sdc1"]
        self.assertEqual(block["Filesystem"]["MountPoints"].splitlines(), ["/run/media/rafael/Bazzite-Live", "/mnt/outro"])
        self.assertEqual(block["Block"]["Symlinks"].splitlines(), ["/dev/disk/by-id/a", "/dev/disk/by-id/b"])
        self.assertEqual(block["Block"]["HintName"], "")

    def test_only_filesystem_volumes_are_visible_like_dolphin(self):
        shown = self.volumes()
        self.assertEqual(sorted(shown), ["/dev/loop1", "/dev/sdc1", "/dev/sdd1"])

    def test_hidden_cases(self):
        shown = self.volumes()
        self.assertNotIn("/dev/sdc", shown)
        self.assertNotIn("/dev/sdc2", shown)
        self.assertNotIn("/dev/sdc3", shown)
        self.assertNotIn("/dev/sde1", shown)
        self.assertNotIn("/dev/sdf1", shown)
        self.assertNotIn("/dev/loop0", shown)

    def test_volume_fields(self):
        shown = self.volumes()
        live = shown["/dev/sdc1"]
        self.assertEqual((live["label"], live["fstype"], live["size"], live["readonly"], live["removable"]), ("Bazzite-Live", "iso9660", 9675712512, True, True))
        self.assertEqual(live["mount_points"], ["/run/media/rafael/Bazzite-Live", "/mnt/outro"])
        fixed = shown["/dev/sdd1"]
        self.assertEqual((fixed["label"], fixed["removable"], fixed["mount_points"]), ("Meu Disco", False, []))

    def test_read_dump_handles_missing_tool_and_failures(self):
        with mock.patch("shutil.which", return_value=None):
            self.assertIsNone(udisks_view.read_dump())
            self.assertIsNone(udisks_view.read_volumes(HOME))
        with mock.patch("shutil.which", return_value="/usr/bin/udisksctl"), mock.patch("subprocess.run", side_effect=OSError):
            self.assertIsNone(udisks_view.read_dump())
        failed = subprocess.CompletedProcess([], 1, stdout="", stderr="boom")
        with mock.patch("shutil.which", return_value="/x"), mock.patch("subprocess.run", return_value=failed):
            self.assertIsNone(udisks_view.read_dump())
        ok = subprocess.CompletedProcess([], 0, stdout=DUMP, stderr="")
        with mock.patch("shutil.which", return_value="/x"), mock.patch("subprocess.run", return_value=ok):
            self.assertIn("/dev/sdc1", udisks_view.read_volumes(HOME))


if __name__ == "__main__":
    unittest.main()
