import os
import re
import signal
import subprocess
import threading
import time
from contextvars import ContextVar


class OperationsProgress:
    
    def _resolve_operation_id(self, operation_id: str | None = None) -> str | None:
        if operation_id is not None:
            return operation_id
        return self._current_operation_id.get()

    def _get_operation_state(self, operation_id: str | None = None) -> dict:
        resolved_id = self._resolve_operation_id(operation_id) or "__default__"
        state = self._operation_states.get(resolved_id)
        if state is None:
            state = {
                "progress": 0.0,
                "active": False,
                "label": "",
                "detail": "",
                "cancel_requested": False,
                "paused": False,
                "active_process": None,
                "first_item_processed": False,
                "target_dir": None
            }
            self._operation_states[resolved_id] = state
        return state

    def _set_operation_state_active_process(self, process: subprocess.Popen | None, operation_id: str | None = None) -> None:
        with self._operation_progress_lock:
            self._get_operation_state(operation_id)["active_process"] = process

    def _clear_operation_state_active_process(self, process: subprocess.Popen | None, operation_id: str | None = None) -> None:
        with self._operation_progress_lock:
            state = self._get_operation_state(operation_id)
            if state.get("active_process") is process:
                state["active_process"] = None

    def _start_operation_progress(self, label: str = "", operation_id: str | None = None, target_dir: str | None = None) -> None:
        resolved_id = self._resolve_operation_id(operation_id) or "__default__"
        with self._operation_progress_lock:
            state = self._get_operation_state(resolved_id)
            state["progress"] = 0.0
            state["active"] = True
            state["label"] = label
            state["detail"] = ""
            state["cancel_requested"] = False
            state["paused"] = False
            state["active_process"] = None
            state["first_item_processed"] = False
            state["target_dir"] = target_dir
            self._operation_progress = 0.0
            self._operation_progress_active = True
            self._operation_progress_label = label
            self._operation_cancel_requested = False

    def _set_operation_progress(self, progress: float, operation_id: str | None = None) -> None:
        resolved_id = self._resolve_operation_id(operation_id) or "__default__"
        with self._operation_progress_lock:
            state = self._get_operation_state(resolved_id)
            state["progress"] = max(0.0, min(100.0, progress))
            self._operation_progress = state["progress"]
            self._operation_progress_active = state.get("active", False)
            self._operation_progress_label = state.get("label", "")

    def _apply_pause_state_to_process(self, state: dict, paused: bool) -> None:
        process = state.get("active_process")
        if process is None or not hasattr(process, "poll"):
            return
        try:
            if process.poll() is not None:
                return
            if paused:
                process.send_signal(signal.SIGSTOP)
            else:
                process.send_signal(signal.SIGCONT)
        except (OSError, ProcessLookupError, ValueError):
            pass

    def _set_operation_paused(self, paused: bool, operation_id: str | None = None) -> None:
        resolved_id = self._resolve_operation_id(operation_id) or "__default__"
        with self._operation_progress_lock:
            state = self._operation_states.get(resolved_id)
            if state is None:
                return
            state["paused"] = paused
            self._apply_pause_state_to_process(state, paused)

    def _is_operation_paused(self, operation_id: str | None = None) -> bool:
        resolved_id = self._resolve_operation_id(operation_id) or "__default__"
        with self._operation_progress_lock:
            state = self._operation_states.get(resolved_id)
            return bool(state and state.get("paused"))

    def _sanitize_operation_text(self, value: str | None) -> str:
        text = (value or "").strip()
        text = re.sub(r"(?:\s*[.]{1,3}\s*)(?=(?:[:\-]|$))", "", text)
        return re.sub(r"\s{2,}", " ", text).strip()

    def _set_operation_progress_label(self, label: str, operation_id: str | None = None) -> None:
        resolved_id = self._resolve_operation_id(operation_id) or "__default__"
        sanitized = self._sanitize_operation_text(label)
        with self._operation_progress_lock:
            state = self._get_operation_state(resolved_id)
            state["label"] = sanitized
            self._operation_progress_label = sanitized

    def _set_operation_progress_detail_field(self, detail: str, operation_id: str | None = None) -> None:
        resolved_id = self._resolve_operation_id(operation_id) or "__default__"
        sanitized = self._sanitize_operation_text(detail)
        with self._operation_progress_lock:
            state = self._get_operation_state(resolved_id)
            state["detail"] = sanitized

    def _get_operation_label(self, operation_id: str | None = None) -> str:
        resolved_id = self._resolve_operation_id(operation_id) or "__default__"
        with self._operation_progress_lock:
            state = self._get_operation_state(resolved_id)
            label = state.get("label", "")
            return str(label or "")

    def _get_operation_label_base(self, operation_id: str | None = None) -> str:
        label = self._get_operation_label(operation_id)
        if not label:
            return ""
        return label.split(":", 1)[0].strip()

    def _normalize_operation_detail(self, detail: str) -> str:
        detail = (detail or "").strip()
        if not detail:
            return ""
        if "/" in detail or "\\" in detail:
            import os
            return os.path.basename(detail)
        return detail

    def _set_operation_progress_detail(self, detail: str, operation_id: str | None = None) -> None:
        normalized_detail = self._normalize_operation_detail(detail)
        self._set_operation_progress_detail_field(normalized_detail, operation_id)
        base_label = self._get_operation_label_base(operation_id)

        if not normalized_detail:
            if base_label:
                self._set_operation_progress_label(base_label, operation_id)
            else:
                self._set_operation_progress_label("", operation_id)
            return

        if base_label:
            base_name = os.path.basename(base_label)
            detail_name = os.path.basename(normalized_detail)
            if detail_name and (detail_name == base_name or detail_name in base_label):
                self._set_operation_progress_label(base_label, operation_id)
                return
            self._set_operation_progress_label(f"{base_label}: {normalized_detail}", operation_id)
        else:
            self._set_operation_progress_label(normalized_detail, operation_id)

    def _complete_operation_progress(self, operation_id: str | None = None) -> None:
        resolved_id = self._resolve_operation_id(operation_id) or "__default__"
        with self._operation_progress_lock:
            state = self._operation_states.get(resolved_id)
            if state is not None:
                state["progress"] = 100.0
                state["active"] = False
                state["cancel_requested"] = False
                state["active_process"] = None
                state["paused"] = False
            self._operation_progress = 100.0
            self._operation_progress_active = False
            self._operation_progress_label = ""
            self._operation_cancel_requested = False

    def _reset_operation_progress(self, operation_id: str | None = None) -> None:
        resolved_id = self._resolve_operation_id(operation_id) or "__default__"
        with self._operation_progress_lock:
            self._operation_states.pop(resolved_id, None)
            self._operation_progress = 0.0
            self._operation_progress_active = False
            self._operation_progress_label = ""
            self._operation_cancel_requested = False

    def _mark_first_item_processed(self, operation_id: str | None = None) -> None:
        resolved_id = self._resolve_operation_id(operation_id) or "__default__"
        with self._operation_progress_lock:
            state = self._operation_states.get(resolved_id)
            if state is not None:
                state["first_item_processed"] = True

    def _get_first_item_processed(self, operation_id: str | None = None) -> bool:
        resolved_id = self._resolve_operation_id(operation_id) or "__default__"
        with self._operation_progress_lock:
            state = self._operation_states.get(resolved_id)
            return bool(state and state.get("first_item_processed", False))

    def _get_operation_target_dir(self, operation_id: str | None = None) -> str | None:
        resolved_id = self._resolve_operation_id(operation_id) or "__default__"
        with self._operation_progress_lock:
            state = self._operation_states.get(resolved_id)
            return state.get("target_dir") if state else None

    async def get_operation_progress(self, operation_id: str | None = None) -> dict:
        resolved_id = self._resolve_operation_id(operation_id) or "__default__"
        with self._operation_progress_lock:
            state = self._operation_states.get(resolved_id)
            if state is None:
                return {
                    "progress": 0.0,
                    "active": False,
                    "label": "",
                    "detail": "",
                    "paused": False,
                    "cancel_requested": False,
                    "first_item_processed": False,
                    "target_dir": None,
                }
            return {
                "progress": state.get("progress", 0.0),
                "active": state.get("active", False),
                "label": state.get("label", ""),
                "detail": state.get("detail", ""),
                "paused": state.get("paused", False),
                "cancel_requested": state.get("cancel_requested", False),
                "first_item_processed": state.get("first_item_processed", False),
                "target_dir": state.get("target_dir"),
            }

    async def cancel_operation(self, operation_id: str | None = None) -> dict:
        resolved_id = self._resolve_operation_id(operation_id) or "__default__"
        with self._operation_progress_lock:
            state = self._operation_states.get(resolved_id)
            process = state.get("active_process") if state is not None else None
            if state is not None:
                state["cancel_requested"] = True
                state["active_process"] = None
                state["active"] = False
            self._operation_cancel_requested = True
            self._active_operation_process = None

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

        return {"ok": True}

    async def pause_operation(self, operation_id: str | None = None) -> dict:
        resolved_id = self._resolve_operation_id(operation_id) or "__default__"
        self._set_operation_paused(True, resolved_id)
        return {"ok": True}

    async def resume_operation(self, operation_id: str | None = None) -> dict:
        resolved_id = self._resolve_operation_id(operation_id) or "__default__"
        self._set_operation_paused(False, resolved_id)
        return {"ok": True}

    async def _run_with_progress(self, label: str, worker, operation_id: str | None = None, target_dir: str | None = None) -> None:
        import asyncio
        
        resolved_id = self._resolve_operation_id(operation_id) or "__default__"
        with self._operation_progress_lock:
            state = self._operation_states.get(resolved_id)
            already_active = bool(state and state.get("active"))
        if not already_active:
            self._start_operation_progress(label, resolved_id, target_dir)
        token = self._current_operation_id.set(resolved_id)
        try:
            await asyncio.to_thread(worker)
            if not already_active:
                self._complete_operation_progress(resolved_id)
        except RuntimeError as exc:
            if str(exc) == "Operação cancelada":
                if not already_active:
                    self._reset_operation_progress(resolved_id)
                raise
            if not already_active:
                self._reset_operation_progress(resolved_id)
            raise
        except Exception:
            if not already_active:
                self._reset_operation_progress(resolved_id)
            raise
        finally:
            self._current_operation_id.reset(token)

    def _wait_if_paused(self, operation_id: str | None = None) -> None:
        resolved_id = self._resolve_operation_id(operation_id) or "__default__"
        while True:
            with self._operation_progress_lock:
                state = self._operation_states.get(resolved_id)
                cancelled = bool(state and state.get("cancel_requested"))
                paused = bool(state and state.get("paused"))
                process = state.get("active_process") if state is not None else None

            if cancelled:
                raise RuntimeError("Operação cancelada")
            if not paused:
                return
            if process is not None and process.poll() is None:
                try:
                    process.send_signal(signal.SIGSTOP)
                except (OSError, ProcessLookupError, ValueError):
                    pass
            time.sleep(0.05)

    def _check_operation_cancelled(self, operation_id: str | None = None) -> None:
        resolved_id = self._resolve_operation_id(operation_id) or "__default__"
        while True:
            with self._operation_progress_lock:
                state = self._operation_states.get(resolved_id)
                cancelled = bool(state and state.get("cancel_requested"))
                paused = bool(state and state.get("paused"))
                process = state.get("active_process") if state is not None else None
                if cancelled and state is not None:
                    state["active_process"] = None
                    state["active"] = False
                    self._operation_states.pop(resolved_id, None)

            if process is not None and cancelled and process.poll() is None:
                try:
                    process.terminate()
                    process.wait(timeout=5)
                except (OSError, subprocess.TimeoutExpired):
                    try:
                        process.kill()
                        process.wait(timeout=5)
                    except (OSError, subprocess.TimeoutExpired):
                        pass

            if cancelled:
                raise RuntimeError("Operação cancelada")
            if not paused:
                return
            if process is not None and process.poll() is None:
                try:
                    process.send_signal(signal.SIGSTOP)
                except (OSError, ProcessLookupError, ValueError):
                    pass
            time.sleep(0.05)
