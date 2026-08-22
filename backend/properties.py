import os
import pwd

from .file_management import FileManagement


class Properties(FileManagement):

    def _get_properties(self, target_path: str) -> dict:
        stat = os.stat(target_path, follow_symlinks=False)
        is_dir = os.path.isdir(target_path)

        return {
            "name": os.path.basename(target_path),
            "path": target_path,
            "is_dir": is_dir,
            "size": None if is_dir else stat.st_size,
            "modified": int(stat.st_mtime),
        }

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
                        except (PermissionError, FileNotFoundError, OSError):
                            continue
            except (PermissionError, FileNotFoundError, OSError):
                continue
        return total

    async def get_properties(self, path: str) -> dict:
        if not path:
            raise ValueError("Caminho inválido")
        path = os.path.abspath(path)
        if not os.path.exists(path):
            raise FileNotFoundError(f"Item não existe: {path}")
        return await self.get_properties_item(path)

    async def get_properties_item(self, path: str) -> dict:
        stat = os.stat(path, follow_symlinks=False)
        is_dir = os.path.isdir(path)

        created = int(stat.st_ctime)
        modified = int(stat.st_mtime)

        owner_name = None
        try:
            owner_name = pwd.getpwuid(stat.st_uid).pw_name
        except KeyError:
            owner_name = str(stat.st_uid)

        current_user_name = None
        try:
            current_user_name = pwd.getpwuid(os.getuid()).pw_name
        except Exception:
            current_user_name = None

        if stat.st_uid == 0:
            owner_display = "root"
        elif current_user_name is not None and stat.st_uid == os.getuid():
            owner_display = current_user_name
        else:
            owner_display = owner_name

        immutable = False
        if os.name == "posix":
            try:
                import fcntl
                import struct
                import stat as statmod

                FS_IOC_GETFLAGS = 0x80086601
                fd = os.open(path, os.O_RDONLY)
                try:
                    flags = struct.unpack("I", fcntl.ioctl(fd, FS_IOC_GETFLAGS, struct.pack("I", 0)))[0]
                    immutable_flag = getattr(statmod, "FS_IMMUTABLE_FL", 0)
                    if immutable_flag and flags & immutable_flag:
                        immutable = True
                finally:
                    os.close(fd)
            except Exception:
                pass

        size = None if is_dir else stat.st_size

        return {
            "name": os.path.basename(path),
            "path": path,
            "size": size,
            "type": "folder" if is_dir else "file",
            "created": created,
            "modified": modified,
            "permissions": {
                "owner": owner_display,
                "immutable": immutable,
                "raw": oct(stat.st_mode),
            },
        }

    async def get_directory_size(self, path: str) -> dict:
        import asyncio
        
        if not path:
            raise ValueError("Caminho inválido")
        path = os.path.abspath(path)
        if not os.path.exists(path):
            raise FileNotFoundError(f"Item não existe: {path}")
        if not os.path.isdir(path):
            return {"size": None, "path": path}

        size = await asyncio.to_thread(self._get_directory_size, path)
        return {"size": size, "path": path}
