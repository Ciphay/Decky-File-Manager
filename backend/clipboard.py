import os

from .properties import Properties
from .results import as_result


class Clipboard(Properties):

    def _copy_or_cut_prepare(self, src_path: str, kind: str) -> None:
        if not src_path:
            raise ValueError("Caminho inválido")
        src_path = os.path.abspath(src_path)
        if not os.path.lexists(src_path):
            raise FileNotFoundError(f"Item não existe: {src_path}")

        self._clipboard_path = src_path
        self._clipboard_kind = kind
        self._save_runtime_state()

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
        if self._clipboard_path and not os.path.lexists(self._clipboard_path):
            self._clear_clipboard()
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

    def _clipboard_or_raise(self) -> tuple[str, str]:
        if not self._clipboard_path or not self._clipboard_kind:
            raise ValueError("Área de transferência está vazia")
        if not os.path.lexists(self._clipboard_path):
            self._clear_clipboard()
            raise FileNotFoundError("O item copiado não existe mais")
        return self._clipboard_path, self._clipboard_kind

    def _paste_block_reason(self, src: str, kind: str, target_dir: str) -> str | None:
        if not self._is_safe_target_for_path(target_dir, src):
            return "self-directory"
        if kind == "cut" and self._is_self_or_subdirectory(target_dir, src):
            return "self-directory"
        if kind == "cut" and os.path.realpath(os.path.dirname(src)) == os.path.realpath(target_dir):
            return "same-directory"
        return None

    async def check_paste_conflict(self, target_dir: str) -> dict:
        target_dir = self._normalize_dir(target_dir)
        self._validate_exists_dir(target_dir)
        src, kind = self._clipboard_or_raise()
        name = os.path.basename(src)

        reason = self._paste_block_reason(src, kind, target_dir)
        if reason:
            return {"blocked": True, "reason": reason, "name": name}

        raw_dst = os.path.join(target_dir, name)
        if os.path.lexists(raw_dst):
            return {
                "blocked": False,
                "needs_conflict": True,
                "path": raw_dst,
                "name": name,
                "is_dir": os.path.isdir(raw_dst) and not os.path.islink(raw_dst),
            }
        return {"blocked": False, "needs_conflict": False, "path": raw_dst, "name": name}

    async def paste_path(self, target_dir: str) -> dict:
        return await self.paste_path_with_options(target_dir, "keep-both")

    def _resolve_paste_destination(self, src: str, kind: str, raw_dst: str, strategy: str) -> tuple[str | None, dict | None]:
        if not os.path.lexists(raw_dst):
            return raw_dst, None
        if strategy == "ignore":
            return None, {"ok": True, "skipped": True}
        if strategy == "cancel":
            return None, {"ok": True, "cancelled": True}
        if self._real_item_path(raw_dst) == self._real_item_path(src):
            return None, {"ok": True, "skipped": True}
        if kind == "cut" and self._is_subpath(src, raw_dst):
            raise ValueError("Não é possível substituir uma pasta que contém o item movido")

        if strategy == "replace":
            return raw_dst, None
        if strategy == "keep-both":
            return self._unique_target_path(raw_dst), None
        if strategy == "merge":
            if not (os.path.isdir(src) and os.path.isdir(raw_dst)) or os.path.islink(src) or os.path.islink(raw_dst):
                raise ValueError("Só é possível mesclar pastas")
            return raw_dst, None
        raise ValueError("Estratégia de conflito inválida")

    @as_result
    async def paste_path_with_options(self, target_dir: str, conflict_strategy: str = "keep-both", apply_to_all: bool = False, paste_label: str = "Copying", move_label: str = "Moving", operation_id: str | None = None) -> dict:
        target_dir = self._normalize_dir(target_dir)
        self._validate_exists_dir(target_dir)
        src, kind = self._clipboard_or_raise()

        if self._paste_block_reason(src, kind, target_dir):
            raise ValueError("Destino inválido")

        raw_dst = os.path.join(target_dir, os.path.basename(src))
        dst, immediate = self._resolve_paste_destination(src, kind, raw_dst, conflict_strategy)
        if immediate is not None or dst is None:
            return immediate or {"ok": True, "skipped": True}

        replacing = conflict_strategy == "replace" and os.path.lexists(raw_dst)
        merging = conflict_strategy == "merge" and os.path.lexists(raw_dst)

        skipped: list[str] = []

        def worker() -> None:
            backup = self._stash_existing(raw_dst) if replacing else None
            try:
                if merging and kind == "cut":
                    self._merge_move_with_progress(src, dst, operation_id)
                elif merging:
                    skipped.extend(self._copy_tree_with_progress(src, dst, "merge", operation_id, skip_unreadable=True))
                elif kind == "copy" and os.path.isdir(src) and not os.path.islink(src):
                    skipped.extend(self._copy_tree_with_progress(src, dst, "keep-both", operation_id, skip_unreadable=True))
                elif kind == "copy":
                    self._copy_file_with_progress(src, dst, operation_id=operation_id)
                else:
                    self._move_path_with_progress(src, dst, operation_id)
            except BaseException:
                if backup:
                    self._restore_stash(backup, dst)
                raise
            if backup:
                try:
                    self._remove_path(backup)
                except OSError:
                    pass

        label = paste_label if kind == "copy" else move_label
        try:
            await self._run_with_progress(label, worker, operation_id, target_dir)
        except PermissionError as e:
            raise PermissionError(f"Sem permissão: {e}") from e

        self._clear_clipboard()
        return {
            "ok": True,
            "success": True,
            "new_path": dst,
            "conflict_strategy": conflict_strategy,
            "skipped_count": len(skipped),
            "skipped_items": [os.path.basename(item) for item in skipped[:5]],
        }
