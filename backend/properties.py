import asyncio
import os
import pwd
import stat as statmod

from .file_management import FileManagement

FS_IOC_GETFLAGS = 0x80086601
FS_IMMUTABLE_FL = 0x00000010


def _is_immutable(path: str, mode: int) -> bool:
    if not (statmod.S_ISREG(mode) or statmod.S_ISDIR(mode)):
        return False
    try:
        import fcntl
        import struct

        fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
        try:
            raw = fcntl.ioctl(fd, FS_IOC_GETFLAGS, struct.pack("L", 0))
        finally:
            os.close(fd)
        return bool(struct.unpack("L", raw)[0] & FS_IMMUTABLE_FL)
    except Exception:
        return False


def _owner_name(uid: int) -> str:
    try:
        return pwd.getpwuid(uid).pw_name
    except KeyError:
        return str(uid)


class Properties(FileManagement):

    def _get_directory_size(self, directory: str) -> int:
        total = 0
        pending = [directory]
        while pending:
            current = pending.pop()
            try:
                with os.scandir(current) as entries:
                    for entry in entries:
                        try:
                            if entry.is_symlink():
                                continue
                            if entry.is_dir(follow_symlinks=False):
                                pending.append(entry.path)
                            else:
                                total += entry.stat(follow_symlinks=False).st_size
                        except OSError:
                            continue
            except OSError:
                continue
        return total

    def _collect_properties(self, path: str) -> dict:
        stat = os.stat(path, follow_symlinks=False)
        is_dir = os.path.isdir(path)

        return {
            "name": os.path.basename(path),
            "path": path,
            "size": None if is_dir else stat.st_size,
            "type": "folder" if is_dir else "file",
            "created": int(stat.st_ctime),
            "modified": int(stat.st_mtime),
            "permissions": {
                "owner": _owner_name(stat.st_uid),
                "immutable": _is_immutable(path, stat.st_mode),
                "raw": oct(stat.st_mode),
            },
        }

    async def get_properties(self, path: str) -> dict:
        if not path:
            raise ValueError("Caminho inválido")
        path = os.path.abspath(path)
        if not os.path.lexists(path):
            raise FileNotFoundError(f"Item não existe: {path}")
        return await asyncio.to_thread(self._collect_properties, path)

    async def get_properties_item(self, path: str) -> dict:
        return await self.get_properties(path)

    async def get_directory_size(self, path: str) -> dict:
        if not path:
            raise ValueError("Caminho inválido")
        path = os.path.abspath(path)
        if not os.path.exists(path):
            raise FileNotFoundError(f"Item não existe: {path}")
        if not os.path.isdir(path):
            return {"size": None, "path": path}

        size = await asyncio.to_thread(self._get_directory_size, path)
        return {"size": size, "path": path}
