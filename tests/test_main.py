import asyncio
import io
import os
import tarfile
import tempfile
import types
import unittest
import zipfile
import sys

# Stub decky module during tests so main.py can import without Decky runtime.
_stub_runtime_dir = tempfile.TemporaryDirectory()
sys.modules["decky"] = types.SimpleNamespace(
    DECKY_PLUGIN_SETTINGS_DIR=_stub_runtime_dir.name,
    DECKY_PLUGIN_RUNTIME_DIR=_stub_runtime_dir.name,
    DECKY_HOME=_stub_runtime_dir.name,
    DECKY_USER_HOME=_stub_runtime_dir.name,
    logger=types.SimpleNamespace(info=lambda *args, **kwargs: None),
    migrate_logs=lambda *args, **kwargs: None,
    migrate_settings=lambda *args, **kwargs: None,
    migrate_runtime=lambda *args, **kwargs: None,
)

from main import Plugin


class TestMainPlugin(unittest.TestCase):
    def setUp(self):
        self.plugin = Plugin()

    def test_safe_extract_zip_rejects_path_traversal(self):
        with tempfile.TemporaryDirectory() as tempdir:
            archive_path = os.path.join(tempdir, "evil.zip")
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("../evil.txt", b"malicious")

            with self.assertRaises(ValueError):
                self.plugin._safe_extract_zip(archive_path, tempdir)

    def test_safe_extract_tar_rejects_path_traversal(self):
        with tempfile.TemporaryDirectory() as tempdir:
            archive_path = os.path.join(tempdir, "evil.tar")
            with tarfile.open(archive_path, "w") as archive:
                info = tarfile.TarInfo(name="../evil.txt")
                data = b"malicious"
                info.size = len(data)
                archive.addfile(info, fileobj=io.BytesIO(data))

            with self.assertRaises(ValueError):
                self.plugin._safe_extract_tar(archive_path, tempdir)

    def test_safe_extract_zip_progress(self):
        with tempfile.TemporaryDirectory() as tempdir:
            archive_path = os.path.join(tempdir, "large.zip")
            content = b"x" * (64 * 1024 * 3 + 123)
            with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_STORED) as archive:
                archive.writestr("large.txt", content)

            self.plugin._set_operation_state("Extracting")
            self.plugin._safe_extract_zip(archive_path, tempdir)

            self.assertEqual(self.plugin._operation_progress, 100)
            self.assertEqual(self.plugin._operation_label, "Extracting")
            self.assertFalse(self.plugin._operation_cancel_requested)
            self.assertTrue(os.path.exists(os.path.join(tempdir, "large.txt")))

    def test_safe_extract_tar_progress(self):
        with tempfile.TemporaryDirectory() as tempdir:
            archive_path = os.path.join(tempdir, "large.tar")
            data = b"x" * (64 * 1024 * 3 + 123)
            with tarfile.open(archive_path, "w") as archive:
                info = tarfile.TarInfo(name="large.txt")
                info.size = len(data)
                archive.addfile(info, fileobj=io.BytesIO(data))

            self.plugin._set_operation_state("Extracting")
            self.plugin._safe_extract_tar(archive_path, tempdir)

            self.assertEqual(self.plugin._operation_progress, 100)
            self.assertEqual(self.plugin._operation_label, "Extracting")
            self.assertFalse(self.plugin._operation_cancel_requested)
            self.assertTrue(os.path.exists(os.path.join(tempdir, "large.txt")))

    def test_copy_file_with_progress_cancel(self):
        with tempfile.TemporaryDirectory() as tempdir:
            src = os.path.join(tempdir, "source.bin")
            dst = os.path.join(tempdir, "dest.bin")
            with open(src, "wb") as f:
                f.write(b"x" * (64 * 1024 * 3 + 5))

            self.plugin._set_operation_state("Copying")
            self.plugin._operation_cancel_requested = True

            with self.assertRaises(asyncio.CancelledError):
                self.plugin._copy_file_with_progress(src, dst)

            self.assertTrue(self.plugin._operation_cancel_requested)
            self.assertFalse(os.path.exists(dst))

    def test_copy_tree_with_progress_cancel(self):
        with tempfile.TemporaryDirectory() as tempdir:
            src_dir = os.path.join(tempdir, "src")
            dst_dir = os.path.join(tempdir, "dst")
            os.makedirs(src_dir, exist_ok=True)
            file_path = os.path.join(src_dir, "file.txt")
            with open(file_path, "wb") as f:
                f.write(b"x" * (64 * 1024 * 3 + 5))

            self.plugin._set_operation_state("Copying")
            self.plugin._operation_cancel_requested = True

            with self.assertRaises(asyncio.CancelledError):
                self.plugin._copy_tree_with_progress(src_dir, dst_dir)

            self.assertTrue(self.plugin._operation_cancel_requested)
            self.assertFalse(os.path.exists(os.path.join(dst_dir, "file.txt")))


if __name__ == "__main__":
    unittest.main()
