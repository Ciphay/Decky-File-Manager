import asyncio
import os
import re
import shutil
import stat as statmod
import subprocess

from . import udisks_view
from .luks import LuksSupport
from .paths import user_home

NOT_AUTHORIZED = ("notauthorized", "not authorized", "authentication is required", "polkit")
SAFE_ENV = {"LC_ALL": "C", "PATH": "/usr/local/sbin:/usr/local/bin:/usr/bin:/usr/sbin:/sbin:/bin"}
UDISKS_DOES_NOT_KNOW = ("not a mountable filesystem", "no such interface", "is not a block device")
UID_FILESYSTEMS = {"vfat", "exfat", "ntfs", "ntfs3", "fuseblk", "msdos"}

LABEL_TOOLS = {
    "ext2": (lambda dev, label: ["e2label", dev, label], 16),
    "ext3": (lambda dev, label: ["e2label", dev, label], 16),
    "ext4": (lambda dev, label: ["e2label", dev, label], 16),
    "vfat": (lambda dev, label: ["fatlabel", dev, label.upper()], 11),
    "exfat": (lambda dev, label: ["exfatlabel", dev, label], 15),
    "ntfs": (lambda dev, label: ["ntfslabel", dev, label], 128),
    "ntfs3": (lambda dev, label: ["ntfslabel", dev, label], 128),
    "fuseblk": (lambda dev, label: ["ntfslabel", dev, label], 128),
    "btrfs": (lambda dev, label: ["btrfs", "filesystem", "label", dev, label], 255),
    "xfs": (lambda dev, label: ["xfs_admin", "-L", label, dev], 12),
}


def _result(ok: bool, **extra) -> dict:
    return {"ok": ok, **extra}


