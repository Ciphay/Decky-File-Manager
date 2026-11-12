import errno
import os
import shutil
import stat as statmod
import uuid

from .operations_progress import OperationCancelled, OperationsProgress
from .paths import expand_user_path, user_home

CHUNK_SIZE = 1024 * 1024


class FileOps(OperationsProgress):

    def _real_item_path(self, path: str) -> str:
        if os.path.islink(path):
            return os.path.join(os.path.realpath(os.path.dirname(path)), os.path.basename(path))
        return os.path.realpath(path)

    def _is_subpath(self, child_path: str, parent_path: str) -> bool:
        child_real = self._real_item_path(child_path)
        parent_real = self._real_item_path(parent_path)
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
        if os.path.isdir(src_path) and not os.path.islink(src_path) and self._is_subpath(target_dir, src_path):
            return False
        return True

    def _normalize_dir(self, path: str) -> str:
        normalized = expand_user_path(path)
        if not normalized:
            return self._settings.get("default_path") or user_home()
        return os.path.abspath(normalized)

    def _validate_exists_dir(self, path: str) -> None:
        if not os.path.exists(path):
            raise FileNotFoundError(f"Diretório não encontrado: {path}")
        if not os.path.isdir(path):
            raise NotADirectoryError(f"Não é um diretório: {path}")

    def _unique_target_path(self, target_path: str) -> str:
        if not os.path.lexists(target_path):
            return target_path

        base_dir = os.path.dirname(target_path)
        filename = os.path.basename(target_path)
        if os.path.isdir(target_path) and not os.path.islink(target_path):
            name, ext = filename, ""
        else:
            name, ext = os.path.splitext(filename)

        i = 1
        while True:
            candidate = os.path.join(base_dir, f"{name} ({i}){ext}")
            if not os.path.lexists(candidate):
                return candidate
            i += 1

    def _remove_path(self, path: str) -> None:
        if os.path.islink(path) or os.path.isfile(path):
            os.remove(path)
        elif os.path.isdir(path):
            shutil.rmtree(path)
        elif os.path.lexists(path):
            os.remove(path)

    def _stash_existing(self, path: str) -> str:
        backup = os.path.join(os.path.dirname(path), f".{os.path.basename(path)}.dm-old-{uuid.uuid4().hex[:8]}")
        os.rename(path, backup)
        return backup

    def _restore_stash(self, backup: str, path: str) -> None:
        try:
            if os.path.lexists(path):
                self._remove_path(path)
            os.rename(backup, path)
        except OSError:
            pass

    def _copy_symlink(self, src_path: str, dst_path: str) -> None:
        os.makedirs(os.path.dirname(dst_path), exist_ok=True)
        if os.path.lexists(dst_path):
            self._remove_path(dst_path)
        os.symlink(os.readlink(src_path), dst_path)

    def _copy_file_with_progress(self, src_path: str, dst_path: str, progress_start: float = 0.0, progress_end: float = 100.0, operation_id: str | None = None) -> None:
        if os.path.islink(src_path):
            self._copy_symlink(src_path, dst_path)
            self._set_operation_progress(progress_end, operation_id)
            return
        if not statmod.S_ISREG(os.stat(src_path).st_mode):
            raise ValueError(f"Tipo de arquivo não suportado: {src_path}")

        total = os.path.getsize(src_path)
        copied = 0
        self._set_operation_progress_detail(os.path.basename(src_path) or src_path, operation_id)
        os.makedirs(os.path.dirname(dst_path), exist_ok=True)

        try:
            with open(src_path, "rb") as source, open(dst_path, "wb") as target:
                while True:
                    self._check_operation_cancelled(operation_id)
                    chunk = source.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    target.write(chunk)
                    if copied == 0:
                        self._mark_first_item_processed(operation_id)
                    copied += len(chunk)
                    if total > 0:
                        self._set_operation_progress(progress_start + (copied / total) * (progress_end - progress_start), operation_id)
            shutil.copystat(src_path, dst_path)
        except BaseException:
            try:
                os.remove(dst_path)
            except OSError:
                pass
            raise

        self._set_operation_progress(progress_end, operation_id)

    def _copy_stream_with_progress(self, source, target, total_size: int, progress_start: float = 0.0, progress_end: float = 100.0, operation_id: str | None = None) -> None:
        copied = 0
        while True:
            self._check_operation_cancelled(operation_id)
            chunk = source.read(CHUNK_SIZE)
            if not chunk:
                break
            target.write(chunk)
            if copied == 0:
                self._mark_first_item_processed(operation_id)
            copied += len(chunk)
            if total_size > 0:
                self._set_operation_progress(progress_start + (copied / total_size) * (progress_end - progress_start), operation_id)
        self._set_operation_progress(progress_end, operation_id)

    def _scan_tree(self, src_path: str) -> tuple[int, int]:
        weight = 0
        count = 0
        for root, dirs, files in os.walk(src_path, onerror=lambda _error: None):
            for name in files + [d for d in dirs if os.path.islink(os.path.join(root, d))]:
                try:
                    size = os.lstat(os.path.join(root, name)).st_size
                except OSError:
                    size = 0
                weight += max(size, 1)
                count += 1
        return weight, count

    def _resolve_inner_conflict(self, dst_file: str, strategy: str) -> str | None:
        if not os.path.lexists(dst_file):
            return dst_file
        if strategy == "ignore":
            return None
        if strategy == "cancel":
            raise OperationCancelled("Operação cancelada pelo usuário")
        if strategy == "replace":
            self._remove_path(dst_file)
            return dst_file
        if strategy == "keep-both":
            return self._unique_target_path(dst_file)
        if strategy == "merge":
            if os.path.isdir(dst_file) and not os.path.islink(dst_file):
                raise IsADirectoryError(f"Conflito entre arquivo e pasta: {dst_file}")
            return dst_file
        raise ValueError("Estratégia de conflito inválida")

    def _copy_tree_with_progress(self, src_path: str, dst_path: str, conflict_strategy: str = "keep-both", operation_id: str | None = None, skip_unreadable: bool = False) -> list[str]:
        skipped: list[str] = []

        def on_walk_error(error: OSError) -> None:
            if not skip_unreadable:
                raise error
            skipped.append(error.filename or src_path)

        root_name = os.path.basename(src_path.rstrip("/\\")) or src_path
        self._set_operation_progress_detail(root_name, operation_id)
        created_root = not os.path.lexists(dst_path)
        total_weight, _ = self._scan_tree(src_path)
        done_weight = 0
        created_dirs: list[tuple[str, str]] = []

        try:
            os.makedirs(dst_path, exist_ok=True)
            created_dirs.append((src_path, dst_path))
            for root, dirs, files in os.walk(src_path, onerror=on_walk_error):
                rel_root = os.path.relpath(root, src_path)
                current_dst = dst_path if rel_root == "." else os.path.join(dst_path, rel_root)
                os.makedirs(current_dst, exist_ok=True)

                entries = list(files)
                for d in dirs:
                    if os.path.islink(os.path.join(root, d)):
                        entries.append(d)
                    else:
                        os.makedirs(os.path.join(current_dst, d), exist_ok=True)
                        created_dirs.append((os.path.join(root, d), os.path.join(current_dst, d)))

                for filename in entries:
                    self._check_operation_cancelled(operation_id)
                    src_file = os.path.join(root, filename)
                    resolved = self._resolve_inner_conflict(os.path.join(current_dst, filename), conflict_strategy)
                    try:
                        size = os.lstat(src_file).st_size
                    except OSError:
                        size = 0
                    weight = max(size, 1)

                    if resolved is not None:
                        start = done_weight / total_weight * 100.0 if total_weight else 0.0
                        end = (done_weight + weight) / total_weight * 100.0 if total_weight else 100.0
                        try:
                            self._copy_file_with_progress(src_file, resolved, start, end, operation_id)
                        except ValueError:
                            pass
                        except PermissionError as error:
                            if not skip_unreadable or error.filename != src_file:
                                raise
                            skipped.append(src_file)
                    done_weight += weight
                    self._set_operation_progress(done_weight / total_weight * 100.0 if total_weight else 100.0, operation_id)

            for src_dir, dst_dir in reversed(created_dirs):
                try:
                    shutil.copystat(src_dir, dst_dir)
                except OSError:
                    pass
        except BaseException:
            if created_root:
                shutil.rmtree(dst_path, ignore_errors=True)
            raise

        self._set_operation_progress(100.0, operation_id)
        self._set_operation_progress_detail(root_name, operation_id)
        return skipped

    def _move_path_with_progress(self, src_path: str, dst_path: str, operation_id: str | None = None) -> None:
        try:
            os.rename(src_path, dst_path)
            self._set_operation_progress(100.0, operation_id)
            return
        except OSError as e:
            if getattr(e, "errno", None) != errno.EXDEV:
                raise

        self._set_operation_progress_detail(os.path.basename(src_path) or src_path, operation_id)
        if os.path.isdir(src_path) and not os.path.islink(src_path):
            self._copy_tree_with_progress(src_path, dst_path, "keep-both", operation_id)
        else:
            self._copy_file_with_progress(src_path, dst_path, operation_id=operation_id)

        if not os.path.lexists(dst_path):
            raise RuntimeError("A cópia de destino não foi concluída corretamente")
        self._remove_path(src_path)
        self._set_operation_progress(100.0, operation_id)

    def _merge_move_with_progress(self, src_path: str, dst_path: str, operation_id: str | None = None) -> None:
        self._copy_tree_with_progress(src_path, dst_path, "merge", operation_id)
        self._remove_path(src_path)

    def _delete_path_with_progress(self, path: str, operation_id: str | None = None) -> None:
        self._set_operation_progress_detail(os.path.basename(path) or path, operation_id)
        self._check_operation_cancelled(operation_id)
        os.remove(path)
        self._set_operation_progress(100.0, operation_id)

    def _delete_tree_with_progress(self, path: str, operation_id: str | None = None) -> None:
        total_entries = 1
        for _root, dirs, files in os.walk(path):
            total_entries += len(dirs) + len(files)

        processed = 0

        def advance(name: str) -> None:
            nonlocal processed
            processed += 1
            self._set_operation_progress_detail(name, operation_id)
            self._set_operation_progress(processed / total_entries * 100.0, operation_id)

        for root, dirs, files in os.walk(path, topdown=False):
            for filename in files:
                self._check_operation_cancelled(operation_id)
                os.remove(os.path.join(root, filename))
                advance(filename)
            for dirname in dirs:
                self._check_operation_cancelled(operation_id)
                dir_path = os.path.join(root, dirname)
                if os.path.islink(dir_path):
                    os.remove(dir_path)
                else:
                    os.rmdir(dir_path)
                advance(dirname)

        self._check_operation_cancelled(operation_id)
        os.rmdir(path)
        advance(os.path.basename(path) or path)
