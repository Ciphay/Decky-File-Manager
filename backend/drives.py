import os
import re
import shutil
import subprocess
import asyncio
from typing import Dict


class Drives:
    _PSEUDO_FILESYSTEMS = {
        "autofs", "binfmt_misc", "bpf", "cgroup", "cgroup2", "configfs",
        "debugfs", "devpts", "devtmpfs", "efivarfs", "fuse.gvfsd-fuse",
        "fuse.portal", "fusectl", "hugetlbfs", "mqueue", "nsfs", "overlay",
        "proc", "pstore", "ramfs", "rpc_pipefs", "securityfs", "selinuxfs",
        "squashfs", "sysfs", "tmpfs", "tracefs",
    }

    _REMOVABLE_MOUNT_ROOTS = ("/run/media", "/media", "/mnt")

    @staticmethod
    def _unescape_mount_field(field: str) -> str:
        out = []
        i = 0
        while i < len(field):
            ch = field[i]
            if ch == "\\" and i + 3 < len(field) and field[i + 1:i + 4].isdigit():
                try:
                    out.append(chr(int(field[i + 1:i + 4], 8)))
                    i += 4
                    continue
                except ValueError:
                    pass
            out.append(ch)
            i += 1
        return "".join(out)

    @staticmethod
    def _device_labels() -> dict:
        labels: dict = {}
        by_label = "/dev/disk/by-label"
        try:
            for name in os.listdir(by_label):
                link = os.path.join(by_label, name)
                try:
                    labels[os.path.realpath(link)] = Drives._unescape_mount_field(name)
                except OSError:
                    continue
        except OSError:
            pass
        return labels

    @staticmethod
    def _device_name_fallback(block_name: str, real_device: str) -> str:
        candidates = []
        sys_path = os.path.join("/sys/class/block", os.path.basename(real_device))

        for file_name in ("model", "device/model", "vendor", "device/vendor"):
            full_path = os.path.join(sys_path, file_name)
            if os.path.exists(full_path):
                candidates.append(full_path)

        for candidate in candidates:
            try:
                with open(candidate, "r", encoding="utf-8") as f:
                    value = f.read().strip()
                    if value:
                        return value
            except OSError:
                continue

        return block_name.upper()

    @staticmethod
    def _label_for_device(labels: dict, real_device: str) -> str | None:
        match = labels.get(real_device)
        if match:
            return match

        base = os.path.basename(real_device)
        if not re.search(r"(?:^|[a-zA-Z])\d+$", base):
            return None

        for label_device, label_name in labels.items():
            label_base = os.path.basename(label_device)
            if label_base == base:
                return label_name
        return None

    _BOOT_PARTITION_NAMES = {"efi", "esp", "boot"}

    @staticmethod
    def _is_partition_device(block_name: str) -> bool:
        return bool(re.search(r"(?:[a-zA-Z])\d+$", block_name) or re.search(r"p\d+$", block_name))

    @staticmethod
    def _parent_block_device(block_name: str) -> str:
        match = re.match(r"^(.*?)(p?)(\d+)$", block_name)
        if not match:
            return block_name
        return match.group(1)

    @staticmethod
    def _is_boot_partition_label(label: str | None) -> bool:
        if not label:
            return False
        cleaned = label.strip().lower().replace("_", "")
        return cleaned in Drives._BOOT_PARTITION_NAMES

    @staticmethod
    def _is_removable_device(device: str) -> bool | None:
        base = os.path.basename(os.path.realpath(device))
        if not base:
            return None
        parent = re.sub(r"(p?\d+)$", "", base) if not base.startswith("mmcblk") else re.sub(r"p\d+$", "", base)
        for candidate in (base, parent):
            try:
                with open(f"/sys/class/block/{candidate}/removable", "r", encoding="utf-8") as f:
                    return f.read().strip() == "1"
            except OSError:
                continue
        return None

    def _disk_usage(self, path: str) -> tuple:
        try:
            stat = os.statvfs(path)
        except OSError:
            return (None, None)
        total = stat.f_blocks * stat.f_frsize
        free = stat.f_bavail * stat.f_frsize
        return (total, free)

    def _make_drive(self, path: str, name: str, kind: str, device: str | None = None, mounted: bool = True) -> dict:
        total, free = self._disk_usage(path) if mounted else (None, None)
        return {
            "name": name,
            "path": path,
            "kind": kind,
            "device": device,
            "total": total,
            "free": free,
            "mounted": mounted,
        }

    def _collect_drives(self) -> list:
        drives: list = []
        seen: set = set()
        seen_devices: set = set()

        def add(path: str, name: str, kind: str, device: str | None = None, mounted: bool = True) -> None:
            if not path:
                return
            real = os.path.realpath(path)
            if real in seen:
                return
            seen.add(real)
            if mounted and not os.path.isdir(path):
                return
            drives.append(self._make_drive(path, name, kind, device, mounted))

        home = os.environ.get("DECKY_USER_HOME") or os.path.expanduser("~")
        if not os.path.isdir(home):
            home = "/home/deck"
        add(home, os.path.basename(home.rstrip("/")) or "home", "home")

        labels = self._device_labels()

        try:
            with open("/proc/mounts", "r", encoding="utf-8") as f:
                mount_lines = f.readlines()
        except OSError:
            mount_lines = []

        for line in mount_lines:
            parts = line.split()
            if len(parts) < 3:
                continue

            device = self._unescape_mount_field(parts[0])
            mount_point = self._unescape_mount_field(parts[1])
            fs_type = parts[2]

            if not device.startswith("/dev/"):
                continue
            if fs_type in self._PSEUDO_FILESYSTEMS:
                continue
            if not os.path.isdir(mount_point):
                continue

            if mount_point in (home, "/"):
                continue

            in_media_dir = mount_point.startswith(self._REMOVABLE_MOUNT_ROOTS)
            removable = self._is_removable_device(device)
            if not (in_media_dir or removable is True):
                continue

            real_device = os.path.realpath(device)
            if real_device in seen_devices:
                continue
            seen_devices.add(real_device)

            base_device = os.path.basename(real_device)
            if base_device.startswith("mmcblk"):
                kind = "sdcard"
            elif removable is True:
                kind = "usb"
            else:
                kind = "internal"
            name = labels.get(real_device) or os.path.basename(mount_point.rstrip("/")) or base_device
            add(mount_point, name, kind, device, mounted=True)

        try:
            block_entries = os.listdir("/sys/class/block")
        except OSError:
            block_entries = []

        root_device = None
        try:
            with open("/proc/mounts", "r", encoding="utf-8") as f:
                for line in f:
                    parts = line.split()
                    if len(parts) >= 2 and parts[1] == "/" and parts[0].startswith("/dev/"):
                        root_device = os.path.realpath(parts[0])
                        break
        except OSError:
            pass

        root_disk_name = None
        if root_device:
            root_disk_name = Drives._parent_block_device(os.path.basename(root_device))

        for block_name in block_entries:
            if block_name.startswith(("loop", "ram", "zram", "sr", "dm")):
                continue

            if not block_name:
                continue

            sys_path = os.path.join("/sys/class/block", block_name)
            is_partition = bool(re.search(r"(?:[a-zA-Z])\d+$", block_name) or re.search(r"p\d+$", block_name))
            parent_name = Drives._parent_block_device(block_name)
            removable_probe = parent_name if is_partition else block_name
            is_removable = None
            try:
                with open(os.path.join("/sys/class/block", removable_probe, "removable"), "r", encoding="utf-8") as f:
                    is_removable = f.read().strip() == "1"
            except OSError:
                is_removable = None

            if root_device and (os.path.realpath(os.path.join("/dev", block_name)) == root_device or block_name == root_disk_name):
                continue

            if is_partition and root_disk_name and parent_name == root_disk_name:
                continue

            if is_partition and not is_removable and not block_name.startswith("mmcblk"):
                continue

            device = os.path.join("/dev", block_name)
            if not os.path.exists(device):
                continue

            candidates = [block_name]
            try:
                for child in sorted(os.listdir(sys_path)):
                    if child == block_name:
                        continue
                    if child.startswith(block_name) and (child[len(block_name):].startswith("p") or child[len(block_name):].isdigit()):
                        candidates.append(child)
            except OSError:
                pass

            if len(candidates) > 1:
                for candidate in candidates[1:]:
                    candidate_device = os.path.join("/dev", candidate)
                    if not os.path.exists(candidate_device):
                        continue
                    real_device = os.path.realpath(candidate_device)
                    if real_device in seen_devices:
                        continue
                    if os.path.ismount(candidate_device):
                        continue

                    kind = "sdcard" if candidate.startswith("mmcblk") else ("usb" if is_removable else "internal")
                    label = Drives._label_for_device(labels, real_device)
                    if not label:
                        label = Drives._device_name_fallback(candidate, real_device)
                    if Drives._is_boot_partition_label(label):
                        continue

                    add(candidate_device, label, kind, candidate_device, mounted=False)
                continue

            real_device = os.path.realpath(device)
            if real_device in seen_devices:
                continue
            if os.path.ismount(device):
                continue

            size_path = os.path.join(sys_path, "size")
            try:
                with open(size_path, "r", encoding="utf-8") as f:
                    size_val = f.read().strip()
                    if not size_val or int(size_val) == 0:
                        continue
            except Exception:
                pass

            kind = "sdcard" if block_name.startswith("mmcblk") else ("usb" if is_removable else "internal")
            label = Drives._label_for_device(labels, real_device)
            if not label:
                label = Drives._device_name_fallback(block_name, real_device)
            if Drives._is_boot_partition_label(label):
                continue
            add(device, label, kind, device, mounted=False)

        add("/", "/", "root", mounted=True)

        def drive_sort_key(drive):
            name = (drive.get("name") or "").lower()
            kind = drive.get("kind")
            if kind == "home":
                return (0, name)
            if kind == "root":
                return (1, name)
            return (2, kind, name)

        drives.sort(key=drive_sort_key)
        return drives

    @staticmethod
    def _mount_point_for_device(device: str) -> str | None:
        real_device = os.path.realpath(device)
        try:
            with open("/proc/mounts", "r", encoding="utf-8") as f:
                for line in f:
                    parts = line.split()
                    if len(parts) < 2:
                        continue
                    if os.path.realpath(parts[0]) == real_device:
                        return parts[1]
        except OSError:
            pass
        return None

    @staticmethod
    def _sanitize_mount_name(name: str) -> str:
        cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", (name or "drive")).strip("_")
        return cleaned or "drive"

    async def mount_drive(self, device: str) -> Dict:
        if not device:
            return {"ok": False, "error": "Dispositivo não informado"}

        device = os.path.realpath(device)
        existing = self._mount_point_for_device(device)
        if existing and os.path.isdir(existing):
            return {"ok": True, "path": existing}

        label = self._device_labels().get(device) or self._sanitize_mount_name(os.path.basename(device))
        mount_point = os.path.join("/run/media", os.environ.get("USER") or "deck", label)

        try:
            os.makedirs(mount_point, exist_ok=True)
        except OSError:
            mount_point = os.path.join("/media", label)
            os.makedirs(mount_point, exist_ok=True)

        command = None
        if shutil.which("udisksctl"):
            command = ["udisksctl", "mount", "-b", device]
        elif shutil.which("pmount"):
            command = ["pmount", device]
        else:
            command = ["mount", "-o", "rw", device, mount_point]

        try:
            subprocess.run(command, check=False, capture_output=True, text=True)
        except OSError:
            return {"ok": False, "error": "Não foi possível montar o dispositivo"}

        resolved = self._mount_point_for_device(device) or mount_point
        if os.path.isdir(resolved) and os.path.ismount(resolved):
            return {"ok": True, "path": resolved}

        if os.path.isdir(mount_point) and os.path.ismount(mount_point):
            return {"ok": True, "path": mount_point}

        return {"ok": False, "error": "O dispositivo não foi montado"}

    async def list_drives(self) -> Dict:
        drives = await asyncio.to_thread(self._collect_drives)
        return {"drives": drives}
