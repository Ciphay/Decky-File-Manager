import os
import sys
import unittest
from unittest import mock

from tests.backend.support import PluginTestCase


class UserHomeTests(PluginTestCase):
    def test_prefers_decky_user_home(self):
        from backend.paths import user_home
        self.assertEqual(user_home(), self.home)

    def test_falls_back_to_environment_then_expanduser(self):
        import sys
        from backend import paths
        stub = sys.modules.pop("decky")
        with mock.patch.dict(os.environ, {"DECKY_USER_HOME": self.base}):
            self.assertEqual(paths.user_home(), self.base)
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("DECKY_USER_HOME", None)
            self.assertTrue(os.path.isdir(paths.user_home()))
        sys.modules["decky"] = stub

    def test_expand_user_path(self):
        from backend.paths import expand_user_path
        self.assertEqual(expand_user_path("~"), self.home)
        self.assertEqual(expand_user_path("~/docs"), os.path.join(self.home, "docs"))
        self.assertEqual(expand_user_path("/abs/path"), "/abs/path")
        self.assertEqual(expand_user_path(None), "")
        self.assertEqual(expand_user_path("  "), "")


class AsResultTests(PluginTestCase):
    def test_wraps_success_and_failures(self):
        from backend.operations_progress import OperationCancelled
        from backend.results import as_result

        @as_result
        async def ok():
            return {"ok": True}

        @as_result
        async def boom():
            raise ValueError("falhou")

        @as_result
        async def cancelled():
            raise OperationCancelled()

        @as_result
        async def silent():
            raise KeyError()

        self.assertEqual(self.run_async(ok()), {"ok": True})
        failed = self.run_async(boom())
        self.assertFalse(failed["success"])
        self.assertEqual(failed["error"], "falhou")
        self.assertTrue(self.run_async(cancelled())["cancelled"])
        self.assertEqual(self.run_async(silent())["error"], "KeyError")


if __name__ == "__main__":
    unittest.main()
