import errno
import os
import unittest
from unittest import mock

from backend.operations_progress import OperationCancelled
from tests.backend.support import PluginTestCase


class PathHelperTests(PluginTestCase):
    def test_unique_target_path(self):
        self.write("a.txt")
        self.assertEqual(self.plugin._unique_target_path(self.path("new.txt")), self.path("new.txt"))
        self.assertEqual(self.plugin._unique_target_path(self.path("a.txt")), self.path("a (1).txt"))
        self.write("a (1).txt")
        self.assertEqual(self.plugin._unique_target_path(self.path("a.txt")), self.path("a (2).txt"))

    def test_unique_target_path_for_directories_keeps_dots(self):
        self.make_dir("pasta.v2")
        self.assertEqual(self.plugin._unique_target_path(self.path("pasta.v2")), self.path("pasta.v2 (1)"))

    def test_remove_path_handles_file_dir_symlink_and_missing(self):
        file = self.write("f.txt")
        folder = self.make_dir("d/inner")
        link = self.path("lnk")
        os.symlink(folder, link)
        for target in (file, link, self.path("d")):
            self.plugin._remove_path(target)
            self.assertFalse(os.path.lexists(target))
        self.assertTrue(os.path.isdir(folder) is False)
        self.plugin._remove_path(self.path("missing"))

    def test_subpath_and_safe_target(self):
        parent = self.make_dir("parent")
        child = self.make_dir("parent/child")
        other = self.make_dir("other")
        self.assertTrue(self.plugin._is_subpath(child, parent))
        self.assertTrue(self.plugin._is_self_or_subdirectory(parent, parent))
        self.assertFalse(self.plugin._is_subpath(other, parent))
        self.assertFalse(self.plugin._is_safe_target_for_path(child, parent))
        self.assertTrue(self.plugin._is_safe_target_for_path(other, parent))
        self.assertFalse(self.plugin._is_safe_target_for_path(self.path("nope"), parent))

    def test_symlink_to_dir_is_treated_as_item(self):
        real = self.make_dir("real")
        link = self.path("link")
        os.symlink(real, link)
        target = self.make_dir("target")
        self.assertTrue(self.plugin._is_safe_target_for_path(target, link))
        self.assertEqual(self.plugin._real_item_path(link), os.path.join(os.path.realpath(self.work), "link"))

    def test_normalize_and_validate_dir(self):
        self.assertEqual(self.plugin._normalize_dir("~"), self.home)
        self.assertEqual(self.plugin._normalize_dir(""), self.plugin._settings["default_path"])
        self.assertEqual(self.plugin._normalize_dir("/tmp/../tmp"), "/tmp")
        folder = self.make_dir("ok")
        file = self.write("file.txt")
        self.plugin._validate_exists_dir(folder)
        with self.assertRaises(FileNotFoundError):
            self.plugin._validate_exists_dir(self.path("missing"))
        with self.assertRaises(NotADirectoryError):
            self.plugin._validate_exists_dir(file)

    def test_stash_and_restore(self):
        original = self.write("doc.txt", "original")
        backup = self.plugin._stash_existing(original)
        self.assertFalse(os.path.exists(original))
        self.assertTrue(os.path.basename(backup).startswith(".doc.txt.dm-old-"))
        self.write("doc.txt", "partial")
        self.plugin._restore_stash(backup, original)
        self.assertEqual(self.read("doc.txt"), "original")


