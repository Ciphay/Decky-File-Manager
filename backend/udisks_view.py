
import os
import re
import shutil
import subprocess

PREFIX = "org.freedesktop.UDisks2."


def read_dump() -> str | None:
    if not shutil.which("udisksctl"):
        return None
    try:
        result = subprocess.run(["udisksctl", "dump"], capture_output=True, text=True, timeout=10, env={**os.environ, "LC_ALL": "C"})
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout if result.returncode == 0 and result.stdout.strip() else None


def parse_dump(text: str) -> dict[str, dict[str, dict[str, str]]]:
    objects: dict[str, dict[str, dict[str, str]]] = {}
    ifaces: dict[str, dict[str, str]] | None = None
    props: dict[str, str] | None = None
    key = ""
    for raw in text.splitlines():
        if not raw.strip():
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        if indent == 0 and raw.startswith("/"):
            ifaces = objects.setdefault(raw.rstrip(":").strip(), {})
            props = None
        elif indent == 2 and ifaces is not None and raw.rstrip().endswith(":"):
            props = ifaces.setdefault(raw.strip().rstrip(":").removeprefix(PREFIX), {})
            key = ""
        elif props is not None and indent == 4 and ":" in raw:
            key, _, value = raw.strip().partition(":")
            props[key] = value.strip()
        elif props is not None and key and indent > 4:
            props[key] = f"{props[key]}\n{raw.strip()}" if props[key] else raw.strip()
    return objects


def _is_true(value: str | None) -> bool:
    return (value or "").strip().lower() == "true"


def _mount_points(fs: dict[str, str]) -> list[str]:
    return [line.strip() for line in (fs.get("MountPoints") or "").splitlines() if line.strip()]


def is_ignored(ifaces: dict[str, dict[str, str]], home: str) -> bool:
    block = ifaces.get("Block", {})
    if _is_true(block.get("HintIgnore")):
        return True
    if "x-gdu.hide" in re.split(r"[,\s]+", block.get("UserspaceMountOptions", "")):
        return True
    if "Swap" in ifaces:
        return True
    backing = ifaces.get("Loop", {}).get("BackingFile", "").strip()
    return bool(backing) and not backing.startswith(home)


def _object_ref(value: str | None) -> str:
    return (value or "").strip().strip("'")


def _has_ref(value: str | None) -> bool:
    return _object_ref(value) not in ("", "/")


def _removable(objects: dict, block: dict) -> bool:
    drive = objects.get(_object_ref(block.get("Drive")), {}).get("Drive", {})
    if _is_true(drive.get("Removable")) or _is_true(drive.get("MediaRemovable")):
        return True
    backing = objects.get(_object_ref(block.get("CryptoBackingDevice")), {}).get("Block")
    return bool(backing) and _removable(objects, backing)


def _volume(objects: dict, block: dict, mount_points: list[str], **extra) -> dict | None:
    device = block.get("Device") or block.get("PreferredDevice")
    if not device:
        return None
    try:
        size = int(block.get("Size") or 0)
    except ValueError:
        size = 0
    return {
        "device": os.path.realpath(device),
        "label": block.get("HintName") or block.get("IdLabel") or "",
        "fstype": block.get("IdType") or None,
        "size": size,
        "readonly": _is_true(block.get("ReadOnly")),
        "removable": _removable(objects, block),
        "mount_points": mount_points,
        "encrypted": False,
        **extra,
    }


def volumes_from_dump(text: str, home: str) -> list[dict]:
    objects = parse_dump(text)
    volumes: list[dict] = []
    for path, ifaces in objects.items():
        if "/block_devices/" not in path:
            continue
        block, fs, encrypted = ifaces.get("Block"), ifaces.get("Filesystem"), ifaces.get("Encrypted")
        if block is None or is_ignored(ifaces, home):
            continue
        if fs is not None:
            volume = _volume(objects, block, _mount_points(fs))
        elif encrypted is not None and not _has_ref(encrypted.get("CleartextDevice")):
            volume = _volume(objects, block, [], encrypted=True)
        else:
            continue
        if volume:
            volumes.append(volume)
    return volumes


def _find_block(objects: dict, device: str) -> dict | None:
    real = os.path.realpath(device)
    for ifaces in objects.values():
        block = ifaces.get("Block")
        if block and block.get("Device") and os.path.realpath(block["Device"]) == real:
            return ifaces
    return None


def container_state(device: str) -> dict | None:
    text = read_dump()
    ifaces = _find_block(parse_dump(text), device) if text else None
    if not ifaces or "Encrypted" not in ifaces:
        return None
    objects = parse_dump(text)
    cleartext = None
    ref = _object_ref(ifaces["Encrypted"].get("CleartextDevice"))
    if _has_ref(ref):
        device_path = objects.get(ref, {}).get("Block", {}).get("Device")
        cleartext = os.path.realpath(device_path) if device_path else None
    return {"cleartext": cleartext}


def backing_device(device: str) -> str | None:
    text = read_dump()
    if not text:
        return None
    objects = parse_dump(text)
    ifaces = _find_block(objects, device)
    ref = _object_ref(ifaces["Block"].get("CryptoBackingDevice")) if ifaces else ""
    if not _has_ref(ref):
        return None
    backing = objects.get(ref, {}).get("Block", {}).get("Device")
    return os.path.realpath(backing) if backing else None


def read_volumes(home: str) -> dict[str, dict] | None:
    text = read_dump()
    if text is None:
        return None
    return {volume["device"]: volume for volume in volumes_from_dump(text, home)}
