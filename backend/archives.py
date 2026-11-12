import bz2
import gzip
import lzma
import os
import shutil
import stat as statmod
import subprocess
import tarfile
import time
import zipfile

from .file_ops import CHUNK_SIZE, FileOps
from .operations_progress import terminate_process

TAR_SUFFIXES = (".tar.gz", ".tar.bz2", ".tar.xz", ".tar.zst", ".tgz", ".tbz2", ".txz", ".tar")
SINGLE_FILE_SUFFIXES = (".gz", ".bz2", ".xz", ".zst")
SEVEN_ZIP_COMMANDS = ("7z", "7zz", "7za", "7zr")
SINGLE_FILE_SUFFIX_KINDS = ("gz", "bz2", "xz", "zst")
ALL_SUFFIXES = TAR_SUFFIXES + SINGLE_FILE_SUFFIXES + (".zip", ".rar", ".7z", ".iso")


class Archives(FileOps):

    def _archive_kind(self, archive_path: str) -> str | None:
        lower = archive_path.lower()
        if lower.endswith(".tar.zst"):
            return "tar.zst"
        if lower.endswith(TAR_SUFFIXES):
            return "tar"
        if lower.endswith(".zip"):
            return "zip"
        if lower.endswith(".rar"):
            return "rar"
        if lower.endswith(".7z"):
            return "7z"
        if lower.endswith(".iso"):
            return "iso"
        for suffix in SINGLE_FILE_SUFFIXES:
            if lower.endswith(suffix):
                return suffix[1:]
        return None

    def _archive_base_name(self, archive_name: str) -> str:
        lower = archive_name.lower()
        for ext in sorted(ALL_SUFFIXES, key=len, reverse=True):
            if lower.endswith(ext):
                return archive_name[: -len(ext)] or archive_name
        return os.path.splitext(archive_name)[0] or archive_name

    def _seven_zip(self) -> str | None:
        for name in SEVEN_ZIP_COMMANDS:
            found = shutil.which(name)
            if found:
                return found
        return None

    def _list_external_archive(self, archive_path: str, kind: str) -> list[str] | None:
        unrar = shutil.which("unrar")
        seven_zip = self._seven_zip()
        if kind == "rar" and unrar:
            command = [unrar, "lb", archive_path]
        elif seven_zip and kind in ("rar", "7z", "iso"):
            command = [seven_zip, "l", "-ba", "-slt", archive_path]
        elif kind == "tar.zst" and shutil.which("tar"):
            command = ["tar", "--zstd", "-tf", archive_path]
        else:
            return None
        try:
            result = subprocess.run(command, capture_output=True, text=True, check=False)
        except OSError:
            return None
        if result.returncode != 0:
            return None
        lines = result.stdout.splitlines()
        if command[0] == seven_zip:
            return [line[7:] for line in lines if line.startswith("Path = ")][1:]
        return [line for line in lines if line.strip()]

    def _list_archive_names(self, archive_path: str, kind: str) -> list[str] | None:
        try:
            if kind == "zip":
                with zipfile.ZipFile(archive_path, "r") as archive:
                    return [member.filename for member in archive.infolist()]
            if kind in ("tar", "tar.zst"):
                with tarfile.open(archive_path, "r:*") as archive:
                    return [member.name for member in archive.getmembers()]
        except (tarfile.TarError, zipfile.BadZipFile, OSError):
            if kind != "tar.zst":
                return None
        if kind in ("rar", "7z", "iso", "tar.zst"):
            return self._list_external_archive(archive_path, kind)
        return None

    def _archive_contains_single_root_folder(self, archive_path: str) -> str | None:
        kind = self._archive_kind(archive_path)
        names = self._list_archive_names(archive_path, kind) if kind else None
        if not names:
            return None

        roots: set[str] = set()
        has_subpath = False
        for name in names:
            parts = [part for part in name.replace("\\", "/").lstrip("/").split("/") if part and part != "."]
            if not parts:
                continue
            roots.add(parts[0])
            if len(parts) > 1:
                has_subpath = True
        if len(roots) == 1 and has_subpath:
            return next(iter(roots))
        return None

    def _flatten_single_root_folder(self, target_dir: str, root_name: str) -> None:
        root_path = os.path.join(target_dir, root_name)
        if not os.path.isdir(root_path):
            return
        if [entry for entry in os.listdir(target_dir) if entry != root_name]:
            return
        for entry in os.listdir(root_path):
            os.replace(os.path.join(root_path, entry), os.path.join(target_dir, entry))
        os.rmdir(root_path)

    def _safe_archive_member_path(self, target_dir: str, member_name: str) -> str:
        if not member_name or os.path.isabs(member_name):
            raise ValueError("Arquivo compactado contém um caminho inválido")
        target_dir = os.path.realpath(target_dir)
        destination = os.path.realpath(os.path.join(target_dir, member_name))
        try:
            inside = os.path.commonpath([target_dir, destination]) == target_dir
        except ValueError:
            inside = False
        if not inside:
            raise ValueError("Arquivo compactado contém caminho fora do destino")
        return destination

    def _apply_member_metadata(self, path: str, mode: int | None, mtime: float | None) -> None:
        try:
            if mode:
                os.chmod(path, mode & 0o777)
            if mtime:
                os.utime(path, (mtime, mtime))
        except (OSError, OverflowError, ValueError):
            pass

    def _apply_dir_metadata(self, pending: list[tuple[str, int | None, float | None]]) -> None:
        for path, mode, mtime in reversed(pending):
            if os.path.isdir(path):
                self._apply_member_metadata(path, mode, mtime)

    def _progress_window(self, processed_bytes: int, size: int, total_bytes: int, processed_files: int, total_files: int) -> tuple[float, float]:
        if total_bytes > 0:
            return processed_bytes / total_bytes * 100.0, (processed_bytes + size) / total_bytes * 100.0
        if total_files > 0:
            return processed_files / total_files * 100.0, (processed_files + 1) / total_files * 100.0
        return 0.0, 100.0

    def _extract_zip_with_progress(self, archive_path: str, target_dir: str, operation_id: str | None = None) -> None:
        os.makedirs(target_dir, exist_ok=True)
        with zipfile.ZipFile(archive_path, "r") as archive:
            members = archive.infolist()
            files = [m for m in members if not m.is_dir()]
            total_bytes = sum(m.file_size for m in files)
            processed_bytes = processed_files = 0
            dirs: list[tuple[str, int | None, float | None]] = []

            for member in members:
                self._check_operation_cancelled(operation_id)
                unix_mode = member.external_attr >> 16
                destination = self._safe_archive_member_path(target_dir, member.filename)
                try:
                    mtime = time.mktime(member.date_time + (0, 0, -1))
                except (OverflowError, ValueError):
                    mtime = None

                if member.is_dir():
                    os.makedirs(destination, exist_ok=True)
                    dirs.append((destination, unix_mode or None, mtime))
                    continue
                if statmod.S_ISLNK(unix_mode):
                    continue

                self._set_operation_progress_detail(member.filename, operation_id)
                self._mark_first_item_processed(operation_id)
                os.makedirs(os.path.dirname(destination), exist_ok=True)
                start, end = self._progress_window(processed_bytes, member.file_size, total_bytes, processed_files, len(files))
                with archive.open(member, "r") as source, open(destination, "wb") as target:
                    self._copy_stream_with_progress(source, target, member.file_size, start, end, operation_id)
                self._apply_member_metadata(destination, unix_mode or None, mtime)
                processed_bytes += member.file_size
                processed_files += 1
            self._apply_dir_metadata(dirs)

    def _extract_tar_with_progress(self, archive_path: str, target_dir: str, operation_id: str | None = None) -> None:
        os.makedirs(target_dir, exist_ok=True)
        with tarfile.open(archive_path, "r:*") as archive:
            members = [m for m in archive.getmembers() if m.isdir() or m.isfile()]
            files = [m for m in members if m.isfile()]
            total_bytes = sum(int(m.size) for m in files)
            processed_bytes = processed_files = 0
            dirs: list[tuple[str, int | None, float | None]] = []

            for member in members:
                self._check_operation_cancelled(operation_id)
                destination = self._safe_archive_member_path(target_dir, member.name)
                if member.isdir():
                    os.makedirs(destination, exist_ok=True)
                    dirs.append((destination, member.mode, member.mtime))
                    continue

                self._set_operation_progress_detail(member.name, operation_id)
                self._mark_first_item_processed(operation_id)
                os.makedirs(os.path.dirname(destination), exist_ok=True)
                source = archive.extractfile(member)
                if source is None:
                    raise ValueError("Não foi possível ler um arquivo do tar")
                start, end = self._progress_window(processed_bytes, int(member.size), total_bytes, processed_files, len(files))
                with source, open(destination, "wb") as target:
                    self._copy_stream_with_progress(source, target, int(member.size), start, end, operation_id)
                self._apply_member_metadata(destination, member.mode, member.mtime)
                processed_bytes += int(member.size)
                processed_files += 1
            self._apply_dir_metadata(dirs)

    def _open_decompressor(self, kind: str, raw):
        if kind == "gz":
            return gzip.GzipFile(fileobj=raw)
        if kind == "bz2":
            return bz2.BZ2File(raw)
        if kind == "xz":
            return lzma.LZMAFile(raw)
        try:
            from compression import zstd
            return zstd.ZstdFile(raw)
        except ImportError:
            raise ValueError("Extrair .zst requer Python 3.14+ ou o utilitário 'zstd'") from None

    def _extract_single_file_with_progress(self, archive_path: str, target_file: str, operation_id: str | None = None) -> None:
        kind = self._archive_kind(archive_path)
        os.makedirs(os.path.dirname(target_file), exist_ok=True)

        if kind == "zst" and shutil.which("zstd"):
            command = ["zstd", "-d", "-q", "-f", "-o", target_file, archive_path]
            self._run_external_extract(command, 0, operation_id)
            return

        total = os.path.getsize(archive_path)
        self._set_operation_progress_detail(os.path.basename(target_file), operation_id)
        try:
            with open(archive_path, "rb") as raw:
                with self._open_decompressor(kind, raw) as source, open(target_file, "wb") as target:
                    while True:
                        self._check_operation_cancelled(operation_id)
                        chunk = source.read(CHUNK_SIZE)
                        if not chunk:
                            break
                        self._mark_first_item_processed(operation_id)
                        target.write(chunk)
                        if total > 0:
                            self._set_operation_progress(min(99.0, raw.tell() / total * 100.0), operation_id)
        except BaseException:
            try:
                os.remove(target_file)
            except OSError:
                pass
            raise

    def _run_external_extract(self, command: list[str], total_items: int, operation_id: str | None = None) -> None:
        self._set_operation_progress_detail("...", operation_id)
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace", bufsize=1)
        self._set_operation_state_active_process(process, operation_id)
        tail: list[str] = []
        extracted = 0
        try:
            for raw_line in process.stdout or []:
                self._check_operation_cancelled(operation_id)
                line = raw_line.strip()
                if not line:
                    continue
                tail = (tail + [line])[-8:]
                lower = line.lower()
                if lower in ("all ok", "ok") or line.startswith(("-----", "Archive:", "Extracting archive")):
                    continue
                self._mark_first_item_processed(operation_id)
                self._set_operation_progress_detail(line.removeprefix("- ").removeprefix("Extracting ").strip()[:50], operation_id)
                extracted += 1
                if total_items > 0:
                    self._set_operation_progress(min(99.0, extracted / total_items * 100.0), operation_id)
            process.wait()
        finally:
            terminate_process(process)
            if process.stdout is not None:
                process.stdout.close()
            self._clear_operation_state_active_process(process, operation_id)

        if process.returncode != 0:
            raise RuntimeError("Falha ao extrair: " + " | ".join(tail[-3:]))
        self._set_operation_progress(100.0, operation_id)

    def _extract_external_with_progress(self, archive_path: str, target_dir: str, kind: str, operation_id: str | None = None) -> None:
        os.makedirs(target_dir, exist_ok=True)
        unrar = shutil.which("unrar")
        seven_zip = self._seven_zip()

        if kind == "tar.zst":
            if not shutil.which("tar") or not shutil.which("zstd"):
                raise ValueError("Não foi possível extrair .tar.zst: instale 'zstd' e 'tar'.")
            command = ["tar", "--zstd", "-xvf", archive_path, "-C", target_dir]
        elif kind == "rar" and unrar:
            command = [unrar, "x", "-o+", "-y", "-idp", archive_path, os.path.join(target_dir, "")]
        elif seven_zip:
            command = [seven_zip, "x", "-y", "-bb1", "-bsp0", f"-o{target_dir}", archive_path]
        else:
            raise ValueError(f"Não foi possível extrair .{kind} porque nenhum utilitário compatível está disponível. Instale 'unrar' ou 'p7zip' e tente novamente.")

        names = self._list_external_archive(archive_path, kind)
        self._run_external_extract(command, len(names) if names else 0, operation_id)

    def _run_extraction_with_progress(self, archive_path: str, target_dir: str, operation_id: str | None = None) -> None:
        self._set_operation_progress_detail(os.path.basename(archive_path) or archive_path, operation_id)
        kind = self._archive_kind(archive_path)

        if kind == "zip":
            self._extract_zip_with_progress(archive_path, target_dir, operation_id)
        elif kind == "tar":
            self._extract_tar_with_progress(archive_path, target_dir, operation_id)
        elif kind == "tar.zst":
            try:
                self._extract_tar_with_progress(archive_path, target_dir, operation_id)
            except tarfile.TarError:
                self._extract_external_with_progress(archive_path, target_dir, kind, operation_id)
        elif kind in ("gz", "bz2", "xz", "zst"):
            self._extract_single_file_with_progress(archive_path, target_dir, operation_id)
        elif kind in ("rar", "7z", "iso"):
            self._extract_external_with_progress(archive_path, target_dir, kind, operation_id)
        else:
            raise ValueError("Formato de arquivo compactado não suportado")

    def _plan_extraction(self, archive_path: str, target_dir: str) -> tuple[str, bool, str]:
        base = self._archive_base_name(os.path.basename(archive_path))
        kind = self._archive_kind(archive_path)

        if kind in SINGLE_FILE_SUFFIX_KINDS:
            single = self._unique_target_path(os.path.join(target_dir, base))
            return single, False, single

        archive_dir = os.path.join(target_dir, base)
        if self._archive_contains_single_root_folder(archive_path) == base:
            if os.path.lexists(archive_dir):
                unique = self._unique_target_path(archive_dir)
                return unique, True, unique
            return target_dir, False, archive_dir

        final = self._unique_target_path(archive_dir)
        return final, False, final
