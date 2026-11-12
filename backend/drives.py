import asyncio
import os
from typing import Dict

from . import drive_probe as probe
from . import udisks_view
from .paths import user_home


class Drives:
    _PSEUDO_FILESYSTEMS = {
        "autofs", "binfmt_misc", "bpf", "cgroup", "cgroup2", "configfs",
        "debugfs", "devpts", "devtmpfs", "efivarfs", "fuse.gvfsd-fuse",
        "fuse.portal", "fusectl", "hugetlbfs", "mqueue", "nsfs", "overlay",
        "proc", "pstore", "ramfs", "rpc_pipefs", "securityfs", "selinuxfs",
        "squashfs", "sysfs", "tmpfs", "tracefs",
    }
    _REMOVABLE_MOUNT_ROOTS = ("/run/media", "/media", "/mnt")

    def _disk_usage(self, path: str) -> tuple:
        try:
            stat = os.statvfs(path)
        except OSError:
            return (None, None)
        return (stat.f_blocks * stat.f_frsize, stat.f_bavail * stat.f_frsize)

    _READ_ONLY_FILESYSTEMS = {"iso9660", "udf"}

    def _is_read_only(self, path: str, mounted: bool, fstype: str | None, flagged: bool = False) -> bool:
        if fstype in self._READ_ONLY_FILESYSTEMS or flagged:
            return True
        if not mounted:
            return False
        try:
            return bool(os.statvfs(path).f_flag & os.ST_RDONLY)
        except OSError:
            return False

    def _make_drive(self, path: str, name: str, kind: str, device: str | None = None, mounted: bool = True,
                    fstype: str | None = None, total: int | None = None, read_only: bool = False, encrypted: bool = False) -> dict:
        used_total, free = self._disk_usage(path) if mounted else (None, None)
        return {
            "name": name,
            "path": path,
            "kind": kind,
            "device": device,
            "total": used_total if mounted else total,
            "free": free,
            "mounted": mounted,
            "fstype": fstype,
            "system": kind in ("home", "root"),
            "read_only": self._is_read_only(path, mounted, fstype, read_only),
            "encrypted": encrypted,
        }

    @staticmethod
    def _drive_kind(block_name: str, removable: bool | None) -> str:
        if block_name.startswith("mmcblk"):
            return "sdcard"
        return "usb" if removable else "internal"

    def _collect_mounted(self, mounts, labels, add, home: str, info: dict, visible: dict | None) -> None:
        for device, mount_point, fs_type in mounts:
            if not device.startswith("/dev/"):
                continue
            if fs_type in self._PSEUDO_FILESYSTEMS or not os.path.isdir(mount_point):
                continue
            if mount_point in (home, "/"):
                continue

            real_device = os.path.realpath(device)
            volume = (visible or {}).get(real_device)
            node = info.get(real_device, {})
            if visible is not None and volume is None:
                continue
            if visible is None and probe.is_hidden_by_udisks_rules(node):
                continue

            base = os.path.basename(real_device)
            removable = probe.is_removable_block(base)
            if volume and volume["removable"] and removable is None:
                removable = True
            if not (probe.in_removable_root(mount_point, self._REMOVABLE_MOUNT_ROOTS) or removable is True):
                continue

            name = (volume or {}).get("label") or labels.get(real_device) or os.path.basename(mount_point.rstrip("/")) or base
            add(mount_point, name, self._drive_kind(base, removable), device, True, fs_type or node.get("fstype"),
                None, bool((volume or {}).get("readonly")), real_device)

    def _collect_unmounted(self, labels, add, nodes: list[dict], visible: dict | None) -> None:
        if visible is not None:
            by_device = {os.path.realpath(node["path"]): node for node in nodes if node.get("path")}
            candidates = [(device, volume, by_device.get(device, {})) for device, volume in visible.items() if not volume["mount_points"]]
        else:
            candidates = [(os.path.realpath(node["path"]), None, node) for node in nodes if probe.is_visible_unmounted(node)]

        for real_device, volume, node in candidates:
            name_hint = os.path.basename(real_device)
            label = (volume or {}).get("label") or node.get("label") or labels.get(real_device) or probe.device_name_fallback(name_hint)
            if probe.is_boot_partition_label(label):
                continue
            removable = bool(node.get("rm") or node.get("hotplug") or (volume or {}).get("removable"))
            device = node.get("path") or real_device
            fstype = (volume or {}).get("fstype") or node.get("fstype")
            total = (volume or {}).get("size") or node.get("size")
            add(device, label, self._drive_kind(name_hint, removable), device, False, fstype, total,
                bool((volume or {}).get("readonly")), real_device, bool((volume or {}).get("encrypted")))

    def _collect_drives(self) -> list:
        drives: list = []
        seen: set = set()

        seen_devices: set = set()

        def add(path: str, name: str, kind: str, device: str | None = None, mounted: bool = True,
                fstype: str | None = None, total: int | None = None, read_only: bool = False,
                real_device: str | None = None, encrypted: bool = False) -> None:
            if not path:
                return
            real = os.path.realpath(path)
            if real in seen or (real_device and real_device in seen_devices) or (mounted and not os.path.isdir(path)):
                return
            seen.add(real)
            if real_device:
                seen_devices.add(real_device)
            drives.append(self._make_drive(path, name, kind, device, mounted, fstype, total, read_only, encrypted))

        home = user_home()
        add(home, os.path.basename(home.rstrip("/")) or "home", "home")

        labels = probe.device_labels()
        nodes = probe.lsblk_devices()
        info = {os.path.realpath(node["path"]): node for node in nodes if node.get("path")}
        visible = udisks_view.read_volumes(home)
        self._collect_mounted(probe.read_mount_table(), labels, add, home, info, visible)
        self._collect_unmounted(labels, add, nodes, visible)
        add("/", "/", "root")

        order = {"home": 0, "root": 1}
        drives.sort(key=lambda d: (order.get(d["kind"], 2), d["kind"], (d.get("name") or "").lower()))
        return drives

    @staticmethod
    def _mount_point_for_device(device: str) -> str | None:
        real_device = os.path.realpath(device)
        for source, mount_point, _ in probe.read_mount_table():
            if source.startswith("/dev/") and os.path.realpath(source) == real_device:
                return mount_point
        return None

    async def list_drives(self) -> Dict:
        drives = await asyncio.to_thread(self._collect_drives)
        return {"drives": drives}