class CopyFileTests(PluginTestCase):
    def test_copies_content_metadata_and_progress(self):
        src = self.write("src.bin", b"a" * 3000)
        os.chmod(src, 0o640)
        dst = self.path("out/dst.bin")
        self.plugin._start_operation_progress("c", "op")
        self.plugin._copy_file_with_progress(src, dst, operation_id="op")
        self.assertEqual(self.read_abs(dst, True), b"a" * 3000)
        self.assertEqual(os.stat(dst).st_mode & 0o777, 0o640)
        status = self.run_async(self.plugin.get_operation_progress("op"))
        self.assertEqual(status["progress"], 100.0)
        self.assertTrue(status["first_item_processed"])

    def test_empty_file(self):
        src = self.write("empty", "")
        dst = self.path("empty-copy")
        self.plugin._copy_file_with_progress(src, dst)
        self.assertEqual(os.path.getsize(dst), 0)

    def test_symlink_is_recreated_not_followed(self):
        os.symlink("target-name", self.path("lnk"))
        self.plugin._copy_file_with_progress(self.path("lnk"), self.path("lnk2"))
        self.assertTrue(os.path.islink(self.path("lnk2")))
        self.assertEqual(os.readlink(self.path("lnk2")), "target-name")

    def test_special_files_are_rejected(self):
        os.mkfifo(self.path("fifo"))
        with self.assertRaises(ValueError):
            self.plugin._copy_file_with_progress(self.path("fifo"), self.path("fifo2"))

    def test_cancel_removes_partial_destination(self):
        src = self.write("big", b"z" * (3 * 1024 * 1024))
        dst = self.path("big-copy")
        self.plugin._start_operation_progress("c", "op")
        self.run_async(self.plugin.cancel_operation("op"))
        with self.assertRaises(OperationCancelled):
            self.plugin._copy_file_with_progress(src, dst, operation_id="op")
        self.assertFalse(os.path.exists(dst))

    def test_stream_copy(self):
        import io
        source, target = io.BytesIO(b"hello world"), io.BytesIO()
        self.plugin._copy_stream_with_progress(source, target, 11)
        self.assertEqual(target.getvalue(), b"hello world")


class CopyTreeTests(PluginTestCase):
    def make_tree(self):
        self.write("src/a.txt", "A")
        self.write("src/sub/.gitkeep", "")
        self.make_dir("src/sub/deep")
        os.symlink("a.txt", self.path("src/link.txt"))
        os.symlink("sub", self.path("src/linkdir"))
        os.symlink("missing", self.path("src/broken"))
        return self.path("src")

    def test_copies_everything_including_empty_files_and_links(self):
        src = self.make_tree()
        dst = self.path("dst")
        self.assertEqual(self.plugin._copy_tree_with_progress(src, dst), [])
        self.assertEqual(self.read_abs(os.path.join(dst, "a.txt")), "A")
        self.assertTrue(os.path.exists(os.path.join(dst, "sub", ".gitkeep")))
        self.assertTrue(os.path.isdir(os.path.join(dst, "sub", "deep")))
        for link in ("link.txt", "linkdir", "broken"):
            self.assertTrue(os.path.islink(os.path.join(dst, link)), link)

    def test_conflict_strategies(self):
        self.write("src/a.txt", "new")
        self.write("src/b.txt", "bnew")
        self.write("dst/a.txt", "old")
        self.write("dst/keep.txt", "keep")
        self.plugin._copy_tree_with_progress(self.path("src"), self.path("dst"), "merge")
        self.assertEqual(self.read("dst/a.txt"), "new")
        self.assertEqual(self.read("dst/keep.txt"), "keep")
        self.assertEqual(self.read("dst/b.txt"), "bnew")

        self.write("dst2/a.txt", "old")
        self.plugin._copy_tree_with_progress(self.path("src"), self.path("dst2"), "ignore")
        self.assertEqual(self.read("dst2/a.txt"), "old")

        self.write("dst3/a.txt", "old")
        self.plugin._copy_tree_with_progress(self.path("src"), self.path("dst3"), "keep-both")
        self.assertEqual(self.read("dst3/a.txt"), "old")
        self.assertEqual(self.read("dst3/a (1).txt"), "new")

        self.write("dst4/a.txt", "old")
        self.plugin._copy_tree_with_progress(self.path("src"), self.path("dst4"), "replace")
        self.assertEqual(self.read("dst4/a.txt"), "new")

    def test_cancel_strategy_and_invalid_strategy(self):
        self.write("src/a.txt", "n")
        self.write("dst/a.txt", "o")
        with self.assertRaises(OperationCancelled):
            self.plugin._copy_tree_with_progress(self.path("src"), self.path("dst"), "cancel")
        with self.assertRaises(ValueError):
            self.plugin._copy_tree_with_progress(self.path("src"), self.path("dst"), "bogus")

    def test_merge_file_over_directory_is_an_error(self):
        self.write("src/x", "file")
        self.make_dir("dst/x")
        with self.assertRaises(IsADirectoryError):
            self.plugin._copy_tree_with_progress(self.path("src"), self.path("dst"), "merge")

    def test_unreadable_files_are_skipped_or_raise(self):
        self.write("src/ok.txt", "ok")
        secret = self.write("src/secret.txt", "s")
        os.chmod(secret, 0)
        skipped = self.plugin._copy_tree_with_progress(self.path("src"), self.path("dst"), skip_unreadable=True)
        self.assertEqual([os.path.basename(p) for p in skipped], ["secret.txt"])
        self.assertTrue(os.path.exists(self.path("dst/ok.txt")))
        with self.assertRaises(PermissionError):
            self.plugin._copy_tree_with_progress(self.path("src"), self.path("dst-strict"))
        self.assertFalse(os.path.exists(self.path("dst-strict")))

    def test_cancel_cleans_a_new_destination(self):
        self.write("src/a.txt", "a")
        self.plugin._start_operation_progress("c", "op")
        self.run_async(self.plugin.cancel_operation("op"))
        with self.assertRaises(OperationCancelled):
            self.plugin._copy_tree_with_progress(self.path("src"), self.path("dst"), operation_id="op")
        self.assertFalse(os.path.exists(self.path("dst")))

    def test_scan_tree_counts_items(self):
        self.write("t/a", "12345")
        self.write("t/b", "")
        os.symlink("a", self.path("t/l"))
        weight, count = self.plugin._scan_tree(self.path("t"))
        self.assertEqual(count, 3)
        self.assertGreaterEqual(weight, 7)


