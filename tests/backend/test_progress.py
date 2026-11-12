import subprocess
import sys
import threading
import time
import unittest

from backend.operations_progress import FINISHED_STATE_TTL, OperationCancelled, terminate_process
from tests.backend.support import PluginTestCase


class ProgressStateTests(PluginTestCase):
    def status(self, operation_id="op"):
        return self.run_async(self.plugin.get_operation_progress(operation_id))

    def test_unknown_operation_reports_known_false(self):
        status = self.status("nope")
        self.assertFalse(status["known"])
        self.assertFalse(status["active"])
        self.assertEqual(status["progress"], 0.0)

    def test_start_progress_and_clamping(self):
        self.plugin._start_operation_progress("Copiando", "op", "/dest")
        self.plugin._set_operation_progress(42.5, "op")
        status = self.status()
        self.assertTrue(status["known"] and status["active"])
        self.assertEqual(status["progress"], 42.5)
        self.assertEqual(status["target_dir"], "/dest")
        self.plugin._set_operation_progress(250, "op")
        self.assertEqual(self.status()["progress"], 100.0)
        self.plugin._set_operation_progress(-5, "op")
        self.assertEqual(self.status()["progress"], 0.0)

    def test_label_detail_composition(self):
        self.plugin._start_operation_progress("Copiando", "op")
        self.plugin._set_operation_progress_detail("/a/b/arquivo.txt", "op")
        status = self.status()
        self.assertEqual(status["detail"], "arquivo.txt")
        self.assertEqual(status["label"], "Copiando: arquivo.txt")
        self.plugin._set_operation_progress_detail("", "op")
        self.assertEqual(self.status()["label"], "Copiando")

    def test_detail_already_in_label_is_not_duplicated(self):
        self.plugin._start_operation_progress("Colar: foto.png", "op")
        self.plugin._set_operation_progress_detail("foto.png", "op")
        self.assertEqual(self.status()["label"], "Colar: foto.png")

    def test_sanitize_strips_trailing_ellipsis(self):
        self.assertEqual(self.plugin._sanitize_operation_text("Copiando...  "), "Copiando")
        self.assertEqual(self.plugin._sanitize_operation_text("a...: b"), "a: b")
        self.assertEqual(self.plugin._sanitize_operation_text(None), "")

    def test_first_item_processed_flag(self):
        self.plugin._start_operation_progress("x", "op")
        self.assertFalse(self.status()["first_item_processed"])
        self.plugin._mark_first_item_processed("op")
        self.assertTrue(self.status()["first_item_processed"])

    def test_complete_and_failed_finish(self):
        self.plugin._start_operation_progress("x", "ok")
        self.plugin._complete_operation_progress("ok")
        done = self.status("ok")
        self.assertFalse(done["active"])
        self.assertEqual(done["progress"], 100.0)
        self.assertFalse(done["failed"])

        self.plugin._start_operation_progress("x", "bad")
        self.plugin._set_operation_progress(30, "bad")
        self.plugin._finish_operation("bad", failed=True, error="boom")
        failed = self.status("bad")
        self.assertTrue(failed["failed"])
        self.assertEqual(failed["error"], "boom")
        self.assertEqual(failed["progress"], 30.0)

    def test_finished_states_are_purged_after_ttl(self):
        self.plugin._start_operation_progress("x", "old")
        self.plugin._finish_operation("old")
        self.plugin._operation_states["old"]["finished_at"] = time.monotonic() - FINISHED_STATE_TTL - 1
        self.plugin._start_operation_progress("y", "new")
        self.assertNotIn("old", self.plugin._operation_states)
        self.assertIn("new", self.plugin._operation_states)


class CancelPauseTests(PluginTestCase):
    def test_cancel_marks_state_and_check_raises(self):
        self.plugin._start_operation_progress("x", "op")
        self.assertTrue(self.run_async(self.plugin.cancel_operation("op"))["ok"])
        status = self.run_async(self.plugin.get_operation_progress("op"))
        self.assertTrue(status["cancel_requested"])
        self.assertFalse(status["active"])
        with self.assertRaises(OperationCancelled):
            self.plugin._check_operation_cancelled("op")

    def test_cancel_before_start_is_preserved(self):
        self.run_async(self.plugin.cancel_operation("early"))
        self.plugin._start_operation_progress("x", "early")
        with self.assertRaises(OperationCancelled):
            self.plugin._check_operation_cancelled("early")

    def test_pause_blocks_until_resume(self):
        self.plugin._start_operation_progress("x", "op")
        self.run_async(self.plugin.pause_operation("op"))
        self.assertTrue(self.run_async(self.plugin.get_operation_progress("op"))["paused"])
        released = threading.Event()

        def worker():
            self.plugin._check_operation_cancelled("op")
            released.set()

        thread = threading.Thread(target=worker, daemon=True)
        thread.start()
        self.assertFalse(released.wait(0.3))
        self.run_async(self.plugin.resume_operation("op"))
        self.assertTrue(released.wait(2))
        thread.join(1)

    def test_pause_without_state_is_noop(self):
        self.assertTrue(self.run_async(self.plugin.pause_operation("ghost"))["ok"])
        self.assertFalse(self.plugin._operation_states.get("ghost"))

    def test_wait_if_paused_delegates_to_cancel_check(self):
        self.plugin._start_operation_progress("x", "op")
        self.run_async(self.plugin.cancel_operation("op"))
        with self.assertRaises(OperationCancelled):
            self.plugin._wait_if_paused("op")


class RunWithProgressTests(PluginTestCase):
    def test_success_failure_and_cancel_states(self):
        self.run_async(self.plugin._run_with_progress("ok", lambda: None, "a", "/t"))
        self.assertEqual(self.run_async(self.plugin.get_operation_progress("a"))["progress"], 100.0)

        def failing():
            raise RuntimeError("quebrou")

        with self.assertRaises(RuntimeError):
            self.run_async(self.plugin._run_with_progress("f", failing, "b"))
        failed = self.run_async(self.plugin.get_operation_progress("b"))
        self.assertTrue(failed["failed"])
        self.assertEqual(failed["error"], "quebrou")

        def cancelled():
            raise OperationCancelled()

        with self.assertRaises(OperationCancelled):
            self.run_async(self.plugin._run_with_progress("c", cancelled, "c"))
        self.assertFalse(self.run_async(self.plugin.get_operation_progress("c"))["failed"])

    def test_context_var_resolves_current_operation(self):
        seen = {}

        def worker():
            self.plugin._set_operation_progress(55)
            seen["id"] = self.plugin._current_operation_id.get()

        self.run_async(self.plugin._run_with_progress("x", worker, "ctx"))
        self.assertEqual(seen["id"], "ctx")


class TerminateProcessTests(unittest.TestCase):
    def test_terminates_running_and_ignores_none(self):
        terminate_process(None)
        process = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        terminate_process(process)
        self.assertIsNotNone(process.poll())

    def test_terminates_stopped_process(self):
        import os
        import signal
        process = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        os.kill(process.pid, signal.SIGSTOP)
        terminate_process(process)
        self.assertIsNotNone(process.poll())


if __name__ == "__main__":
    unittest.main()
