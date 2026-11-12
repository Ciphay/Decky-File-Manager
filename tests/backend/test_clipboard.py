import os
import unittest
from unittest import mock

from tests.backend.support import PluginTestCase


class ClipboardStateTests(PluginTestCase):
    def test_copy_cut_and_queries(self):
        file = self.write("a.txt")
        self.assertFalse(self.run_async(self.plugin.has_clipboard())["has"])
        self.run_async(self.plugin.copy_path(file))
        self.assertTrue(self.run_async(self.plugin.has_clipboard())["has"])
        self.assertEqual(self.run_async(self.plugin.get_clipboard_kind())["kind"], "copy")
        status = self.run_async(self.plugin.copy_or_cut_status())
        self.assertEqual(status, {"has": True, "kind": "copy", "path": file})
        self.assertEqual(self.run_async(self.plugin.get_clipboard_info()), status)
        self.run_async(self.plugin.cut_path(file))
        self.assertEqual(self.plugin._clipboard_kind, "cut")

    def test_invalid_sources(self):
        with self.assertRaises(ValueError):
            self.run_async(self.plugin.copy_path(""))
        with self.assertRaises(FileNotFoundError):
            self.run_async(self.plugin.cut_path(self.path("missing")))

    def test_state_persists_across_instances(self):
        file = self.write("keep.txt")
        self.run_async(self.plugin.cut_path(file))
        from backend import Plugin
        reloaded = Plugin()
        self.assertEqual(reloaded._clipboard_path, file)
        self.assertEqual(reloaded._clipboard_kind, "cut")

    def test_has_clipboard_drops_a_vanished_item(self):
        file = self.write("gone.txt")
        self.run_async(self.plugin.copy_path(file))
        os.remove(file)
        self.assertFalse(self.run_async(self.plugin.has_clipboard())["has"])
        self.assertIsNone(self.plugin._clipboard_path)

    def test_clear_clipboard(self):
        self.run_async(self.plugin.copy_path(self.write("x")))
        self.plugin._clear_clipboard()
        self.assertIsNone(self.plugin._clipboard_kind)


class PasteConflictTests(PluginTestCase):
    def test_empty_and_missing_clipboard(self):
        dest = self.make_dir("dest")
        with self.assertRaises(ValueError):
            self.run_async(self.plugin.check_paste_conflict(dest))
        file = self.write("a.txt")
        self.run_async(self.plugin.copy_path(file))
        os.remove(file)
        with self.assertRaises(FileNotFoundError):
            self.run_async(self.plugin.check_paste_conflict(dest))

    def test_conflict_detection(self):
        self.write("src/a.txt")
        dest = self.make_dir("dest")
        self.run_async(self.plugin.copy_path(self.path("src/a.txt")))
        free = self.run_async(self.plugin.check_paste_conflict(dest))
        self.assertEqual((free["blocked"], free["needs_conflict"]), (False, False))
        self.write("dest/a.txt")
        taken = self.run_async(self.plugin.check_paste_conflict(dest))
        self.assertTrue(taken["needs_conflict"])
        self.assertFalse(taken["is_dir"])

    def test_directory_conflict_flag(self):
        self.make_dir("src/folder")
        self.make_dir("dest/folder")
        self.run_async(self.plugin.copy_path(self.path("src/folder")))
        self.assertTrue(self.run_async(self.plugin.check_paste_conflict(self.path("dest")))["is_dir"])

    def test_blocked_targets(self):
        folder = self.make_dir("folder")
        inner = self.make_dir("folder/inner")
        self.run_async(self.plugin.copy_path(folder))
        into_self = self.run_async(self.plugin.check_paste_conflict(inner))
        self.assertTrue(into_self["blocked"])
        self.assertEqual(into_self["reason"], "self-directory")
        self.run_async(self.plugin.cut_path(folder))
        same_parent = self.run_async(self.plugin.check_paste_conflict(self.work))
        self.assertEqual(same_parent["reason"], "same-directory")


