import json
import os
import unittest

from tests.backend.support import PluginTestCase


class PropertiesTests(PluginTestCase):
    def test_file_properties(self):
        file = self.write("a.txt", "12345")
        props = self.run_async(self.plugin.get_properties(file))
        self.assertEqual((props["name"], props["type"], props["size"]), ("a.txt", "file", 5))
        self.assertEqual(props["permissions"]["owner"], self.plugin._collect_properties(file)["permissions"]["owner"])
        self.assertFalse(props["permissions"]["immutable"])
        self.assertTrue(props["permissions"]["raw"].startswith("0o"))
        self.assertGreater(props["modified"], 0)
        self.assertEqual(self.run_async(self.plugin.get_properties_item(file))["name"], "a.txt")

    def test_folder_properties_and_size(self):
        self.write("d/a", "1234")
        self.write("d/s/b", "123456")
        os.symlink(self.path("d/a"), self.path("d/link"))
        props = self.run_async(self.plugin.get_properties(self.path("d")))
        self.assertEqual((props["type"], props["size"]), ("folder", None))
        size = self.run_async(self.plugin.get_directory_size(self.path("d")))
        self.assertEqual(size["size"], 10)

    def test_directory_size_of_a_file_and_errors(self):
        file = self.write("f", "x")
        self.assertIsNone(self.run_async(self.plugin.get_directory_size(file))["size"])
        with self.assertRaises(FileNotFoundError):
            self.run_async(self.plugin.get_directory_size(self.path("none")))
        with self.assertRaises(ValueError):
            self.run_async(self.plugin.get_properties(""))
        with self.assertRaises(FileNotFoundError):
            self.run_async(self.plugin.get_properties(self.path("none")))

    def test_unreadable_subdirectories_are_ignored_in_size(self):
        self.write("d/ok", "123")
        locked = self.make_dir("d/locked")
        self.write("d/locked/hidden", "9999")
        os.chmod(locked, 0)
        self.assertEqual(self.run_async(self.plugin.get_directory_size(self.path("d")))["size"], 3)

    def test_unknown_owner_falls_back_to_uid(self):
        from backend.properties import _owner_name
        self.assertEqual(_owner_name(4242424), "4242424")
        self.assertEqual(_owner_name(0), "root")


class FilePickerTests(PluginTestCase):
    def test_set_file_selection_writes_result_file(self):
        result_file = self.path("out/result.json")
        result = self.plugin.set_file_selection("/some/file", result_file)
        self.assertTrue(result["success"])
        with open(result_file) as handle:
            self.assertEqual(json.load(handle), {"selected_file": "/some/file"})
        self.assertEqual(self.plugin._selected_file, "/some/file")

    def test_set_file_selection_without_result_file_and_bad_targets(self):
        self.assertTrue(self.plugin.set_file_selection("/f")["success"])
        self.make_dir("adir")
        self.assertFalse(self.plugin.set_file_selection("/f", self.path("adir"))["success"])
        os.symlink(self.write("target"), self.path("ln"))
        self.assertFalse(self.plugin.set_file_selection("/f", self.path("ln"))["success"])

    def test_open_file_picker_urls(self):
        url = self.run_async(self.plugin.open_file_picker("/a b", "/tmp/r.json"))["url"]
        self.assertTrue(url.startswith("/steam-os-file-manager/select?path=/a%20b"))
        self.assertIn("resultFile=/tmp/r.json", url)
        self.assertNotIn("resultFile", self.run_async(self.plugin.open_file_picker("/x"))["url"])
        self.assertIn("select-file", self.run_async(self.plugin.open_file_picker_for_game("/y"))["url"])

    def test_validate_executable(self):
        exe = self.write("Game.AppImage")
        ok = self.run_async(self.plugin.validate_executable(exe))
        self.assertEqual((ok["success"], ok["name"]), (True, "game"))
        self.assertFalse(self.run_async(self.plugin.validate_executable(self.path("none")))["success"])
        self.assertFalse(self.run_async(self.plugin.validate_executable(self.work))["success"])
        self.assertFalse(self.run_async(self.plugin.validate_executable(""))["success"])


