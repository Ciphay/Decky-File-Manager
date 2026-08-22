import os

from .properties import Properties


class Clipboard(Properties):

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
        import shutil
        
        if os.path.isdir(src_path):
            shutil.copytree(src_path, dst_path, dirs_exist_ok=False)
        else:
            shutil.copy2(src_path, dst_path)

    def _move_path(self, src_path: str, dst_path: str) -> None:
        import shutil
        import errno
        
        try:
            os.rename(src_path, dst_path)
        except OSError as e:
            if getattr(e, 'errno', None) == errno.EXDEV:
                shutil.move(src_path, dst_path)
            else:
                raise

    def _clear_clipboard(self) -> None:
        self._clipboard_path = None
        self._clipboard_kind = None
        self._save_runtime_state()

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

    async def paste_path_with_options(self, target_dir: str, conflict_strategy: str = "keep-both", apply_to_all: bool = False, paste_label: str = "Copying", move_label: str = "Moving", operation_id: str | None = None) -> dict:
        import shutil
        import asyncio
        
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

        try:
            if conflict_strategy == "merge" and os.path.isdir(src) and os.path.isdir(dst):
                if kind == "copy":
                    shutil.copytree(src, dst, dirs_exist_ok=True)
                elif kind == "cut":
                    shutil.copytree(src, dst, dirs_exist_ok=True)
                    shutil.rmtree(src)
                else:
                    raise ValueError("Clipboard inválida")
            elif kind == "copy":
                refresh_target = os.path.dirname(dst) or target_dir
                if os.path.isdir(src):
                    await self._run_with_progress(paste_label, lambda: self._copy_tree_with_progress(src, dst, conflict_strategy, apply_to_all, operation_id), operation_id, refresh_target)
                else:
                    await self._run_with_progress(paste_label, lambda: self._copy_file_with_progress(src, dst, operation_id=operation_id), operation_id, refresh_target)
            elif kind == "cut":
                refresh_target = os.path.dirname(dst) or target_dir
                await self._run_with_progress(move_label, lambda: self._move_path_with_progress(src, dst, operation_id), operation_id, refresh_target)
            else:
                raise ValueError("Clipboard inválida")
        except PermissionError as e:
            raise PermissionError(f"Sem permissão: {e}") from e

        self._clear_clipboard()
        return {"ok": True, "conflict_strategy": conflict_strategy}