class PasteTests(PluginTestCase):
    def paste(self, dest, strategy="keep-both", op="op"):
        return self.run_async(self.plugin.paste_path_with_options(dest, strategy, False, "Copy", "Move", op))

    def test_copy_file_and_clipboard_cleared(self):
        self.write("src/a.txt", "A")
        dest = self.make_dir("dest")
        self.run_async(self.plugin.copy_path(self.path("src/a.txt")))
        result = self.paste(dest)
        self.assertTrue(result["success"])
        self.assertEqual(self.read("dest/a.txt"), "A")
        self.assertTrue(os.path.exists(self.path("src/a.txt")))
        self.assertIsNone(self.plugin._clipboard_path)
        self.assertEqual(result["skipped_count"], 0)

    def test_cut_moves(self):
        self.write("src/a.txt", "A")
        dest = self.make_dir("dest")
        self.run_async(self.plugin.cut_path(self.path("src/a.txt")))
        self.paste(dest)
        self.assertFalse(os.path.exists(self.path("src/a.txt")))
        self.assertEqual(self.read("dest/a.txt"), "A")

    def test_copy_directory_tree(self):
        self.write("src/dir/x/y.txt", "Y")
        self.make_dir("src/dir/empty")
        dest = self.make_dir("dest")
        self.run_async(self.plugin.copy_path(self.path("src/dir")))
        self.paste(dest)
        self.assertEqual(self.read("dest/dir/x/y.txt"), "Y")
        self.assertTrue(os.path.isdir(self.path("dest/dir/empty")))

    def test_keep_both_replace_ignore_cancel(self):
        self.write("src/a.txt", "new")
        self.write("dest/a.txt", "old")
        self.run_async(self.plugin.copy_path(self.path("src/a.txt")))
        self.assertTrue(self.paste(self.path("dest"), "keep-both")["success"])
        self.assertEqual(self.read("dest/a (1).txt"), "new")

        self.run_async(self.plugin.copy_path(self.path("src/a.txt")))
        self.assertTrue(self.paste(self.path("dest"), "replace")["success"])
        self.assertEqual(self.read("dest/a.txt"), "new")
        self.assertEqual([n for n in os.listdir(self.path("dest")) if "dm-old" in n], [])

        self.write("dest/a.txt", "keep me")
        self.run_async(self.plugin.copy_path(self.path("src/a.txt")))
        self.assertTrue(self.paste(self.path("dest"), "ignore")["skipped"])
        self.assertEqual(self.read("dest/a.txt"), "keep me")
        self.assertTrue(self.paste(self.path("dest"), "cancel")["cancelled"])
        self.assertTrue(self.plugin._clipboard_path)

    def test_invalid_strategy_is_reported(self):
        self.write("src/a.txt")
        self.write("dest/a.txt")
        self.run_async(self.plugin.copy_path(self.path("src/a.txt")))
        result = self.paste(self.path("dest"), "bogus")
        self.assertFalse(result["success"])

    def test_merge_directories(self):
        self.write("src/dir/new.txt", "n")
        self.write("src/dir/shared.txt", "from-src")
        self.write("dest/dir/shared.txt", "old")
        self.write("dest/dir/old.txt", "o")
        self.run_async(self.plugin.copy_path(self.path("src/dir")))
        self.assertTrue(self.paste(self.path("dest"), "merge")["success"])
        self.assertEqual(self.read("dest/dir/shared.txt"), "from-src")
        self.assertEqual(sorted(os.listdir(self.path("dest/dir"))), ["new.txt", "old.txt", "shared.txt"])
        self.assertTrue(os.path.exists(self.path("src/dir/new.txt")))

    def test_merge_requires_directories(self):
        self.write("src/x", "f")
        self.write("dest/x", "g")
        self.run_async(self.plugin.copy_path(self.path("src/x")))
        self.assertFalse(self.paste(self.path("dest"), "merge")["success"])

    def test_cut_merge_removes_source(self):
        self.write("src/dir/a.txt", "a")
        self.write("dest/dir/b.txt", "b")
        self.run_async(self.plugin.cut_path(self.path("src/dir")))
        self.assertTrue(self.paste(self.path("dest"), "merge")["success"])
        self.assertFalse(os.path.exists(self.path("src/dir")))
        self.assertEqual(sorted(os.listdir(self.path("dest/dir"))), ["a.txt", "b.txt"])

    def test_replace_restores_original_when_copy_fails(self):
        self.write("src/a.txt", "new")
        self.write("dest/a.txt", "precious")
        self.run_async(self.plugin.copy_path(self.path("src/a.txt")))
        with mock.patch.object(type(self.plugin), "_copy_file_with_progress", side_effect=OSError("disk full")):
            result = self.paste(self.path("dest"), "replace")
        self.assertFalse(result["success"])
        self.assertEqual(self.read("dest/a.txt"), "precious")
        self.assertEqual([n for n in os.listdir(self.path("dest")) if "dm-old" in n], [])

    def test_unreadable_files_are_reported_as_skipped(self):
        self.write("src/dir/ok.txt", "ok")
        os.chmod(self.write("src/dir/secret.txt", "s"), 0)
        self.run_async(self.plugin.copy_path(self.path("src/dir")))
        result = self.paste(self.make_dir("dest"))
        self.assertTrue(result["success"])
        self.assertEqual(result["skipped_count"], 1)
        self.assertEqual(result["skipped_items"], ["secret.txt"])

    def test_single_unreadable_file_is_an_in_band_error(self):
        os.chmod(self.write("src/secret.txt", "s"), 0)
        self.run_async(self.plugin.copy_path(self.path("src/secret.txt")))
        result = self.paste(self.make_dir("dest"))
        self.assertFalse(result["success"])
        self.assertIn("permiss", result["error"].lower())
        self.assertFalse(os.path.exists(self.path("dest/secret.txt")))

    def test_pasting_onto_itself_is_skipped_and_cut_into_child_refused(self):
        self.write("dir/a.txt")
        self.run_async(self.plugin.copy_path(self.path("dir")))
        self.assertTrue(self.paste(self.work, "replace")["skipped"])
        self.assertTrue(os.path.exists(self.path("dir/a.txt")))
        self.run_async(self.plugin.cut_path(self.path("dir")))
        self.assertFalse(self.paste(self.path("dir"))["success"])

    def test_cancelled_paste_leaves_no_partial_file(self):
        self.write("src/big.bin", b"b" * (2 << 20))
        self.run_async(self.plugin.copy_path(self.path("src/big.bin")))
        self.run_async(self.plugin.cancel_operation("opc"))
        result = self.paste(self.make_dir("dest"), op="opc")
        self.assertTrue(result["cancelled"])
        self.assertFalse(os.path.exists(self.path("dest/big.bin")))
        self.assertTrue(self.plugin._clipboard_path)

    def test_paste_without_clipboard_and_alias(self):
        result = self.run_async(self.plugin.paste_path_with_options(self.work))
        self.assertFalse(result["success"])
        self.write("a.txt", "x")
        self.run_async(self.plugin.copy_path(self.path("a.txt")))
        self.assertTrue(self.run_async(self.plugin.paste_path(self.make_dir("d")))["success"])


if __name__ == "__main__":
    unittest.main()
