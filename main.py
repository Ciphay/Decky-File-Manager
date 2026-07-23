import os

# The decky plugin module is located at decky-loader/plugin
# For easy intellisense checkout the decky-loader code repo
# and add the `decky-loader/plugin/imports` path to `python.analysis.extraPaths` in `.vscode/settings.json`
import decky
import asyncio

class Plugin:
    def __init__(self):
        # clipboard in memory
        # kind: "copy" | "cut" | None
        self._clipboard_path: str | None = None
        self._clipboard_kind: str | None = None
        self._last_path: str | None = None
        self._settings: dict = {"default_path": "/home/deck"}
        self._settings_file = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")
        self._runtime_file = os.path.join(decky.DECKY_PLUGIN_RUNTIME_DIR, "runtime.json")
        self._load_settings()
        self._load_runtime_state()
        self._operation_cancel_requested = False
        self._operation_progress = 0
        self._operation_label = ""
        self._operation_running = False

    def _ensure_runtime_dir(self) -> None:
        os.makedirs(decky.DECKY_PLUGIN_RUNTIME_DIR, exist_ok=True)

    def _ensure_settings_dir(self) -> None:
        os.makedirs(decky.DECKY_PLUGIN_SETTINGS_DIR, exist_ok=True)

    def _load_settings(self) -> None:
        try:
            if os.path.exists(self._settings_file):
                import json

                with open(self._settings_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    default_path = data.get("default_path")
                    if isinstance(default_path, str) and default_path:
                        self._settings["default_path"] = os.path.abspath(default_path)
        except (ValueError, OSError):
            self._settings = {"default_path": "/home/deck"}

    def _save_settings(self) -> None:
        self._ensure_settings_dir()
        import json

        with open(self._settings_file, "w", encoding="utf-8") as f:
            json.dump(self._settings, f, ensure_ascii=False, indent=2)

    def _load_runtime_state(self) -> None:
        try:
            if os.path.exists(self._runtime_file):
                import json

                with open(self._runtime_file, "r", encoding="utf-8") as f:
                    data = json.load(f)

                clipboard = data.get("clipboard", {})
                path = clipboard.get("path")
                kind = clipboard.get("kind")
                if path and kind and os.path.exists(path):
                    self._clipboard_path = os.path.abspath(path)
                    self._clipboard_kind = kind
                else:
                    self._clipboard_path = None
                    self._clipboard_kind = None

                last_path = data.get("last_path")
                if last_path and os.path.isdir(last_path):
                    self._last_path = os.path.abspath(last_path)
                else:
                    self._last_path = None
            else:
                self._last_path = None
        except (ValueError, OSError):
            self._clipboard_path = None
            self._clipboard_kind = None
            self._last_path = None

    def _save_runtime_state(self) -> None:
        self._ensure_runtime_dir()
        import json

        data = {
            "clipboard": {
                "path": self._clipboard_path,
                "kind": self._clipboard_kind,
            },
            "last_path": self._last_path,
        }
        with open(self._runtime_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def _set_operation_state(self, label: str) -> None:
        self._operation_cancel_requested = False
        self._operation_progress = 0
        self._operation_label = label
        self._operation_running = True

    def _update_operation_progress(self, copied: int, total: int) -> None:
        if total <= 0:
            self._operation_progress = 100
        else:
            self._operation_progress = min(100, int(100 * copied / total))

    def _clear_operation_state(self) -> None:
        self._operation_cancel_requested = False
        self._operation_running = False
        self._operation_progress = 0
        self._operation_label = ""

    def _check_cancelled(self) -> None:
        if self._operation_cancel_requested:
            raise asyncio.CancelledError("Operação cancelada")

    def _files_with_sizes(self, src_path: str) -> list[tuple[str, int]]:
        if os.path.isfile(src_path):
            return [(src_path, os.path.getsize(src_path))]

        files = []
        for root, _, filenames in os.walk(src_path, followlinks=False):
            for filename in filenames:
                path = os.path.join(root, filename)
                if os.path.islink(path):
                    continue
                try:
                    files.append((path, os.path.getsize(path)))
                except (OSError, PermissionError):
                    continue
        return files

    def _copy_file_with_progress(self, src_path: str, dst_path: str) -> None:
        import shutil

        self._check_cancelled()
        os.makedirs(os.path.dirname(dst_path), exist_ok=True)
        size = os.path.getsize(src_path)
        copied = 0
        with open(src_path, "rb") as source, open(dst_path, "wb") as target:
            while True:
                self._check_cancelled()
                chunk = source.read(64 * 1024)
                if not chunk:
                    break
                target.write(chunk)
                copied += len(chunk)
                self._update_operation_progress(copied, size)

    def _copy_tree_with_progress(self, src_path: str, dst_path: str, merge: bool = False) -> None:
        import shutil

        files = self._files_with_sizes(src_path)
        total = sum(size for _, size in files)
        copied = 0
        for source_path, size in files:
            self._check_cancelled()
            relative = os.path.relpath(source_path, src_path)
            target_path = os.path.join(dst_path, relative)
            os.makedirs(os.path.dirname(target_path), exist_ok=True)
            with open(source_path, "rb") as src, open(target_path, "wb") as dst:
                while True:
                    self._check_cancelled()
                    chunk = src.read(64 * 1024)
                    if not chunk:
                        break
                    dst.write(chunk)
                    copied += len(chunk)
                    self._update_operation_progress(copied, total)
            if merge and os.path.exists(target_path):
                shutil.copystat(source_path, target_path)

    async def _set_operation_cancelled(self) -> dict:
        self._operation_cancel_requested = True
        return {"ok": True}

    async def operation_status(self) -> dict:
        return {
            "running": self._operation_running,
            "progress": self._operation_progress,
            "label": self._operation_label,
        }

    async def cancel_current_operation(self) -> dict:
        return await self._set_operation_cancelled()

    def _normalize_dir(self, path: str) -> str:
        if not path:
            if self._last_path and os.path.isdir(self._last_path):
                return self._last_path
            return self._settings.get("default_path", "/home/deck")
        return os.path.abspath(path)

    def _validate_exists_dir(self, path: str) -> None:
        if not os.path.exists(path):
            raise FileNotFoundError(f"Diretório não encontrado: {path}")
        if not os.path.isdir(path):
            raise NotADirectoryError(f"Não é um diretório: {path}")

    def _unique_target_path(self, target_path: str) -> str:
        """If target_path exists, append (1), (2), ... before extension."""
        if not os.path.exists(target_path):
            return target_path

        base_dir = os.path.dirname(target_path)
        filename = os.path.basename(target_path)
        name, ext = os.path.splitext(filename)

        i = 1
        while True:
            candidate = os.path.join(base_dir, f"{name} ({i}){ext}")
            if not os.path.exists(candidate):
                return candidate
            i += 1

    def _copy_or_cut_prepare(self, src_path: str, kind: str) -> None:
        if not src_path:
            raise ValueError("Caminho inválido")
        src_path = os.path.abspath(src_path)
        if not os.path.exists(src_path):
            raise FileNotFoundError(f"Item não existe: {src_path}")

        self._clipboard_path = src_path
        self._clipboard_kind = kind
        self._save_runtime_state()

    def _copy_path(self, src_path: str, dst_path: str) -> None:
        if os.path.isdir(src_path):
            import shutil

            shutil.copytree(src_path, dst_path, dirs_exist_ok=False)
        else:
            import shutil

            shutil.copy2(src_path, dst_path)

    def _move_path(self, src_path: str, dst_path: str) -> None:
        # Try a simple rename first (fast). If it fails due to cross-device (EXDEV), fall back
        # to a safe move using shutil.move which handles cross-filesystem moves.
        try:
            os.rename(src_path, dst_path)
        except OSError as e:
            import errno
            import shutil

            if getattr(e, 'errno', None) == errno.EXDEV:
                shutil.move(src_path, dst_path)
            else:
                raise

    def _remove_path(self, path: str) -> None:
        import shutil

        if os.path.isfile(path) or os.path.islink(path):
            os.remove(path)
        elif os.path.isdir(path):
            shutil.rmtree(path)
        else:
            os.remove(path)

    def _is_subpath(self, child_path: str, parent_path: str) -> bool:
        child_real = os.path.realpath(child_path)
        parent_real = os.path.realpath(parent_path)
        try:
            return os.path.commonpath([child_real, parent_real]) == parent_real
        except ValueError:
            return False

    def _is_self_or_subdirectory(self, target_dir: str, src_path: str) -> bool:
        return self._is_subpath(target_dir, src_path)

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
        """Calculate directory size without following symlinks or failing on restricted entries."""
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

    def _is_safe_target_for_path(self, target_dir: str, src_path: str) -> bool:
        target_dir = os.path.abspath(target_dir)
        if not target_dir or not os.path.isdir(target_dir):
            return False

        src_real = os.path.realpath(src_path)
        if os.path.isdir(src_real) and self._is_subpath(target_dir, src_real):
            return False

        return True

    def _safe_archive_member_path(self, target_dir: str, member_name: str) -> str:
        """Return a safe extraction path and reject path traversal entries."""
        if not member_name or os.path.isabs(member_name):
            raise ValueError("Arquivo compactado contém um caminho inválido")

        target_dir = os.path.realpath(target_dir)
        destination = os.path.realpath(os.path.join(target_dir, member_name))
        try:
            inside_target = os.path.commonpath([target_dir, destination]) == target_dir
        except ValueError:
            inside_target = False
        if not inside_target:
            raise ValueError("Arquivo compactado contém caminho fora do destino")
        return destination

    def _archive_total_size(self, archive_path: str) -> int:
        lower = archive_path.lower()
        if lower.endswith(".zip"):
            import zipfile

            with zipfile.ZipFile(archive_path, "r") as archive:
                return sum(member.file_size for member in archive.infolist() if not member.is_dir())

        if lower.endswith(".tar") or lower.endswith(".tar.gz") or lower.endswith(".tgz") or lower.endswith(".tar.bz2") or lower.endswith(".tar.xz") or lower.endswith(".tar.zst") or lower.endswith(".gz") or lower.endswith(".bz2") or lower.endswith(".xz"):
            import tarfile

            with tarfile.open(archive_path, "r:*") as archive:
                return sum(member.size for member in archive.getmembers() if member.isfile())

        return 0

    def _safe_extract_zip(self, archive_path: str, target_dir: str) -> None:
        import zipfile

        with zipfile.ZipFile(archive_path, "r") as archive:
            total = sum(member.file_size for member in archive.infolist() if not member.is_dir())
            extracted = 0
            for member in archive.infolist():
                self._check_cancelled()
                destination = self._safe_archive_member_path(target_dir, member.filename)
                if member.is_dir():
                    os.makedirs(destination, exist_ok=True)
                    continue

                os.makedirs(os.path.dirname(destination), exist_ok=True)
                with archive.open(member, "r") as source, open(destination, "wb") as target:
                    while True:
                        self._check_cancelled()
                        chunk = source.read(64 * 1024)
                        if not chunk:
                            break
                        target.write(chunk)
                        extracted += len(chunk)
                        self._update_operation_progress(extracted, total)

    def _safe_extract_tar(self, archive_path: str, target_dir: str) -> None:
        import tarfile

        with tarfile.open(archive_path, "r:*") as archive:
            members = archive.getmembers()
            total = sum(member.size for member in members if member.isfile())
            extracted = 0

            for member in members:
                self._safe_archive_member_path(target_dir, member.name)
                if member.issym() or member.islnk() or not (member.isdir() or member.isfile()):
                    raise ValueError("Arquivo tar contém link ou tipo de arquivo não suportado")

            for member in members:
                self._check_cancelled()
                destination = self._safe_archive_member_path(target_dir, member.name)
                if member.isdir():
                    os.makedirs(destination, exist_ok=True)
                    continue

                os.makedirs(os.path.dirname(destination), exist_ok=True)
                source = archive.extractfile(member)
                if source is None:
                    raise ValueError("Não foi possível ler um arquivo do tar")
                with source, open(destination, "wb") as target:
                    while True:
                        self._check_cancelled()
                        chunk = source.read(64 * 1024)
                        if not chunk:
                            break
                        target.write(chunk)
                        extracted += len(chunk)
                        self._update_operation_progress(extracted, total)

    async def list_dir(self, path: str) -> dict:
        path = self._normalize_dir(path)
        self._validate_exists_dir(path)
        self._last_path = path
        self._save_runtime_state()

        entries = []
        try:
            with os.scandir(path) as it:
                for entry in it:
                    try:
                        # Symlinked directories such as /bin must remain navigable.
                        is_dir = entry.is_dir(follow_symlinks=True)
                    except (PermissionError, FileNotFoundError, OSError):
                        continue

                    # Avoid a second metadata syscall for directories. Large system
                    # folders such as /bin can contain thousands of entries.
                    try:
                        stat = None if is_dir else entry.stat(follow_symlinks=False)
                    except (PermissionError, FileNotFoundError, OSError):
                        stat = None

                    entries.append({
                        "name": entry.name,
                        "path": entry.path,
                        "is_dir": is_dir,
                        "size": None if is_dir or stat is None else stat.st_size,
                        "modified": 0 if stat is None else int(stat.st_mtime),
                    })
        except PermissionError as e:
            raise PermissionError(f"Sem permissão para acessar: {path}") from e
        except OSError as e:
            raise OSError(f"Não foi possível acessar: {path} ({e.strerror or e})") from e

        entries.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))
        return {"path": path, "items": entries}

    async def copy_path(self, path: str) -> dict:
        self._copy_or_cut_prepare(path, "copy")
        return {"ok": True}

    async def cut_path(self, path: str) -> dict:
        self._copy_or_cut_prepare(path, "cut")
        return {"ok": True}

    async def has_clipboard(self) -> dict:
        return {"has": bool(self._clipboard_path)}

    async def get_clipboard_kind(self) -> dict:
        return {"kind": self._clipboard_kind}

    async def copy_or_cut_status(self) -> dict:
        return {
            "has": bool(self._clipboard_path),
            "kind": self._clipboard_kind,
            "path": self._clipboard_path,
        }

    async def get_clipboard_info(self) -> dict:
        return await self.copy_or_cut_status()

    async def check_paste_conflict(self, target_dir: str) -> dict:
        target_dir = self._normalize_dir(target_dir)
        self._validate_exists_dir(target_dir)

        if not self._clipboard_path or not self._clipboard_kind:
            raise ValueError("Área de transferência está vazia")

        src = self._clipboard_path
        kind = self._clipboard_kind
        name = os.path.basename(src)

        if kind == "cut" and self._is_self_or_subdirectory(target_dir, src):
            return {"blocked": True, "reason": "self-directory", "name": name}

        raw_dst = os.path.join(target_dir, name)
        if os.path.exists(raw_dst):
            return {
                "blocked": False,
                "needs_conflict": True,
                "path": raw_dst,
                "name": name,
                "is_dir": os.path.isdir(raw_dst),
            }

        return {"blocked": False, "needs_conflict": False, "path": raw_dst, "name": name}

    async def paste_path(self, target_dir: str) -> dict:
        return await self.paste_path_with_options(target_dir, "keep-both")

    async def paste_path_with_options(self, target_dir: str, conflict_strategy: str = "keep-both", apply_to_all: bool = False) -> dict:
        target_dir = self._normalize_dir(target_dir)
        self._validate_exists_dir(target_dir)

        if not self._clipboard_path or not self._clipboard_kind:
            raise ValueError("Área de transferência está vazia")

        src = self._clipboard_path
        kind = self._clipboard_kind
        name = os.path.basename(src)
        if not self._is_safe_target_for_path(target_dir, src):
            raise ValueError("Destino inválido")

        if kind == "cut" and self._is_self_or_subdirectory(target_dir, src):
            raise ValueError("Não é possível colar dentro do diretório.")

        raw_dst = os.path.join(target_dir, name)

        if os.path.exists(raw_dst):
            if conflict_strategy == "ignore":
                return {"ok": True, "skipped": True}
            if conflict_strategy == "cancel":
                return {"ok": True, "cancelled": True}
            if conflict_strategy == "replace" and os.path.realpath(raw_dst) == os.path.realpath(src):
                # Source and destination are the same item. Replace is a no-op.
                self._clipboard_path = None
                self._clipboard_kind = None
                self._save_runtime_state()
                return {"ok": True, "conflict_strategy": conflict_strategy}
            if conflict_strategy == "replace":
                self._remove_path(raw_dst)
                dst = raw_dst
            elif conflict_strategy == "keep-both":
                dst = self._unique_target_path(raw_dst)
            elif conflict_strategy == "merge":
                dst = raw_dst
            else:
                raise ValueError("Estratégia de conflito inválida")
        else:
            dst = raw_dst

        self._set_operation_state("Pasting")
        try:
            if conflict_strategy == "merge" and os.path.isdir(src) and os.path.isdir(dst):
                if kind == "copy":
                    self._copy_tree_with_progress(src, dst, merge=True)
                elif kind == "cut":
                    self._copy_tree_with_progress(src, dst, merge=True)
                    import shutil

                    shutil.rmtree(src)
                else:
                    raise ValueError("Clipboard inválida")
            elif kind == "copy":
                if os.path.isdir(src):
                    self._copy_tree_with_progress(src, dst)
                else:
                    self._copy_file_with_progress(src, dst)
            elif kind == "cut":
                try:
                    self._move_path(src, dst)
                    self._update_operation_progress(100, 100)
                except OSError as e:
                    import errno
                    if getattr(e, "errno", None) == errno.EXDEV:
                        if os.path.isdir(src):
                            self._copy_tree_with_progress(src, dst)
                            import shutil

                            shutil.rmtree(src)
                        else:
                            self._copy_file_with_progress(src, dst)
                            os.remove(src)
                    else:
                        raise
            else:
                raise ValueError("Clipboard inválida")
        except asyncio.CancelledError:
            raise
        except PermissionError as e:
            raise PermissionError(f"Sem permissão: {e}") from e
        finally:
            self._clear_operation_state()

        # after paste: clear clipboard
        self._clipboard_path = None
        self._clipboard_kind = None
        self._save_runtime_state()
        return {"ok": True, "conflict_strategy": conflict_strategy}

    async def create_folder(self, parent_dir: str, name: str) -> dict:
        parent_dir = self._normalize_dir(parent_dir)
        self._validate_exists_dir(parent_dir)

        if not name or "/" in name or "\\" in name:
            raise ValueError("Nome inválido")

        new_path = os.path.join(parent_dir, name)
        if os.path.exists(new_path):
            raise FileExistsError(f"Já existe um item com esse nome: {new_path}")

        try:
            os.mkdir(new_path)
        except PermissionError as e:
            raise PermissionError(f"Sem permissão: {e}") from e

        return {"success": True, "path": new_path}

    async def rename_path(self, path: str, new_name: str) -> dict:
        # Wrapper legacy: mantém compatibilidade com a chamada existente
        return await self.rename_item(path, new_name)

    async def rename_item(self, old_path: str, new_name: str) -> dict:
        if not old_path:
            raise ValueError("Caminho inválido")
        if not new_name:
            raise ValueError("Novo nome inválido")
        if "/" in new_name or "\\" in new_name:
            raise ValueError("Nome inválido")
        if not os.path.exists(old_path):
            raise FileNotFoundError(f"Item não existe: {old_path}")

        directory = os.path.dirname(old_path)
        new_path = os.path.join(directory, new_name)

        if os.path.exists(new_path):
            raise FileExistsError(f"Já existe um item com esse nome: {new_path}")

        # renomeia
        os.rename(old_path, new_path)

        return {"success": True, "new_path": new_path}


    async def delete_path(self, path: str) -> dict:
        # Wrapper legacy: mantém compatibilidade
        return await self.delete_item(path)

    async def delete_item(self, path: str) -> dict:
        if not path:
            raise ValueError("Caminho inválido")
        path = os.path.abspath(path)
        if not os.path.exists(path):
            return {"success": False, "error": "Arquivo ou pasta não encontrado"}

        import shutil

        try:
            if os.path.isfile(path) or os.path.islink(path):
                os.remove(path)
            elif os.path.isdir(path):
                shutil.rmtree(path)
            else:
                # special file types
                os.remove(path)
        except PermissionError as e:
            return {"success": False, "error": f"Sem permissão: {e}"}

        # if clipboard points to it, clear
        if self._clipboard_path and (self._clipboard_path == path or self._is_subpath(self._clipboard_path, path)):
            self._clipboard_path = None
            self._clipboard_kind = None
            self._save_runtime_state()

        return {"success": True}

    async def extract_archive(self, archive_path: str, target_dir: str) -> dict:
        if not archive_path:
            raise ValueError("Caminho inválido")
        if not target_dir:
            raise ValueError("Destino inválido")

        archive_path = os.path.abspath(archive_path)
        target_dir = self._normalize_dir(target_dir)
        self._validate_exists_dir(target_dir)

        if not os.path.exists(archive_path) or not os.path.isfile(archive_path):
            raise FileNotFoundError(f"Arquivo não encontrado: {archive_path}")

        archive_name = os.path.basename(archive_path)
        target_path = os.path.join(target_dir, os.path.splitext(archive_name)[0])
        if os.path.exists(target_path):
            target_path = self._unique_target_path(target_path)

        self._set_operation_state("Extracting")
        try:
            import shutil
            import tarfile

            lower = archive_path.lower()
            if lower.endswith(".zip"):
                self._safe_extract_zip(archive_path, target_path)
            elif lower.endswith(".tar") or lower.endswith(".tar.gz") or lower.endswith(".tgz") or lower.endswith(".tar.bz2") or lower.endswith(".tar.xz") or lower.endswith(".tar.zst"):
                self._safe_extract_tar(archive_path, target_path)
            elif lower.endswith(".gz") and not lower.endswith(".tar.gz") and not lower.endswith(".tgz"):
                self._safe_extract_tar(archive_path, target_path)
            elif lower.endswith(".bz2") and not lower.endswith(".tar.bz2"):
                self._safe_extract_tar(archive_path, target_path)
            elif lower.endswith(".xz") and not lower.endswith(".tar.xz"):
                self._safe_extract_tar(archive_path, target_path)
            elif lower.endswith(".zst") and not lower.endswith(".tar.zst"):
                shutil.unpack_archive(archive_path, target_path)
            else:
                raise ValueError("Formato de arquivo compactado não suportado")
        except PermissionError as e:
            raise PermissionError(f"Sem permissão: {e}") from e
        except (tarfile.TarError, OSError) as e:
            raise ValueError(f"Falha ao extrair o arquivo: {e}") from e
        finally:
            self._clear_operation_state()

        return {"success": True, "new_path": target_path}

    async def get_properties(self, path: str) -> dict:
        if not path:
            raise ValueError("Caminho inválido")
        path = os.path.abspath(path)
        if not os.path.exists(path):
            raise FileNotFoundError(f"Item não existe: {path}")
        return await self.get_properties_item(path)

    async def get_properties_item(self, path: str) -> dict:
        import datetime

        # Para evitar problemas com links simbólicos, usa follow_symlinks=False
        stat = os.stat(path, follow_symlinks=False)
        is_dir = os.path.isdir(path)


        created = datetime.datetime.fromtimestamp(stat.st_ctime).isoformat()
        modified = datetime.datetime.fromtimestamp(stat.st_mtime).isoformat()

        size = None if is_dir else stat.st_size

        return {
            "name": os.path.basename(path),
            "path": path,
            "size": size,
            "type": "folder" if is_dir else "file",
            "created": created,
            "modified": modified,
            "permissions": oct(stat.st_mode),
        }

    async def get_directory_size(self, path: str) -> dict:
        """Calculate directory size asynchronously and return it."""
        if not path:
            raise ValueError("Caminho inválido")
        path = os.path.abspath(path)
        if not os.path.exists(path):
            raise FileNotFoundError(f"Item não existe: {path}")
        if not os.path.isdir(path):
            return {"size": None, "path": path}

        size = await asyncio.to_thread(self._get_directory_size, path)
        return {"size": size, "path": path}



    async def long_running(self):
        await asyncio.sleep(15)
        # Keep existing example logic as a background task if needed.
        pass

    # Asyncio-compatible long-running code, executed in a task when the plugin is loaded
    async def _main(self):
        self.loop = asyncio.get_event_loop()

    # Function called first during the unload process, utilize this to handle your plugin being stopped, but not
    # completely removed
    async def _unload(self):
        pass

    # Function called after `_unload` during uninstall, utilize this to clean up processes and other remnants of your
    # plugin that may remain on the system
    async def _uninstall(self):
        pass

    async def start_timer(self):
        self.loop.create_task(self.long_running())

    # Migrations that should be performed before entering `_main()`.
    async def _migration(self):
        decky.logger.info("Migrating")
        # Here's a migration example for logs:
        # - `~/.config/decky-template/template.log` will be migrated to `decky.decky_LOG_DIR/template.log`
        decky.migrate_logs(os.path.join(decky.DECKY_USER_HOME,
                               ".config", "decky-file-manager", "plugin.log"))
        # Here's a migration example for settings:
        # - `~/homebrew/settings/template.json` is migrated to `decky.decky_SETTINGS_DIR/template.json`
        # - `~/.config/decky-template/` all files and directories under this root are migrated to `decky.decky_SETTINGS_DIR/`
        decky.migrate_settings(
            os.path.join(decky.DECKY_HOME, "settings", "decky-file-manager.json"),
            os.path.join(decky.DECKY_USER_HOME, ".config", "decky-file-manager"))
        # Here's a migration example for runtime data:
        # - `~/homebrew/template/` all files and directories under this root are migrated to `decky.decky_RUNTIME_DIR/`
        # - `~/.local/share/decky-template/` all files and directories under this root are migrated to `decky.decky_RUNTIME_DIR/`
        decky.migrate_runtime(
            os.path.join(decky.DECKY_HOME, "decky-file-manager"),
            os.path.join(decky.DECKY_USER_HOME, ".local", "share", "decky-file-manager"))
