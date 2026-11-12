import os
import unittest

from tests.backend.test_archives import make_zip
from tests.backend.support import PluginTestCase


class ListDirTests(PluginTestCase):
    def test_lists_sorted_with_dirs_first_and_metadata(self):
        self.write("b.txt", "bb")
        self.write("A.txt", "a")
        self.make_dir("zdir")
        self.make_dir("Adir")
        result = self.run_async(self.plugin.list_dir(self.work))
        self.assertEqual(result["path"], self.work)
        names = [item["name"] for item in result["items"]]
        self.assertEqual(names, ["Adir", "zdir", "A.txt", "b.txt"])
        file_entry = result["items"][3]
        self.assertEqual(file_entry["size"], 2)
        self.assertFalse(file_entry["is_dir"])
        self.assertIsNone(result["items"][0]["size"])

    def test_default_and_tilde_paths(self):
        self.assertEqual(self.run_async(self.plugin.list_dir("~"))["path"], self.home)
        self.assertEqual(self.run_async(self.plugin.list_dir(""))["path"], self.home)

    def test_errors_are_returned_in_band(self):
        missing = self.run_async(self.plugin.list_dir(self.path("nope")))
        self.assertFalse(missing["success"])
        denied_dir = self.make_dir("denied")
        os.chmod(denied_dir, 0)
        denied = self.run_async(self.plugin.list_dir(denied_dir))
        self.assertIn("permiss", denied["error"].lower())
        file = self.write("f.txt")
        self.assertFalse(self.run_async(self.plugin.list_dir(file))["success"])

    def test_symlinked_dir_counts_as_dir_and_broken_link_as_file(self):
        real = self.make_dir("real")
        os.symlink(real, self.path("good"))
        os.symlink(self.path("missing"), self.path("bad"))
        items = {i["name"]: i for i in self.run_async(self.plugin.list_dir(self.work))["items"]}
        self.assertTrue(items["good"]["is_dir"])
        self.assertFalse(items["bad"]["is_dir"])

    def test_remembers_last_path_in_runtime_file(self):
        self.run_async(self.plugin.list_dir(self.work))
        self.assertEqual(self.plugin._last_path, self.work)
        self.assertTrue(os.path.exists(self.plugin._runtime_file))


class CreateRenameTests(PluginTestCase):
    def test_create_folder(self):
        result = self.run_async(self.plugin.create_folder(self.work, "novo"))
        self.assertTrue(result["success"])
        self.assertTrue(os.path.isdir(self.path("novo")))

    def test_create_folder_validation(self):
        self.make_dir("existe")
        for name in ("", ".", "..", "a/b", "a\\b"):
            self.assertFalse(self.run_async(self.plugin.create_folder(self.work, name))["success"], name)
        self.assertIn("Já existe", self.run_async(self.plugin.create_folder(self.work, "existe"))["error"])
        self.assertFalse(self.run_async(self.plugin.create_folder(self.path("nope"), "x"))["success"])

    def test_rename_item_and_alias(self):
        self.write("a.txt", "A")
        result = self.run_async(self.plugin.rename_item(self.path("a.txt"), "b.txt"))
        self.assertEqual(result["new_path"], self.path("b.txt"))
        self.assertEqual(self.read("b.txt"), "A")
        alias = self.run_async(self.plugin.rename_path(self.path("b.txt"), "c.txt"))
        self.assertTrue(alias["success"])

    def test_rename_validation(self):
        self.write("a.txt")
        self.write("taken.txt")
        for name in ("", "..", "x/y"):
            self.assertFalse(self.run_async(self.plugin.rename_item(self.path("a.txt"), name))["success"], name)
        self.assertFalse(self.run_async(self.plugin.rename_item(self.path("missing"), "z"))["success"])
        self.assertFalse(self.run_async(self.plugin.rename_item(self.path("a.txt"), "taken.txt"))["success"])
        self.assertTrue(self.run_async(self.plugin.rename_item(self.path("a.txt"), "a.txt"))["success"])

    def test_rename_updates_clipboard_path(self):
        self.write("dir/inner.txt")
        self.run_async(self.plugin.copy_path(self.path("dir/inner.txt")))
        self.run_async(self.plugin.rename_item(self.path("dir"), "renamed"))
        self.assertEqual(self.plugin._clipboard_path, self.path("renamed/inner.txt"))