class DriveActions(LuksSupport):

    def _run(self, command: list[str], input_text: str | None = None, timeout: int = 60) -> subprocess.CompletedProcess:
        return subprocess.run(command, input=input_text, capture_output=True, text=True, timeout=timeout, env=SAFE_ENV, check=False)

    def _privileged(self, command: list[str], password: str | None) -> tuple[str, str]:
        if os.geteuid() == 0:
            process = self._run(command)
            return ("ok" if process.returncode == 0 else "error", (process.stderr or process.stdout).strip())
        if not shutil.which("sudo"):
            return ("error", "sudo não está instalado")

        if password is None:
            process = self._run(["sudo", "-n", *command])
            output = (process.stderr or process.stdout).strip()
            if process.returncode == 0:
                return ("ok", output)
            if "password is required" in output or "a terminal is required" in output:
                return ("needs_password", output)
            return ("error", output)

        process = self._run(["sudo", "-S", "-p", "", "-k", *command], input_text=password + "\n")
        output = (process.stderr or process.stdout).strip()
        if process.returncode == 0:
            return ("ok", output)
        lowered = output.lower()
        if "incorrect password" in lowered or "sorry, try again" in lowered or "no password was provided" in lowered:
            return ("wrong_password", output)
        return ("error", output)

    def _check_block_device(self, device: str) -> str | None:
        if not device:
            return None
        real = os.path.realpath(device)
        try:
            is_block = statmod.S_ISBLK(os.stat(real).st_mode)
        except OSError:
            return None
        return real if real.startswith("/dev/") and is_block else None

    def _fs_info(self, device: str) -> tuple[str | None, str | None]:
        if not shutil.which("lsblk"):
            return (None, None)
        output = self._run(["lsblk", "-dn", "-P", "-o", "FSTYPE,LABEL", device]).stdout
        fields = dict(re.findall(r'(\w+)="((?:[^"\\]|\\.)*)"', output))
        return (fields.get("FSTYPE") or None, fields.get("LABEL") or None)

    def _outcome(self, status: str, output: str, fallback: str, **extra) -> dict:
        if status == "needs_password":
            return _result(False, needs_password=True)
        if status == "wrong_password":
            return _result(False, needs_password=True, wrong_password=True)
        return _result(False, error=output or fallback, **extra)

    def _mount_blocking(self, device: str, password: str | None, passphrase: str | None = None) -> dict:
        if self._is_luks(device):
            return self._mount_encrypted(device, password, passphrase)

        existing = self._mount_point_for_device(device)
        if existing and os.path.isdir(existing):
            return _result(True, path=existing)

        if shutil.which("udisksctl"):
            process = self._run(["udisksctl", "mount", "-b", device, "--no-user-interaction"])
            resolved = self._mount_point_for_device(device)
            if process.returncode == 0 and resolved:
                return _result(True, path=resolved)
            message = (process.stderr or process.stdout).lower()
            if not any(token in message for token in NOT_AUTHORIZED):
                if not any(token in message for token in UDISKS_DOES_NOT_KNOW) and not self._fs_info(device)[0]:
                    return _result(False, error=(process.stderr or process.stdout).strip() or "O dispositivo não foi montado")

        return self._mount_privileged(device, password)

    def _mount_privileged(self, device: str, password: str | None) -> dict:
        fs_type, label = self._fs_info(device)
        user = os.path.basename(user_home().rstrip("/")) or "deck"
        name = re.sub(r"[^A-Za-z0-9._-]+", "_", label or os.path.basename(device)).strip("_.") or "drive"
        mount_point = os.path.join("/run/media", user, name)

        status, output = self._privileged(["mkdir", "-p", mount_point], password)
        if status != "ok":
            return self._outcome(status, output, "Não foi possível criar o ponto de montagem")

        options: list[str] = []
        if fs_type in UID_FILESYSTEMS:
            owner = os.stat(user_home())
            options = ["-o", f"uid={owner.st_uid},gid={owner.st_gid},umask=022"]
        status, output = self._privileged(["mount", *options, device, mount_point], password)
        if status != "ok":
            self._privileged(["rmdir", mount_point], password)
            return self._outcome(status, output, "O dispositivo não foi montado")
        return _result(True, path=mount_point)

    async def mount_drive(self, device: str, password: str | None = None, passphrase: str | None = None) -> dict:
        real = self._check_block_device(device)
        if not real:
            return _result(False, error="Dispositivo inválido")
        try:
            return await asyncio.to_thread(self._mount_blocking, real, password, passphrase)
        except subprocess.TimeoutExpired:
            return _result(False, error="Tempo esgotado ao montar o dispositivo")

    def _unmount_blocking(self, device: str, password: str | None) -> dict:
        backing = udisks_view.backing_device(device)
        result = self._unmount_device(device, password)
        if result.get("ok") and backing:
            self._lock(backing)
        return result

    def _unmount_device(self, device: str, password: str | None) -> dict:
        mount_point = self._mount_point_for_device(device)
        if not mount_point:
            return _result(True)

        if shutil.which("udisksctl"):
            process = self._run(["udisksctl", "unmount", "-b", device, "--no-user-interaction"])
            if process.returncode == 0 or not self._mount_point_for_device(device):
                return _result(True)
            message = (process.stderr or process.stdout).lower()
            if not any(token in message for token in NOT_AUTHORIZED) and "busy" not in message:
                return _result(False, error=(process.stderr or process.stdout).strip() or "Não foi possível desmontar")

        status, output = self._privileged(["umount", mount_point], password)
        lazy = False
        if status == "error" and ("busy" in output.lower() or "ocupado" in output.lower()):
            self._run(["sync"])
            status, output = self._privileged(["umount", "-l", mount_point], password)
            lazy = True
        if status != "ok":
            return self._outcome(status, output, "Não foi possível desmontar")
        if mount_point.startswith(("/run/media/", "/media/")):
            self._privileged(["rmdir", mount_point], password)
        return _result(True, lazy=lazy)

    async def unmount_drive(self, device: str, password: str | None = None) -> dict:
        real = self._check_block_device(device)
        if not real:
            return _result(False, error="Dispositivo inválido")
        try:
            return await asyncio.to_thread(self._unmount_blocking, real, password)
        except subprocess.TimeoutExpired:
            return _result(False, error="Tempo esgotado ao desmontar o dispositivo")

    def _rename_blocking(self, device: str, label: str, password: str | None) -> dict:
        label = label.strip()
        fs_type, _ = self._fs_info(device)
        tool = LABEL_TOOLS.get(fs_type or "")
        if not tool:
            return _result(False, error=f"Renomear não é suportado para {fs_type or 'este sistema de arquivos'}")
        builder, max_length = tool
        if not label or len(label) > max_length or re.search(r"[\x00-\x1f/\\]", label):
            return _result(False, error=f"Nome inválido (máximo de {max_length} caracteres)")

        command = builder(device, label)
        if not shutil.which(command[0]):
            return _result(False, error=f"Ferramenta '{command[0]}' não instalada")
        status, output = self._privileged(command, password)
        if status != "ok":
            return self._outcome(status, output, "Não foi possível renomear")
        return _result(True, label=label)

    async def rename_drive(self, device: str, label: str, password: str | None = None) -> dict:
        real = self._check_block_device(device)
        if not real:
            return _result(False, error="Dispositivo inválido")
        try:
            return await asyncio.to_thread(self._rename_blocking, real, label, password)
        except subprocess.TimeoutExpired:
            return _result(False, error="Tempo esgotado ao renomear")
