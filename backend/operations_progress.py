import os
import re
import signal
import subprocess
import time

FINISHED_STATE_TTL = 120.0


class OperationCancelled(RuntimeError):
    def __init__(self, message: str = "Operação cancelada"):
        super().__init__(message)


def terminate_process(process: subprocess.Popen | None) -> None:
    if process is None or process.poll() is not None:
        return
    try:
        process.send_signal(signal.SIGCONT)
    except (OSError, ProcessLookupError, ValueError):
        pass
    try:
        process.terminate()
        process.wait(timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        try:
            process.kill()
            process.wait(timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            pass


class OperationsProgress:

    def _resolve_operation_id(self, operation_id: str | None = None) -> str:
        if operation_id is not None:
            return operation_id
        return self._current_operation_id.get() or "__default__"

    def _new_operation_state(self) -> dict:
        return {
            "progress": 0.0,
            "active": False,
            "label": "",
            "detail": "",
            "cancel_requested": False,
            "paused": False,
            "active_process": None,
            "first_item_processed": False,
            "target_dir": None,
            "failed": False,
            "error": "",
            "finished_at": None,
        }

    def _get_operation_state(self, operation_id: str | None = None) -> dict:
        resolved_id = self._resolve_operation_id(operation_id)
        state = self._operation_states.get(resolved_id)
        if state is None:
            state = self._new_operation_state()
            self._operation_states[resolved_id] = state
        return state

    def _purge_finished_states(self) -> None:
        now = time.monotonic()
        stale = [
            key for key, state in self._operation_states.items()
            if state.get("finished_at") is not None and now - state["finished_at"] > FINISHED_STATE_TTL
        ]
        for key in stale:
            self._operation_states.pop(key, None)

    def _set_operation_state_active_process(self, process: subprocess.Popen | None, operation_id: str | None = None) -> None:
        with self._operation_progress_lock:
            self._get_operation_state(operation_id)["active_process"] = process

    def _clear_operation_state_active_process(self, process: subprocess.Popen | None, operation_id: str | None = None) -> None:
        with self._operation_progress_lock:
            state = self._get_operation_state(operation_id)
            if state.get("active_process") is process:
                state["active_process"] = None

    def _start_operation_progress(self, label: str = "", operation_id: str | None = None, target_dir: str | None = None) -> None:
        with self._operation_progress_lock:
            self._purge_finished_states()
            state = self._get_operation_state(operation_id)
            cancel_before_start = bool(state.get("cancel_requested"))
            state.update(self._new_operation_state())
            state["active"] = True
            state["label"] = label
            state["target_dir"] = target_dir
            state["cancel_requested"] = cancel_before_start

    def _set_operation_progress(self, progress: float, operation_id: str | None = None) -> None:
        with self._operation_progress_lock:
            state = self._get_operation_state(operation_id)
            state["progress"] = max(0.0, min(100.0, progress))

    def _set_operation_paused(self, paused: bool, operation_id: str | None = None) -> None:
        resolved_id = self._resolve_operation_id(operation_id)
        with self._operation_progress_lock:
            state = self._operation_states.get(resolved_id)
            if state is None:
                return
            state["paused"] = paused
            process = state.get("active_process")
        if process is not None and process.poll() is None:
            try:
                process.send_signal(signal.SIGSTOP if paused else signal.SIGCONT)
            except (OSError, ProcessLookupError, ValueError):
                pass

    def _sanitize_operation_text(self, value: str | None) -> str:
        text = (value or "").strip()
        text = re.sub(r"(?:\s*[.]{1,3}\s*)(?=(?:[:\-]|$))", "", text)
        return re.sub(r"\s{2,}", " ", text).strip()

    def _set_operation_progress_label(self, label: str, operation_id: str | None = None) -> None:
        sanitized = self._sanitize_operation_text(label)
        with self._operation_progress_lock:
            self._get_operation_state(operation_id)["label"] = sanitized

    def _get_operation_label_base(self, operation_id: str | None = None) -> str:
        with self._operation_progress_lock:
            label = str(self._get_operation_state(operation_id).get("label") or "")
        return label.split(":", 1)[0].strip()

    def _normalize_operation_detail(self, detail: str) -> str:
        detail = (detail or "").strip()
        if "/" in detail or "\\" in detail:
            return os.path.basename(detail.rstrip("/\\"))
        return detail

    def _set_operation_progress_detail(self, detail: str, operation_id: str | None = None) -> None:
        normalized = self._normalize_operation_detail(detail)
        with self._operation_progress_lock:
            self._get_operation_state(operation_id)["detail"] = self._sanitize_operation_text(normalized)

        base_label = self._get_operation_label_base(operation_id)
        if not normalized or normalized in base_label:
            self._set_operation_progress_label(base_label, operation_id)
        elif base_label:
            self._set_operation_progress_label(f"{base_label}: {normalized}", operation_id)
        else:
            self._set_operation_progress_label(normalized, operation_id)

    def _finish_operation(self, operation_id: str | None, failed: bool = False, error: str = "") -> None:
        with self._operation_progress_lock:
            state = self._operation_states.get(self._resolve_operation_id(operation_id))
            if state is None:
                return
            if not failed and not state.get("cancel_requested"):
                state["progress"] = 100.0
            state["active"] = False
            state["paused"] = False
            state["active_process"] = None
            state["failed"] = failed
            state["error"] = error
            state["finished_at"] = time.monotonic()

    def _complete_operation_progress(self, operation_id: str | None = None) -> None:
        self._finish_operation(operation_id)

    def _mark_first_item_processed(self, operation_id: str | None = None) -> None:
        resolved_id = self._resolve_operation_id(operation_id)
        with self._operation_progress_lock:
            state = self._operation_states.get(resolved_id)
            if state is not None:
                state["first_item_processed"] = True

    async def get_operation_progress(self, operation_id: str | None = None) -> dict:
        resolved_id = self._resolve_operation_id(operation_id)
        with self._operation_progress_lock:
            state = self._operation_states.get(resolved_id)
            known = state is not None
            if state is None:
                state = self._new_operation_state()
            return {
                "known": known,
                "progress": state["progress"],
                "active": state["active"],
                "label": state["label"],
                "detail": state["detail"],
                "paused": state["paused"],
                "cancel_requested": state["cancel_requested"],
                "first_item_processed": state["first_item_processed"],
                "target_dir": state["target_dir"],
                "failed": state["failed"],
                "error": state["error"],
            }

    async def cancel_operation(self, operation_id: str | None = None) -> dict:
        resolved_id = self._resolve_operation_id(operation_id)
        with self._operation_progress_lock:
            state = self._get_operation_state(resolved_id)
            process = state.get("active_process")
            state["cancel_requested"] = True
            state["active_process"] = None
            state["paused"] = False
            if state.get("active"):
                state["active"] = False
                state["finished_at"] = time.monotonic()

        terminate_process(process)
        return {"ok": True}

    async def pause_operation(self, operation_id: str | None = None) -> dict:
        self._set_operation_paused(True, operation_id)
        return {"ok": True}

    async def resume_operation(self, operation_id: str | None = None) -> dict:
        self._set_operation_paused(False, operation_id)
        return {"ok": True}

    async def _run_with_progress(self, label: str, worker, operation_id: str | None = None, target_dir: str | None = None) -> None:
        import asyncio

        resolved_id = self._resolve_operation_id(operation_id)
        with self._operation_progress_lock:
            state = self._operation_states.get(resolved_id)
            already_active = bool(state and state.get("active"))
        if not already_active:
            self._start_operation_progress(label, resolved_id, target_dir)

        token = self._current_operation_id.set(resolved_id)
        try:
            await asyncio.to_thread(worker)
        except OperationCancelled:
            if not already_active:
                self._finish_operation(resolved_id)
            raise
        except Exception as exc:
            if not already_active:
                self._finish_operation(resolved_id, failed=True, error=str(exc))
            raise
        else:
            if not already_active:
                self._complete_operation_progress(resolved_id)
        finally:
            self._current_operation_id.reset(token)

    def _check_operation_cancelled(self, operation_id: str | None = None) -> None:
        resolved_id = self._resolve_operation_id(operation_id)
        while True:
            with self._operation_progress_lock:
                state = self._operation_states.get(resolved_id)
                cancelled = bool(state and state.get("cancel_requested"))
                paused = bool(state and state.get("paused"))
                process = state.get("active_process") if state is not None else None
                if cancelled and state is not None:
                    state["active_process"] = None

            if cancelled:
                terminate_process(process)
                raise OperationCancelled()
            if not paused:
                return
            time.sleep(0.05)

    def _wait_if_paused(self, operation_id: str | None = None) -> None:
        self._check_operation_cancelled(operation_id)