class MoveTests(PluginTestCase):
    def test_rename_within_same_filesystem(self):
        src = self.write("a.txt", "A")
        self.plugin._move_path_with_progress(src, self.path("b.txt"))
        self.assertFalse(os.path.exists(src))
        self.assertEqual(self.read("b.txt"), "A")

    def test_cross_device_falls_back_to_copy_and_delete(self):
        self.write("srcdir/a.txt", "A")
        exdev = OSError(errno.EXDEV, "cross-device")
        with mock.patch("backend.file_ops.os.rename", side_effect=exdev):
            self.plugin._move_path_with_progress(self.path("srcdir"), self.path("dstdir"))
            self.write("single.txt", "S")
            self.plugin._move_path_with_progress(self.path("single.txt"), self.path("moved.txt"))
        self.assertFalse(os.path.exists(self.path("srcdir")))
        self.assertEqual(self.read("dstdir/a.txt"), "A")
        self.assertEqual(self.read("moved.txt"), "S")

    def test_other_errors_propagate(self):
        self.write("a", "x")
        with mock.patch("backend.file_ops.os.rename", side_effect=PermissionError("no")):
            with self.assertRaises(PermissionError):
                self.plugin._move_path_with_progress(self.path("a"), self.path("b"))

    def test_merge_move(self):
        self.write("src/new.txt", "n")
        self.write("dst/old.txt", "o")
        self.plugin._merge_move_with_progress(self.path("src"), self.path("dst"))
        self.assertFalse(os.path.exists(self.path("src")))
        self.assertEqual(sorted(os.listdir(self.path("dst"))), ["new.txt", "old.txt"])


class DeleteTests(PluginTestCase):
    def test_delete_file_and_tree_with_symlinked_dir(self):
        file = self.write("f.txt")
        self.plugin._delete_path_with_progress(file)
        self.assertFalse(os.path.exists(file))

        target = self.make_dir("elsewhere")
        self.write("tree/x/y.txt", "1")
        os.symlink(target, self.path("tree/x/ln"))
        self.plugin._start_operation_progress("d", "op")
        self.plugin._delete_tree_with_progress(self.path("tree"), "op")
        self.assertFalse(os.path.exists(self.path("tree")))
        self.assertTrue(os.path.isdir(target))
        self.assertEqual(self.run_async(self.plugin.get_operation_progress("op"))["progress"], 100.0)

    def test_delete_tree_cancel(self):
        self.write("tree/a.txt", "1")
        self.plugin._start_operation_progress("d", "op")
        self.run_async(self.plugin.cancel_operation("op"))
        with self.assertRaises(OperationCancelled):
            self.plugin._delete_tree_with_progress(self.path("tree"), "op")
        self.assertTrue(os.path.exists(self.path("tree/a.txt")))


if __name__ == "__main__":
    unittest.main()
