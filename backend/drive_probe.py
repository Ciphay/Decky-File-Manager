
import os
import re

BOOT_PARTITION_NAMES = {"efi", "esp", "boot"}
IGNORED_BLOCK_PREFIXES = ("loop", "ram", "zram", "sr", "dm-", "md", "nbd", "fd")
SYS_BLOCK = "/sys/class/block"


def unescape_mount_field(field: str) -> str:
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


def read_mount_table() -> list[tuple[str, str, str]]:
    try:
        with open("/proc/mounts", "r", encoding="utf-8") as f:
            lines = f.readlines()
    except OSError:
        return []
    table = []
    for line in lines:
        parts = line.split()
        if len(parts) >= 3:
            table.append((unescape_mount_field(parts[0]), unescape_mount_field(parts[1]), parts[2]))
    return table


def device_labels() -> dict:
    labels: dict = {}
    by_label = "/dev/disk/by-label"
    try:
        for name in os.listdir(by_label):
            try:
                labels[os.path.realpath(os.path.join(by_label, name))] = unescape_mount_field(name)
            except OSError:
                continue
    except OSError:
        pass
    return labels


def parent_block_device(block_name: str) -> str:
    sys_path = os.path.realpath(os.path.join(SYS_BLOCK, block_name))
    if os.path.exists(os.path.join(sys_path, "partition")):
        return os.path.basename(os.path.dirname(sys_path))
    match = re.match(r"^((?:nvme\d+n\d+|mmcblk\d+|loop\d+))p\d+$", block_name) or re.match(r"^([a-z]+)\d+$", block_name)
    return match.group(1) if match else block_name


def is_removable_block(block_name: str) -> bool | None:
    disk = parent_block_device(block_name)
    for candidate in (block_name, disk):
        try:
            with open(os.path.join(SYS_BLOCK, candidate, "removable"), "r", encoding="utf-8") as f:
                return f.read().strip() == "1"
        except OSError:
            continue
    return None


def device_name_fallback(block_name: str) -> str:
    for file_name in ("device/model", "device/vendor"):
        try:
            with open(os.path.join(SYS_BLOCK, parent_block_device(block_name), file_name), "r", encoding="utf-8") as f:
                value = f.read().strip()
                if value:
                    return value
        except OSError:
            continue
    return block_name.upper()


def is_boot_partition_label(label: str | None) -> bool:
    if not label:
        return False
    return label.strip().lower().replace("_", "") in BOOT_PARTITION_NAMES


def in_removable_root(mount_point: str, roots: tuple[str, ...]) -> bool:
    return any(mount_point == root or mount_point.startswith(root + "/") for root in roots)


ESP_PART_TYPE = "c12a7328-f81f-11d2-ba4b-00a0c93ec93b"
HIDDEN_PART_TYPES = {
    ESP_PART_TYPE, "21686148-6449-6e6f-744e-656564454649", "a19d880f-05fc-4d3b-a006-743f0f84911e",
    "e6d6d379-f507-44c2-a23c-238f2a3df928", "e3c9e316-0b5c-4db8-817d-f92df00215ae", "de94bba4-06d1-4d40-a16a-bfd50179d6ac",
    "426f6f74-0000-11aa-aa11-00306543ecac", "bc13c2ff-59e6-4262-a352-b275fd6f7172",
    "0x0", "0x11", "0x12", "0x14", "0x16", "0x17", "0x1b", "0x1c", "0x1e", "0x27", "0x3d", "0x84", "0x8d", "0x8e", "0x90",
    "0x91", "0x92", "0x93", "0x97", "0x98", "0x9a", "0x9b", "0xab", "0xbb", "0xc2", "0xc3", "0xdd", "0xef", "0xfd",
}
HIDDEN_RECOVERY_LABELS = {
    "recovery", "lenovo_recovery", "hp_recovery", "recovery_partition", "dellutility", "dellrestore", "ibm_service",
    "servicev001", "servicev002", "system_reserved", "winre_drv", "diags", "intelrst",
}
IGNORED_FILESYSTEMS = {"swap", "LVM2_member", "crypto_LUKS", "linux_raid_member", "zfs_member", "bcache", "isw_raid_member"}


def lsblk_devices() -> list[dict]:
    import json
    import shutil
    import subprocess

    if not shutil.which("lsblk"):
        return []
    try:
        result = subprocess.run(
            ["lsblk", "-J", "-b", "-o", "NAME,PATH,FSTYPE,LABEL,SIZE,TYPE,MOUNTPOINTS,PARTTYPE,RM,HOTPLUG,PKNAME"],
            capture_output=True, text=True, timeout=10, env={"LC_ALL": "C", "PATH": os.environ.get("PATH", "/usr/bin")},
        )
        tree = json.loads(result.stdout or "{}").get("blockdevices", [])
    except (OSError, ValueError, subprocess.SubprocessError):
        return []

    flat: list[dict] = []

    def walk(nodes: list[dict]) -> None:
        for node in nodes:
            node["has_partitions"] = bool(node.get("children"))
            flat.append(node)
            walk(node.get("children") or [])

    walk(tree)
    return flat


def is_hidden_by_udisks_rules(node: dict) -> bool:
    if (node.get("parttype") or "").lower() in HIDDEN_PART_TYPES:
        return True
    return node.get("fstype") in ("ntfs", "vfat") and (node.get("label") or "").lower() in HIDDEN_RECOVERY_LABELS


def is_visible_node(node: dict) -> bool:
    if node.get("type") not in ("part", "disk"):
        return False
    if node.get("fstype") in (None, "") or node["fstype"] in IGNORED_FILESYSTEMS:
        return False
    if node.get("type") == "disk" and node.get("has_partitions"):
        return False
    if is_hidden_by_udisks_rules(node):
        return False
    name = node.get("name") or ""
    return not name.startswith(IGNORED_BLOCK_PREFIXES)


def is_visible_unmounted(node: dict) -> bool:
    if any(mount for mount in node.get("mountpoints") or [] if mount):
        return False
    return is_visible_node(node)
