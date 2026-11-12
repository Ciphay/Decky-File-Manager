import os
import struct
import unittest

from backend.shortcuts_vdf import _Reader, read_shortcuts
from tests.backend.support import PluginTestCase


def vdf_string(key, value):
    return b"\x01" + key.encode() + b"\x00" + value.encode() + b"\x00"


def vdf_int(key, value):
    return b"\x02" + key.encode() + b"\x00" + struct.pack("<I", value)


def build_shortcuts(entries):
    body = b"\x00shortcuts\x00"
    for index, entry in enumerate(entries):
        body += b"\x00" + str(index).encode() + b"\x00"
        body += vdf_int("appid", entry["appid"])
        body += vdf_string("AppName", entry["name"])
        body += vdf_string("Exe", entry["exe"])
        body += vdf_string("StartDir", entry["start_dir"])
        body += b"\x08"
    return body + b"\x08\x08"


class VdfParserTests(unittest.TestCase):
    def test_reads_types(self):
        data = (b"\x00root\x00" + vdf_string("Name", "valor") + vdf_int("Num", 7)
                + b"\x07big\x00" + struct.pack("<Q", 2 ** 40) + b"\x08\x08")
        parsed = _Reader(data).read_map()
        self.assertEqual(parsed["root"], {"name": "valor", "num": 7, "big": 2 ** 40})

    def test_unknown_type_and_depth_limit(self):
        with self.assertRaises(ValueError):
            _Reader(b"\x7fkey\x00").read_map()
        with self.assertRaises(ValueError):
            _Reader(b"\x00a\x00" * 20).read_map()

    def test_read_shortcuts_and_cache(self):
        file = self.tmp = None
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            file = os.path.join(folder, "shortcuts.vdf")
            with open(file, "wb") as handle:
                handle.write(build_shortcuts([{"appid": 0x80000001, "name": "Jogo", "exe": '"/x/game.sh"', "start_dir": '"/x"'}]))
            entries = read_shortcuts(file)
            self.assertEqual(entries, [{"appid": 0x80000001, "name": "Jogo", "exe": '"/x/game.sh"', "start_dir": '"/x"'}])
            self.assertIs(read_shortcuts(file), entries)
            self.assertEqual(read_shortcuts(os.path.join(folder, "none.vdf")), [])
            with open(file, "wb") as handle:
                handle.write(b"garbage")
            os.utime(file, (1, 1))
            self.assertEqual(read_shortcuts(file), [])


class SteamLibraryTests(PluginTestCase):
    def setUp(self):
        super().setUp()
        self.steam = os.path.join(self.home, ".local/share/Steam")
        os.makedirs(os.path.join(self.steam, "steamapps/common"))
        self.library2 = self.make_dir("sdcard-library")
        os.makedirs(os.path.join(self.library2, "steamapps/common/Hades"))
        with open(os.path.join(self.library2, "steamapps/appmanifest_1145360.acf"), "w") as handle:
            handle.write('"AppState"\n{\n\t"installdir"\t\t"Hades"\n}\n')
        with open(os.path.join(self.steam, "steamapps/libraryfolders.vdf"), "w") as handle:
            handle.write('"libraryfolders"\n{\n "0"\n {\n  "path"\t"%s"\n }\n "1"\n {\n  "path"\t"%s"\n }\n}\n' % (self.steam, self.library2))

    def test_roots_and_libraries(self):
        self.assertEqual([str(p) for p in self.plugin._get_steam_root_candidates()], [os.path.join(self.home, ".local/share/Steam")])
        libraries = [str(p) for p in self.plugin._steam_library_roots()]
        self.assertEqual(libraries, [self.steam, self.library2])

    def test_resolves_game_on_secondary_library(self):
        found = self.run_async(self.plugin.get_game_install_dir(1145360))
        self.assertEqual(found, {"success": True, "path": os.path.join(self.library2, "steamapps/common/Hades")})

    def test_unknown_game_and_missing_installdir(self):
        self.assertFalse(self.run_async(self.plugin.get_game_install_dir(999))["success"])
        with open(os.path.join(self.steam, "steamapps/appmanifest_5.acf"), "w") as handle:
            handle.write('"AppState" { "installdir" "" }')
        self.assertIsNone(self.plugin._resolve_steam_appmanifest_path(5))

    def test_read_vdf_paths_ignores_missing_folders(self):
        vdf = self.write("lib.vdf", '"path" "/does/not/exist"\n"path" "%s"' % self.work)
        from pathlib import Path
        self.assertEqual([str(p) for p in self.plugin._read_vdf_paths(Path(vdf))], [self.work])
        self.assertEqual(self.plugin._read_vdf_paths(Path(self.path("none.vdf"))), [])


class NonSteamTests(PluginTestCase):
    def setUp(self):
        super().setUp()
        userdata = os.path.join(self.home, ".local/share/Steam/userdata/1234/config")
        os.makedirs(userdata)
        self.game_dir = self.make_dir("games/Doom Eternal")
        self.other_dir = self.make_dir("games/Doom")
        with open(os.path.join(userdata, "shortcuts.vdf"), "wb") as handle:
            handle.write(build_shortcuts([
                {"appid": 0x80000010, "name": "Doom", "exe": '"%s/doom.sh"' % self.other_dir, "start_dir": '"%s"' % self.other_dir},
                {"appid": 0x80000011, "name": "Doom Eternal", "exe": '"%s/eternal.exe"' % self.game_dir, "start_dir": ""},
            ]))

    def test_name_matching_prefers_exact(self):
        self.assertEqual(self.plugin._resolve_nonsteam_install_dir("Doom"), self.other_dir)
        self.assertEqual(self.plugin._resolve_nonsteam_install_dir("doom-eternal"), self.game_dir)

    def test_matches_by_appid(self):
        self.assertEqual(self.plugin._resolve_nonsteam_install_dir("qualquer", 0x80000011), self.game_dir)

    def test_short_substrings_do_not_match(self):
        self.assertIsNone(self.plugin._resolve_nonsteam_install_dir("e"))
        self.assertIsNone(self.plugin._resolve_nonsteam_install_dir(""))

    def test_normalization_and_scores(self):
        self.assertEqual(self.plugin._normalize_shortcut_name('"/a/My Game.AppImage"'), "mygame")
        self.assertEqual(self.plugin._shortcut_name_match_score("Doom", "doom"), 100)
        self.assertEqual(self.plugin._shortcut_name_match_score("Doom", "Doom Eternal"), 60)
        self.assertEqual(self.plugin._shortcut_name_match_score("abc", "xyz"), 0)
        self.assertEqual(self.plugin._shortcut_name_match_score(None, "x"), 0)

    def test_public_api(self):
        self.assertTrue(self.run_async(self.plugin.get_game_install_dir(0, "Doom"))["success"])
        self.assertFalse(self.run_async(self.plugin.get_game_install_dir(0, ""))["success"])


class ScreenshotsTests(PluginTestCase):
    def test_finds_newest_screenshots_dir(self):
        self.assertFalse(self.run_async(self.plugin.get_screenshots_dir(0))["success"])
        base = os.path.join(self.home, ".local/share/Steam/userdata/1/760/remote")
        os.makedirs(os.path.join(base, "730/screenshots"))
        self.assertEqual(self.run_async(self.plugin.get_screenshots_dir(730))["path"], os.path.join(base, "730/screenshots"))
        self.assertEqual(self.run_async(self.plugin.get_screenshots_dir(0))["path"], base)
        self.assertFalse(self.run_async(self.plugin.get_screenshots_dir(999))["success"])


if __name__ == "__main__":
    unittest.main()
