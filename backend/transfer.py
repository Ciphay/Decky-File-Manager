import os
from typing import Tuple


class Transfer:
    def _validate_transfer(self, src_path: str, target_dir: str) -> Tuple[str, str]:
        if not src_path:
            raise ValueError("Caminho inválido")
        if not target_dir:
            raise ValueError("Destino inválido")

        src_path = os.path.abspath(src_path)
        target_dir = os.path.abspath(os.path.expanduser(target_dir))
        if not os.path.exists(src_path):
            raise FileNotFoundError(f"Item não existe: {src_path}")
        if not os.path.isdir(target_dir):
            raise NotADirectoryError(f"Diretório não encontrado: {target_dir}")
        if not self._is_safe_target_for_path(target_dir, src_path):
            raise ValueError("Destino inválido")
        if os.path.realpath(os.path.dirname(src_path)) == os.path.realpath(target_dir):
            raise ValueError("Origem e destino são a mesma pasta")

        return (src_path, target_dir)

    async def check_transfer_conflict(self, src_path: str, target_dir: str) -> dict:
        src_path, target_dir = self._validate_transfer(src_path, target_dir)
        name = os.path.basename(src_path)
        raw_dst = os.path.join(target_dir, name)

        if os.path.exists(raw_dst):
            return {
                "needs_conflict": True,
                "path": raw_dst,
                "name": name,
                "is_dir": os.path.isdir(raw_dst),
            }

        return {"needs_conflict": False, "path": raw_dst, "name": name}

    async def transfer_path(self, src_path: str, target_dir: str, mode: str = "copy", conflict_strategy: str = "keep-both") -> dict:
        if mode not in ("copy", "cut"):
            raise ValueError("Modo de transferência inválido")

        src_path, target_dir = self._validate_transfer(src_path, target_dir)

        if mode == "cut" and self._is_self_or_subdirectory(target_dir, src_path):
            raise ValueError("Não é possível colar dentro do diretório.")

        name = os.path.basename(src_path)
        raw_dst = os.path.join(target_dir, name)

        if os.path.exists(raw_dst):
            if conflict_strategy == "ignore":
                return {"ok": True, "skipped": True}
            if conflict_strategy == "cancel":
                return {"ok": True, "cancelled": True}
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
            if conflict_strategy == "merge" and os.path.isdir(src_path) and os.path.isdir(dst):
                import shutil

                shutil.copytree(src_path, dst, dirs_exist_ok=True)
                if mode == "cut":
                    shutil.rmtree(src_path)
            elif mode == "copy":
                self._copy_path(src_path, dst)
            else:
                self._move_path(src_path, dst)
        except PermissionError as e:
            raise PermissionError(f"Sem permissão: {e}") from e

        if mode == "cut" and self._clipboard_path and (
            self._clipboard_path == src_path or self._is_subpath(self._clipboard_path, src_path)
        ):
            self._clipboard_path = None
            self._clipboard_kind = None
            self._save_runtime_state()

        return {"ok": True, "success": True, "new_path": dst, "conflict_strategy": conflict_strategy}