class LifecycleTests(PluginTestCase):
    def test_settings_default_and_load(self):
        self.assertEqual(self.plugin._settings["default_path"], self.home)
        os.makedirs(os.path.dirname(self.plugin._settings_file), exist_ok=True)
        with open(self.plugin._settings_file, "w") as handle:
            json.dump({"default_path": "~/Games"}, handle)
        self.plugin._load_settings()
        self.assertEqual(self.plugin._settings["default_path"], os.path.join(self.home, "Games"))

    def test_corrupt_settings_fall_back(self):
        os.makedirs(os.path.dirname(self.plugin._settings_file), exist_ok=True)
        with open(self.plugin._settings_file, "w") as handle:
            handle.write("{not json")
        self.plugin._load_settings()
        self.assertEqual(self.plugin._settings["default_path"], self.home)

    def test_save_settings_roundtrip(self):
        self.plugin._settings["default_path"] = "/data"
        self.plugin._save_settings()
        with open(self.plugin._settings_file) as handle:
            self.assertEqual(json.load(handle)["default_path"], "/data")

    def test_runtime_state_roundtrip_and_validation(self):
        file = self.write("clip.txt")
        self.plugin._clipboard_path, self.plugin._clipboard_kind, self.plugin._last_path = file, "cut", self.work
        self.plugin._save_runtime_state()
        self.plugin._clipboard_path = self.plugin._clipboard_kind = self.plugin._last_path = None
        self.plugin._load_runtime_state()
        self.assertEqual((self.plugin._clipboard_path, self.plugin._clipboard_kind, self.plugin._last_path), (file, "cut", self.work))
        with open(self.plugin._runtime_file, "w") as handle:
            json.dump({"clipboard": {"path": "/nonexistent", "kind": "cut"}, "last_path": "/nonexistent"}, handle)
        self.plugin._load_runtime_state()
        self.assertIsNone(self.plugin._clipboard_path)
        self.assertIsNone(self.plugin._last_path)
        with open(self.plugin._runtime_file, "w") as handle:
            json.dump({"clipboard": {"path": file, "kind": "bogus"}}, handle)
        self.plugin._load_runtime_state()
        self.assertIsNone(self.plugin._clipboard_kind)

    def test_atomic_json_write_leaves_no_temp_files(self):
        target = self.path("cfg/x.json")
        self.plugin._write_json_atomic(target, {"a": 1})
        self.assertEqual(os.listdir(self.path("cfg")), ["x.json"])
        with self.assertRaises(TypeError):
            self.plugin._write_json_atomic(target, {"bad": object()})
        self.assertEqual(os.listdir(self.path("cfg")), ["x.json"])

    def test_read_file_content(self):
        file = self.write("t.txt", "olá\r\nmundo")
        result = self.run_async(self.plugin.read_file_content(file))
        self.assertEqual(result["content"], "olá\r\nmundo")
        self.assertEqual(result["size"], len("olá\r\nmundo".encode()))

    def test_read_file_refusals(self):
        self.assertFalse(self.run_async(self.plugin.read_file_content(self.path("none")))["success"])
        self.assertFalse(self.run_async(self.plugin.read_file_content(self.work))["success"])
        big = self.write("big.txt", "x" * 100)
        self.assertIn("grande", self.run_async(self.plugin.read_file_content(big, 10))["error"])
        binary = self.write("bin", b"a\x00b")
        self.assertIn("binário", self.run_async(self.plugin.read_file_content(binary))["error"])
        invalid = self.write("bad", b"\xff\xfe")
        self.assertIn("UTF-8", self.run_async(self.plugin.read_file_content(invalid))["error"])

    def test_read_is_case_insensitive(self):
        self.write("Readme.TXT", "hi")
        result = self.run_async(self.plugin.read_file_content(self.path("readme.txt")))
        self.assertEqual(result["content"], "hi")

    def test_write_file_content_atomic_and_keeps_mode(self):
        file = self.write("w.txt", "old")
        os.chmod(file, 0o640)
        result = self.run_async(self.plugin.write_file_content(file, "new\r\ncontent"))
        self.assertTrue(result["success"])
        self.assertEqual(self.read_abs(file, True), b"new\r\ncontent")
        self.assertEqual(os.stat(file).st_mode & 0o777, 0o640)
        self.assertEqual([n for n in os.listdir(self.work) if n.startswith(".dm-edit")], [])

    def test_write_creates_parents_and_follows_symlinks(self):
        result = self.run_async(self.plugin.write_file_content(self.path("new/dir/f.txt"), "x"))
        self.assertTrue(result["success"])
        target = self.write("real.txt", "r")
        os.symlink(target, self.path("link.txt"))
        self.run_async(self.plugin.write_file_content(self.path("link.txt"), "via link"))
        self.assertTrue(os.path.islink(self.path("link.txt")))
        self.assertEqual(self.read_abs(target), "via link")
        self.assertFalse(self.run_async(self.plugin.write_file_content("", "x"))["success"])

    def test_decky_hooks_are_callable(self):
        self.run_async(self.plugin._main())
        self.assertIsNotNone(self.plugin.loop)
        self.run_async(self.plugin._unload())
        self.run_async(self.plugin._uninstall())


if __name__ == "__main__":
    unittest.main()
