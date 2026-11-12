import asyncio
import os
import tarfile

from .archives import Archives
from .operations_progress import OperationCancelled
from .results import as_result


def _validate_entry_name(name: str) -> None:
    if not name or name in (".", "..") or "/" in name or "\\" in name or "\0" in name:
        raise ValueError("Nome inválido")


class FileManagement(Archives):

    def _scan_directory(self, path: str) -> list[dict]:
        entries = []
        try:
            with os.scandir(path) as it:
                for entry in it:
                    try:
                        is_dir = entry.is_dir(follow_symlinks=True)
                    except OSError:
                        continue
                    try:
                        stat = None if is_dir else entry.stat(follow_symlinks=False)
                    except OSError:
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
        return entries

    @as_result
    async def list_dir(self, path: str) -> dict:
        path = self._normalize_dir(path)
        self._validate_exists_dir(path)
        entries = await asyncio.to_thread(self._scan_directory, path)

        if self._last_path != path:
            self._last_path = path
            self._save_runtime_state()
        return {"path": path, "items": entries}

    @as_result
    async def create_folder(self, parent_dir: str, name: str, operation_id: str | None = None) -> dict:
        parent_dir = self._normalize_dir(parent_dir)
        self._validate_exists_dir(parent_dir)
        _validate_entry_name(name)

        new_path = os.path.join(parent_dir, name)
        if os.path.lexists(new_path):
            raise FileExistsError(f"Já existe um item com esse nome: {new_path}")

        try:
            os.mkdir(new_path)
        except PermissionError as e:
            raise PermissionError(f"Sem permissão: {e}") from e
        return {"success": True, "path": new_path}

    @as_result
    async def rename_item(self, old_path: str, new_name: str, operation_id: str | None = None) -> dict:
        if not old_path:
            raise ValueError("Caminho inválido")
        _validate_entry_name(new_name)
        old_path = os.path.abspath(old_path)
        if not os.path.lexists(old_path):
            raise FileNotFoundError(f"Item não existe: {old_path}")

        new_path = os.path.join(os.path.dirname(old_path), new_name)
        if new_path != old_path and os.path.lexists(new_path):
            raise FileExistsError(f"Já existe um item com esse nome: {new_path}")

        try:
            os.rename(old_path, new_path)
        except PermissionError as e:
            raise PermissionError(f"Sem permissão: {e}") from e

        if self._clipboard_path and self._is_subpath(self._clipboard_path, old_path):
            relative = os.path.relpath(self._clipboard_path, old_path)
            self._clipboard_path = new_path if relative == "." else os.path.join(new_path, relative)
            self._save_runtime_state()
        return {"success": True, "new_path": new_path}

    async def rename_path(self, path: str, new_name: str) -> dict:
        return await self.rename_item(path, new_name)

    async def delete_item(self, path: str, progress_label: str = "Deleting", operation_id: str | None = None) -> dict:
        if not path:
            raise ValueError("Caminho inválido")
        path = os.path.abspath(path)
        if not os.path.lexists(path):
            return {"success": False, "error": "Arquivo ou pasta não encontrado"}
        if path == os.path.abspath(os.sep):
            return {"success": False, "error": "Não é possível excluir a raiz do sistema"}

        if os.path.isdir(path) and not os.path.islink(path):
            worker = lambda: self._delete_tree_with_progress(path, operation_id)
        else:
            worker = lambda: self._delete_path_with_progress(path, operation_id)

        try:
            await self._run_with_progress(progress_label, worker, operation_id, os.path.dirname(path))
        except PermissionError as e:
            return {"success": False, "error": f"Sem permissão: {e}"}
        except OperationCancelled as e:
            return {"success": False, "cancelled": True, "error": str(e)}
        except OSError as e:
            return {"success": False, "error": str(e)}

        if self._clipboard_path and self._is_subpath(self._clipboard_path, path):
            self._clipboard_path = None
            self._clipboard_kind = None
            self._save_runtime_state()
        return {"success": True}

    async def delete_path(self, path: str) -> dict:
        return await self.delete_item(path)

    @as_result
    async def extract_archive(self, archive_path: str, target_dir: str, progress_label: str = "Extracting", operation_id: str | None = None) -> dict:
        if not archive_path:
            raise ValueError("Caminho inválido")
        if not target_dir:
            raise ValueError("Destino inválido")

        archive_path = os.path.abspath(archive_path)
        target_dir = self._normalize_dir(target_dir)
        self._validate_exists_dir(target_dir)
        if not os.path.isfile(archive_path):
            raise FileNotFoundError(f"Arquivo não encontrado: {archive_path}")
        if self._archive_kind(archive_path) is None:
            raise ValueError("Formato de arquivo compactado não suportado")

        extract_target, should_flatten, final_path = await asyncio.to_thread(self._plan_extraction, archive_path, target_dir)
        archive_base = self._archive_base_name(os.path.basename(archive_path))
        existed_before = os.path.lexists(final_path)

        def worker() -> None:
            self._run_extraction_with_progress(archive_path, extract_target, operation_id)
            if should_flatten:
                self._flatten_single_root_folder(extract_target, archive_base)

        try:
            await self._run_with_progress(progress_label, worker, operation_id, target_dir)
        except PermissionError as e:
            self._discard_partial(final_path, existed_before)
            raise PermissionError(f"Sem permissão: {e}") from e
        except OperationCancelled:
            self._discard_partial(final_path, existed_before)
            raise
        except ValueError:
            self._discard_partial(final_path, existed_before)
            raise
        except (tarfile.TarError, OSError, RuntimeError) as e:
            self._discard_partial(final_path, existed_before)
            raise ValueError(f"Falha ao extrair o arquivo: {e}") from e

        return {"success": True, "new_path": final_path}

    def _discard_partial(self, path: str, existed_before: bool) -> None:
        if existed_before or not os.path.lexists(path):
            return
        try:
            self._remove_path(path)
        except OSError:
            pass