class DeleteTests(PluginTestCase):
    def test_delete_file_and_folder(self):
        self.write("f.txt")
        self.write("d/x/y.txt")
        self.assertTrue(self.run_async(self.plugin.delete_item(self.path("f.txt")))["success"])
        self.assertTrue(self.run_async(self.plugin.delete_item(self.path("d"), "Del", "op"))["success"])
        self.assertFalse(os.path.exists(self.path("d")))
        self.assertTrue(self.run_async(self.plugin.delete_path(self.write("g.txt")))["success"])

    def test_delete_symlink_keeps_target(self):
        target = self.write("real.txt")
        os.symlink(target, self.path("ln"))
        self.assertTrue(self.run_async(self.plugin.delete_item(self.path("ln")))["success"])
        self.assertTrue(os.path.exists(target))

    def test_delete_refusals(self):
        missing = self.run_async(self.plugin.delete_item(self.path("missing")))
        self.assertFalse(missing["success"])
        self.assertFalse(self.run_async(self.plugin.delete_item("/"))["success"])
        with self.assertRaises(ValueError):
            self.run_async(self.plugin.delete_item(""))

    def test_delete_reports_permission_error(self):
        locked = self.make_dir("locked")
        victim = self.write("locked/file.txt")
        os.chmod(locked, 0o555)
        result = self.run_async(self.plugin.delete_item(victim))
        self.assertFalse(result["success"])
        self.assertIn("permiss", result["error"].lower())

    def test_delete_cancelled(self):
        self.write("tree/a.txt")
        self.run_async(self.plugin.cancel_operation("opc"))
        result = self.run_async(self.plugin.delete_item(self.path("tree"), "Del", "opc"))
        self.assertTrue(result["cancelled"])
        self.assertTrue(os.path.exists(self.path("tree/a.txt")))

    def test_delete_clears_clipboard_pointing_inside(self):
        self.write("dir/f.txt")
        self.run_async(self.plugin.copy_path(self.path("dir/f.txt")))
        self.run_async(self.plugin.delete_item(self.path("dir")))
        self.assertIsNone(self.plugin._clipboard_path)


class ExtractArchiveTests(PluginTestCase):
    def test_extracts_into_named_folder(self):
        make_zip(self.path("many.zip"), {"a.txt": "1", "b.txt": "2"})
        result = self.run_async(self.plugin.extract_archive(self.path("many.zip"), self.work, "Ext", "op"))
        self.assertTrue(result["success"])
        self.assertEqual(result["new_path"], self.path("many"))
        self.assertEqual(self.read("many/a.txt"), "1")

    def test_single_root_is_not_nested(self):
        make_zip(self.path("proj.zip"), {"proj/a.txt": "1", "proj/b/c.txt": "2"})
        result = self.run_async(self.plugin.extract_archive(self.path("proj.zip"), self.work))
        self.assertEqual(result["new_path"], self.path("proj"))
        self.assertTrue(os.path.exists(self.path("proj/b/c.txt")))
        self.assertFalse(os.path.exists(self.path("proj/proj")))

    def test_second_extraction_does_not_overwrite(self):
        make_zip(self.path("proj.zip"), {"proj/a.txt": "new", "proj/b/c.txt": "2"})
        self.write("proj/a.txt", "existing")
        result = self.run_async(self.plugin.extract_archive(self.path("proj.zip"), self.work))
        self.assertEqual(result["new_path"], self.path("proj (1)"))
        self.assertEqual(self.read("proj/a.txt"), "existing")
        self.assertEqual(self.read("proj (1)/a.txt"), "new")

    def test_errors_and_cleanup(self):
        make_zip(self.path("evil.zip"), {"x/../../evil.txt": "e"})
        failed = self.run_async(self.plugin.extract_archive(self.path("evil.zip"), self.work))
        self.assertFalse(failed["success"])
        self.assertFalse(os.path.exists(self.path("evil")))
        self.assertFalse(self.run_async(self.plugin.extract_archive(self.path("none.zip"), self.work))["success"])
        self.write("notes.txt", "x")
        self.assertFalse(self.run_async(self.plugin.extract_archive(self.path("notes.txt"), self.work))["success"])
        self.assertFalse(self.run_async(self.plugin.extract_archive("", self.work))["success"])
        self.assertFalse(self.run_async(self.plugin.extract_archive(self.path("evil.zip"), ""))["success"])

    def test_cancelled_extraction_removes_partial_output(self):
        make_zip(self.path("big.zip"), {f"f{i}.txt": "x" * 100 for i in range(5)})
        self.run_async(self.plugin.cancel_operation("opx"))
        result = self.run_async(self.plugin.extract_archive(self.path("big.zip"), self.work, "Ext", "opx"))
        self.assertTrue(result["cancelled"])
        self.assertFalse(os.path.exists(self.path("big")))


if __name__ == "__main__":
    unittest.main()
