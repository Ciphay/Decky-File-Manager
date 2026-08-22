import os
import shutil
import subprocess
import tarfile
import zipfile
from pathlib import Path

from .operations_progress import OperationsProgress


class FileManagement(OperationsProgress):

    def _copy_file_with_progress(self, src_path: str, dst_path: str, progress_start: float = 0.0, progress_end: float = 100.0, operation_id: str | None = None) -> None:
        total = os.path.getsize(src_path) if os.path.exists(src_path) else 0
        copied = 0
        file_name = os.path.basename(src_path) or src_path
        self._set_operation_progress_detail(file_name, operation_id)
        os.makedirs(os.path.dirname(dst_path), exist_ok=True)
        with open(src_path, "rb") as source, open(dst_path, "wb") as target:
            while True:
                self._check_operation_cancelled(operation_id)
                chunk = source.read(1024 * 1024)
                if not chunk:
                    break
                target.write(chunk)
                copied += len(chunk)
                if copied == len(chunk):
                    self._mark_first_item_processed(operation_id)
                if total > 0:
                    file_progress = copied / total
                    overall_progress = progress_start + file_progress * (progress_end - progress_start)
                    self._set_operation_progress(overall_progress, operation_id)
                self._check_operation_cancelled(operation_id)

        if total == 0:
            self._set_operation_progress(progress_end, operation_id)

        shutil.copystat(src_path, dst_path)

    def _copy_stream_with_progress(self, source, target, total_size: int, progress_start: float = 0.0, progress_end: float = 100.0, operation_id: str | None = None) -> None:
        copied = 0
        chunk_size = 1024 * 1024
        while True:
            self._wait_if_paused(operation_id)
            self._check_operation_cancelled(operation_id)
            chunk = source.read(chunk_size)
            if not chunk:
                break
            target.write(chunk)
            copied += len(chunk)
            if copied == len(chunk):
                self._mark_first_item_processed(operation_id)
            if total_size > 0:
                file_progress = copied / total_size
                overall_progress = progress_start + file_progress * (progress_end - progress_start)
                self._set_operation_progress(overall_progress, operation_id)
            self._wait_if_paused(operation_id)
            self._check_operation_cancelled(operation_id)

        if total_size == 0:
            self._set_operation_progress(progress_end, operation_id)

    def _copy_tree_with_progress(self, src_path: str, dst_path: str, conflict_strategy: str = "keep-both", apply_to_all: bool = False, operation_id: str | None = None) -> None:
        unused_apply_to_all = apply_to_all
        root_name = os.path.basename(src_path.rstrip("/\\")) or src_path
        self._set_operation_progress_detail(root_name, operation_id)

        total_bytes = 0
        for root, _, files in os.walk(src_path):
            for filename in files:
                try:
                    total_bytes += os.path.getsize(os.path.join(root, filename))
                except (OSError, FileNotFoundError):
                    pass

        if total_bytes == 0:
            os.makedirs(dst_path, exist_ok=True)
            self._set_operation_progress_detail(root_name, operation_id)
            self._set_operation_progress(100.0, operation_id)
            return

        processed_bytes = 0
        for root, dirs, files in os.walk(src_path):
            rel_root = os.path.relpath(root, src_path)
            current_dst = dst_path if rel_root == "." else os.path.join(dst_path, rel_root)
            os.makedirs(current_dst, exist_ok=True)
            for d in dirs:
                os.makedirs(os.path.join(current_dst, d), exist_ok=True)
            for filename in files:
                self._check_operation_cancelled(operation_id)
                src_file = os.path.join(root, filename)
                dst_file = os.path.join(current_dst, filename)
                resolved_dst_file = dst_file

                if os.path.exists(dst_file):
                    if conflict_strategy == "ignore":
                        continue
                    if conflict_strategy == "cancel":
                        raise RuntimeError("Operação cancelada pelo usuário")
                    if conflict_strategy == "replace":
                        self._remove_path(dst_file)
                    elif conflict_strategy == "keep-both":
                        resolved_dst_file = self._unique_target_path(dst_file)
                    elif conflict_strategy == "merge":
                        resolved_dst_file = dst_file
                    else:
                        raise ValueError("Estratégia de conflito inválida")

                try:
                    file_size = os.path.getsize(src_file)
                except (OSError, FileNotFoundError):
                    file_size = 0

                progress_start = (processed_bytes / total_bytes * 100.0) if total_bytes > 0 else 0.0
                progress_end = ((processed_bytes + file_size) / total_bytes * 100.0) if total_bytes > 0 else 100.0
                self._set_operation_progress_detail(filename, operation_id)

                if processed_bytes == 0:
                    self._mark_first_item_processed(operation_id)

                self._copy_file_with_progress(src_file, resolved_dst_file, progress_start, progress_end, operation_id)
                processed_bytes += file_size
                self._set_operation_progress(min(100.0, progress_end), operation_id)

        self._set_operation_progress_detail(root_name, operation_id)

    def _move_path_with_progress(self, src_path: str, dst_path: str, operation_id: str | None = None) -> None:
        try:
            os.rename(src_path, dst_path)
            self._set_operation_progress(100.0, operation_id)
        except OSError as e:
            import errno
            if getattr(e, "errno", None) != errno.EXDEV:
                raise

            self._set_operation_progress_detail(os.path.basename(src_path) or src_path, operation_id)
            if os.path.isdir(src_path):
                self._copy_tree_with_progress(src_path, dst_path, operation_id=operation_id)
            else:
                self._copy_file_with_progress(src_path, dst_path, operation_id=operation_id)

            if not os.path.exists(dst_path):
                raise RuntimeError("A cópia de destino não foi concluída corretamente")

            destination_ok = os.path.isdir(dst_path) if os.path.isdir(src_path) else os.path.isfile(dst_path)
            if not destination_ok:
                raise RuntimeError("O destino movido não está consistente")

            self._remove_path(src_path)
            self._set_operation_progress(100.0, operation_id)

    def _unique_target_path(self, target_path: str) -> str:
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

    def _remove_path(self, path: str) -> None:
        if os.path.isfile(path) or os.path.islink(path):
            os.remove(path)
        elif os.path.isdir(path):
            shutil.rmtree(path)
        else:
            os.remove(path)

    def _delete_path_with_progress(self, path: str) -> None:
        self._set_operation_progress_detail(os.path.basename(path) or path)
        self._check_operation_cancelled()
        os.remove(path)
        self._set_operation_progress(100.0)

    def _delete_tree_with_progress(self, path: str) -> None:
        total_entries = 0
        for root, dirs, files in os.walk(path):
            total_entries += len(dirs) + len(files)

        processed_entries = 0
        for root, dirs, files in os.walk(path, topdown=False):
            for filename in files:
                self._check_operation_cancelled()
                file_path = os.path.join(root, filename)
                self._set_operation_progress_detail(filename)
                os.remove(file_path)
                processed_entries += 1
                if total_entries > 0:
                    self._set_operation_progress((processed_entries / total_entries) * 100.0)

            for dirname in dirs:
                self._check_operation_cancelled()
                dir_path = os.path.join(root, dirname)
                self._set_operation_progress_detail(dirname)
                os.rmdir(dir_path)
                processed_entries += 1
                if total_entries > 0:
                    self._set_operation_progress((processed_entries / total_entries) * 100.0)

        self._check_operation_cancelled()
        self._set_operation_progress_detail(os.path.basename(path) or path)
        os.rmdir(path)
        processed_entries += 1
        if total_entries > 0:
            self._set_operation_progress((processed_entries / total_entries) * 100.0)
        else:
            self._set_operation_progress(100.0)

    def _is_subpath(self, child_path: str, parent_path: str) -> bool:
        child_real = os.path.realpath(child_path)
        parent_real = os.path.realpath(parent_path)
        try:
            return os.path.commonpath([child_real, parent_real]) == parent_real
        except ValueError:
            return False

    def _is_self_or_subdirectory(self, target_dir: str, src_path: str) -> bool:
        return self._is_subpath(target_dir, src_path)

    def _is_safe_target_for_path(self, target_dir: str, src_path: str) -> bool:
        target_dir = os.path.abspath(target_dir)
        if not target_dir or not os.path.isdir(target_dir):
            return False

        src_real = os.path.realpath(src_path)
        if os.path.isdir(src_real) and self._is_subpath(target_dir, src_real):
            return False

        return True

    def _normalize_dir(self, path: str) -> str:
        normalized = os.path.expanduser(path or "").strip()
        if not normalized:
            return self._settings.get("default_path", os.path.expanduser("~"))
        return os.path.abspath(normalized)

    def _validate_exists_dir(self, path: str) -> None:
        if not os.path.exists(path):
            raise FileNotFoundError(f"Diretório não encontrado: {path}")
        if not os.path.isdir(path):
            raise NotADirectoryError(f"Não é um diretório: {path}")

    def _safe_archive_member_path(self, target_dir: str, member_name: str) -> str:
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

    def _archive_base_name(self, archive_name: str) -> str:
        archive_name_lower = archive_name.lower()
        for ext in [".tar.gz", ".tar.bz2", ".tar.xz", ".tar.zst", ".tgz", ".tar", ".gz", ".bz2", ".xz", ".zst", ".zip", ".rar"]:
            if archive_name_lower.endswith(ext):
                return archive_name[: -len(ext)]
        return os.path.splitext(archive_name)[0]

    def _archive_contains_single_root_folder(self, archive_path: str) -> str | None:
        lower = archive_path.lower()
        root_names = set()
        has_subpath = False

        def candidates_from_paths(paths):
            nonlocal has_subpath
            for name in paths:
                if not name:
                    continue
                normalized = name.replace("\\", "/").lstrip("/")
                parts = [part for part in normalized.split("/") if part]
                if not parts:
                    continue
                root_names.add(parts[0])
                if len(parts) > 1:
                    has_subpath = True

        if lower.endswith(".zip"):
            with zipfile.ZipFile(archive_path, "r") as archive:
                candidates_from_paths([member.filename for member in archive.infolist()])
        elif lower.endswith(".rar"):
            unrar = shutil.which("unrar")
            seven_zip = shutil.which("7z") or shutil.which("7za") or shutil.which("7zr")
            list_command = None
            if unrar:
                list_command = [unrar, "lb", archive_path]
            elif seven_zip:
                list_command = [seven_zip, "l", "-ba", archive_path]

            if list_command:
                try:
                    result = subprocess.run(list_command, capture_output=True, text=True, check=False)
                    candidates_from_paths(result.stdout.splitlines())
                except (FileNotFoundError, OSError):
                    pass
        elif lower.endswith(".tar") or lower.endswith(".tar.gz") or lower.endswith(".tgz") or lower.endswith(".tar.bz2") or lower.endswith(".tar.xz") or lower.endswith(".tar.zst") or lower.endswith(".gz") or lower.endswith(".bz2") or lower.endswith(".xz") or lower.endswith(".zst"):
            try:
                with tarfile.open(archive_path, "r:*") as archive:
                    candidates_from_paths([member.name for member in archive.getmembers()])
            except tarfile.TarError:
                pass

        if len(root_names) == 1 and has_subpath:
            return next(iter(root_names))
        return None

    def _flatten_single_root_folder(self, target_dir: str, root_name: str) -> None:
        root_path = os.path.join(target_dir, root_name)
        if not os.path.isdir(root_path):
            return

        contents = [entry for entry in os.listdir(target_dir) if entry != root_name]
        if contents:
            return

        for entry in os.listdir(root_path):
            src = os.path.join(root_path, entry)
            dst = os.path.join(target_dir, entry)
            os.replace(src, dst)

        os.rmdir(root_path)

    def _extract_rar_with_progress(self, archive_path: str, target_dir: str, operation_id: str | None = None) -> None:
        parent_dir = os.path.dirname(target_dir) or target_dir
        self._validate_exists_dir(parent_dir)
        os.makedirs(target_dir, exist_ok=True)

        unrar = shutil.which("unrar")
        seven_zip = shutil.which("7z") or shutil.which("7za") or shutil.which("7zr")
        list_command = None
        extract_command = None

        if unrar:
            list_command = [unrar, "l", "-v", archive_path]
            extract_command = [unrar, "x", "-o+", archive_path, target_dir]
        elif seven_zip:
            list_command = [seven_zip, "l", archive_path]
            extract_command = [seven_zip, "x", "-y", f"-o{target_dir}", archive_path]

        if not extract_command:
            raise ValueError("Não foi possível extrair .rar porque nenhum utilitário compatível está disponível. Instale 'unrar' ou 'p7zip-full' e tente novamente.")

        total_files = 0
        if list_command:
            try:
                result = subprocess.run(list_command, capture_output=True, text=True, check=False)
                for line in result.stdout.splitlines():
                    line = line.strip()
                    if line and not line.startswith("-") and any(c.isdigit() for c in line):
                        total_files += 1
            except (FileNotFoundError, OSError):
                total_files = 0

        self._set_operation_progress_detail("inicializando...", operation_id)
        process = None
        try:
            process = subprocess.Popen(
                extract_command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1
            )
            self._set_operation_state_active_process(process)

            extracted_count = 0
            if process.stdout is not None:
                for line in process.stdout:
                    self._wait_if_paused(operation_id)
                    self._check_operation_cancelled(operation_id)
                    line = line.strip()
                    if line:
                        lower_line = line.lower()
                        if lower_line not in ("all ok", "ok") and not line.startswith("-") and not line.startswith("Archive:"):
                            self._mark_first_item_processed(operation_id)
                            self._set_operation_progress_detail(line[:50], operation_id)
                            extracted_count += 1
                            if total_files > 0:
                                progress = (extracted_count / total_files) * 100.0
                                self._set_operation_progress(min(progress, 99.0), operation_id)

            process.wait()
            with self._operation_progress_lock:
                if self._active_operation_process is process:
                    self._active_operation_process = None
            if process.returncode != 0:
                stderr = process.stderr.read() if process.stderr else ""
                raise RuntimeError(f"Falha ao extrair .rar: {stderr}")

            self._set_operation_progress(100.0, operation_id)
        except RuntimeError:
            if process is not None and process.poll() is None:
                try:
                    process.terminate()
                    process.wait(timeout=5)
                except (OSError, subprocess.TimeoutExpired):
                    try:
                        process.kill()
                        process.wait(timeout=5)
                    except (OSError, subprocess.TimeoutExpired):
                        pass
            with self._operation_progress_lock:
                if self._active_operation_process is process:
                    self._active_operation_process = None
            raise
        except Exception as e:
            if process is not None and process.poll() is None:
                try:
                    process.terminate()
                    process.wait(timeout=5)
                except (OSError, subprocess.TimeoutExpired):
                    try:
                        process.kill()
                        process.wait(timeout=5)
                    except (OSError, subprocess.TimeoutExpired):
                        pass
            with self._operation_progress_lock:
                if self._active_operation_process is process:
                    self._active_operation_process = None
            raise ValueError(f"Falha ao extrair .rar: {str(e)}") from e

    def _extract_zip_with_progress(self, archive_path: str, target_dir: str, operation_id: str | None = None) -> None:
        os.makedirs(target_dir, exist_ok=True)

        with zipfile.ZipFile(archive_path, "r") as archive:
            members = archive.infolist()
            file_members = [member for member in members if not member.is_dir()]
            total_bytes = sum(member.file_size for member in file_members)
            total_files = len(file_members)
            processed_files = 0
            processed_bytes = 0

            for member in members:
                self._wait_if_paused(operation_id)
                self._check_operation_cancelled(operation_id)
                if member.is_dir():
                    destination = self._safe_archive_member_path(target_dir, member.filename)
                    os.makedirs(destination, exist_ok=True)
                else:
                    self._set_operation_progress_detail(member.filename, operation_id)
                    
                    if processed_bytes == 0:
                        self._mark_first_item_processed(operation_id)
                    
                    destination = self._safe_archive_member_path(target_dir, member.filename)
                    os.makedirs(os.path.dirname(destination), exist_ok=True)
                    
                    if total_bytes > 0:
                        progress_start = (processed_bytes / total_bytes) * 100.0
                        progress_end = ((processed_bytes + member.file_size) / total_bytes) * 100.0
                    else:
                        progress_start = (processed_files / total_files) * 100.0 if total_files > 0 else 0.0
                        progress_end = ((processed_files + 1) / total_files) * 100.0 if total_files > 0 else 100.0
                    
                    with archive.open(member, "r") as source, open(destination, "wb") as target:
                        self._copy_stream_with_progress(source, target, member.file_size, progress_start, progress_end, operation_id)
                    
                    processed_bytes += member.file_size
                    processed_files += 1
                    
                    if total_bytes > 0:
                        self._set_operation_progress((processed_bytes / total_bytes) * 100.0, operation_id)
                    elif total_files > 0:
                        self._set_operation_progress((processed_files / total_files) * 100.0, operation_id)

    def _extract_tar_with_progress(self, archive_path: str, target_dir: str, operation_id: str | None = None) -> None:
        os.makedirs(target_dir, exist_ok=True)

        with tarfile.open(archive_path, "r:*") as archive:
            members = [member for member in archive.getmembers() if member.isdir() or member.isfile()]
            file_members = [member for member in members if member.isfile()]
            total_bytes = sum(int(member.size) for member in file_members)
            total_files = len(file_members)
            processed_files = 0
            processed_bytes = 0

            for member in members:
                self._wait_if_paused(operation_id)
                self._check_operation_cancelled(operation_id)
                if member.isdir():
                    destination = self._safe_archive_member_path(target_dir, member.name)
                    os.makedirs(destination, exist_ok=True)
                else:
                    self._set_operation_progress_detail(member.name, operation_id)
                    
                    if processed_bytes == 0:
                        self._mark_first_item_processed(operation_id)
                    
                    destination = self._safe_archive_member_path(target_dir, member.name)
                    os.makedirs(os.path.dirname(destination), exist_ok=True)
                    
                    source = archive.extractfile(member)
                    if source is None:
                        raise ValueError("Não foi possível ler um arquivo do tar")
                    
                    if total_bytes > 0:
                        progress_start = (processed_bytes / total_bytes) * 100.0
                        progress_end = ((processed_bytes + int(member.size)) / total_bytes) * 100.0
                    else:
                        progress_start = (processed_files / total_files) * 100.0 if total_files > 0 else 0.0
                        progress_end = ((processed_files + 1) / total_files) * 100.0 if total_files > 0 else 100.0
                    
                    with source, open(destination, "wb") as target:
                        self._copy_stream_with_progress(source, target, int(member.size), progress_start, progress_end, operation_id)
                    
                    processed_bytes += int(member.size)
                    processed_files += 1
                    
                    if total_bytes > 0:
                        self._set_operation_progress((processed_bytes / total_bytes) * 100.0, operation_id)
                    elif total_files > 0:
                        self._set_operation_progress((processed_files / total_files) * 100.0, operation_id)

    def _run_extraction_with_progress(self, archive_path: str, target_dir: str, operation_id: str | None = None) -> None:
        self._set_operation_progress_detail(os.path.basename(archive_path) or archive_path, operation_id)

        lower = archive_path.lower()
        if lower.endswith(".zip"):
            self._extract_zip_with_progress(archive_path, target_dir, operation_id)
        elif lower.endswith(".tar") or lower.endswith(".tar.gz") or lower.endswith(".tgz") or lower.endswith(".tar.bz2") or lower.endswith(".tar.xz") or lower.endswith(".tar.zst"):
            self._extract_tar_with_progress(archive_path, target_dir, operation_id)
        elif lower.endswith(".gz") and not lower.endswith(".tar.gz") and not lower.endswith(".tgz"):
            self._extract_tar_with_progress(archive_path, target_dir, operation_id)
        elif lower.endswith(".bz2") and not lower.endswith(".tar.bz2"):
            self._extract_tar_with_progress(archive_path, target_dir, operation_id)
        elif lower.endswith(".xz") and not lower.endswith(".tar.xz"):
            self._extract_tar_with_progress(archive_path, target_dir, operation_id)
        elif lower.endswith(".zst") and not lower.endswith(".tar.zst"):
            try:
                self._extract_tar_with_progress(archive_path, target_dir, operation_id)
            except Exception:
                os.makedirs(target_dir, exist_ok=True)
                shutil.unpack_archive(archive_path, target_dir)
                self._set_operation_progress(100.0, operation_id)
        elif lower.endswith(".rar"):
            self._extract_rar_with_progress(archive_path, target_dir, operation_id)
        else:
            raise ValueError("Formato de arquivo compactado não suportado")

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
                        is_dir = entry.is_dir(follow_symlinks=True)
                    except (PermissionError, FileNotFoundError, OSError):
                        continue

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

    async def create_folder(self, parent_dir: str, name: str, operation_id: str | None = None) -> dict:
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

    async def rename_item(self, old_path: str, new_name: str, operation_id: str | None = None) -> dict:
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

        os.rename(old_path, new_path)

        return {"success": True, "new_path": new_path}

    async def rename_path(self, path: str, new_name: str) -> dict:
        return await self.rename_item(path, new_name)

    async def delete_item(self, path: str, progress_label: str = "Deleting", operation_id: str | None = None) -> dict:
        import asyncio
        
        if not path:
            raise ValueError("Caminho inválido")
        path = os.path.abspath(path)
        if not os.path.exists(path):
            return {"success": False, "error": "Arquivo ou pasta não encontrado"}

        try:
            if os.path.isfile(path) or os.path.islink(path):
                await self._run_with_progress(progress_label, lambda: self._delete_path_with_progress(path), operation_id)
            elif os.path.isdir(path):
                await self._run_with_progress(progress_label, lambda: self._delete_tree_with_progress(path), operation_id)
            else:
                await self._run_with_progress(progress_label, lambda: self._delete_path_with_progress(path), operation_id)
        except PermissionError as e:
            return {"success": False, "error": f"Sem permissão: {e}"}
        except RuntimeError as e:
            return {"success": False, "error": str(e)}

        if self._clipboard_path and (self._clipboard_path == path or self._is_subpath(self._clipboard_path, path)):
            self._clipboard_path = None
            self._clipboard_kind = None
            self._save_runtime_state()

        return {"success": True}

    async def delete_path(self, path: str) -> dict:
        return await self.delete_item(path)

    async def extract_archive(self, archive_path: str, target_dir: str, progress_label: str = "Extracting", operation_id: str | None = None) -> dict:
        import asyncio
        
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
        archive_base = self._archive_base_name(archive_name)
        archive_dir = os.path.join(target_dir, archive_base)
        should_flatten = self._archive_contains_single_root_folder(archive_path) == archive_base
        is_rar = archive_path.lower().endswith(".rar")

        if should_flatten and is_rar:
            extract_target = target_dir
        elif should_flatten:
            extract_target = self._unique_target_path(archive_dir) if os.path.exists(archive_dir) else target_dir
        else:
            extract_target = self._unique_target_path(archive_dir) if os.path.exists(archive_dir) else archive_dir

        try:
            await self._run_with_progress(progress_label, lambda: self._run_extraction_with_progress(archive_path, extract_target, operation_id), operation_id, target_dir)
        except PermissionError as e:
            raise PermissionError(f"Sem permissão: {e}") from e
        except (tarfile.TarError, OSError, RuntimeError) as e:
            raise ValueError(f"Falha ao extrair o arquivo: {e}") from e

        if should_flatten and not is_rar:
            if extract_target != target_dir:
                self._flatten_single_root_folder(extract_target, archive_base)
                return {"success": True, "new_path": extract_target}
            return {"success": True, "new_path": archive_dir}

        if should_flatten and is_rar:
            return {"success": True, "new_path": archive_dir}

        return {"success": True, "new_path": extract_target}
