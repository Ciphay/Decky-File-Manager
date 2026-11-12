import gzip
import io
import os
import shutil
import stat
import tarfile
import unittest
from unittest import mock
import zipfile

from tests.backend.support import PluginTestCase


class ArchiveNamingTests(PluginTestCase):
    def test_kind_detection(self):
        kinds = {
            "a.zip": "zip", "a.tar": "tar", "a.tar.gz": "tar", "a.tgz": "tar", "a.tar.bz2": "tar", "a.tar.xz": "tar",
            "a.tar.zst": "tar.zst", "a.rar": "rar", "a.7z": "7z", "a.iso": "iso", "a.txt.gz": "gz", "a.bz2": "bz2",
            "a.xz": "xz", "a.zst": "zst", "A.ZIP": "zip", "notes.txt": None,
        }
        for name, kind in kinds.items():
            self.assertEqual(self.plugin._archive_kind(name), kind, name)

    def test_base_names(self):
        base = self.plugin._archive_base_name
        self.assertEqual(base("game.tar.gz"), "game")
        self.assertEqual(base("game.TAR.XZ"), "game")
        self.assertEqual(base("file.txt.gz"), "file.txt")
        self.assertEqual(base("photos.zip"), "photos")
        self.assertEqual(base("weird"), "weird")
        self.assertEqual(base(".zip"), ".zip")


def make_zip(path, entries, modes=None):
    with zipfile.ZipFile(path, "w") as archive:
        for name, data in entries.items():
            info = zipfile.ZipInfo(name)
            mode = (modes or {}).get(name, 0o644)
            info.external_attr = (stat.S_IFREG | mode) << 16
            archive.writestr(info, data)


def make_tar(path, entries, mode="w:gz", modes=None):
    with tarfile.open(path, mode) as archive:
        for name, data in entries.items():
            info = tarfile.TarInfo(name)
            payload = data.encode() if isinstance(data, str) else data
            info.size = len(payload)
            info.mode = (modes or {}).get(name, 0o644)
            archive.addfile(info, io.BytesIO(payload))


class SingleRootTests(PluginTestCase):
    def test_zip_and_tar_single_root(self):
        make_zip(self.path("p.zip"), {"proj/a.txt": "1", "proj/sub/b.txt": "2"})
        self.assertEqual(self.plugin._archive_contains_single_root_folder(self.path("p.zip")), "proj")
        make_tar(self.path("t.tar.gz"), {"root/x": "1", "root/y/z": "2"})
        self.assertEqual(self.plugin._archive_contains_single_root_folder(self.path("t.tar.gz")), "root")

    def test_multiple_roots_flat_files_and_unreadable(self):
        make_zip(self.path("m.zip"), {"a/x": "1", "b/y": "2"})
        self.assertIsNone(self.plugin._archive_contains_single_root_folder(self.path("m.zip")))
        make_zip(self.path("flat.zip"), {"only.txt": "1"})
        self.assertIsNone(self.plugin._archive_contains_single_root_folder(self.path("flat.zip")))
        self.write("broken.zip", "not a zip")
        self.assertIsNone(self.plugin._archive_contains_single_root_folder(self.path("broken.zip")))
        self.assertIsNone(self.plugin._archive_contains_single_root_folder(self.path("x.txt")))


class ExtractorTests(PluginTestCase):
    def test_zip_extraction_keeps_permissions_and_skips_symlinks(self):
        make_zip(self.path("z.zip"), {"bin/run.sh": "#!/bin/sh", "bin/data.txt": "d"}, {"bin/run.sh": 0o755})
        out = self.path("out")
        self.plugin._extract_zip_with_progress(self.path("z.zip"), out)
        self.assertTrue(os.access(os.path.join(out, "bin/run.sh"), os.X_OK))
        self.assertEqual(self.read_abs(os.path.join(out, "bin/data.txt")), "d")

    def test_zip_slip_is_blocked(self):
        make_zip(self.path("evil.zip"), {"../evil.txt": "x"})
        with self.assertRaises(ValueError):
            self.plugin._extract_zip_with_progress(self.path("evil.zip"), self.path("out"))
        self.assertFalse(os.path.exists(self.path("evil.txt")))

    def test_absolute_member_is_rejected(self):
        with self.assertRaises(ValueError):
            self.plugin._safe_archive_member_path(self.work, "/etc/passwd")
        with self.assertRaises(ValueError):
            self.plugin._safe_archive_member_path(self.work, "")
        self.assertEqual(self.plugin._safe_archive_member_path(self.work, "a/b"), os.path.join(os.path.realpath(self.work), "a/b"))

    def test_tar_extraction_with_modes(self):
        make_tar(self.path("t.tar.gz"), {"proj/bin/tool": "x", "proj/readme": "r"}, modes={"proj/bin/tool": 0o755})
        out = self.path("out")
        self.plugin._extract_tar_with_progress(self.path("t.tar.gz"), out)
        self.assertTrue(os.access(os.path.join(out, "proj/bin/tool"), os.X_OK))
        self.assertEqual(self.read_abs(os.path.join(out, "proj/readme")), "r")

    def test_tar_slip_is_blocked(self):
        make_tar(self.path("evil.tar"), {"../../escape": "x"}, mode="w")
        with self.assertRaises(ValueError):
            self.plugin._extract_tar_with_progress(self.path("evil.tar"), self.path("out"))

    def test_single_file_compressions(self):
        with gzip.open(self.path("note.txt.gz"), "wb") as handle:
            handle.write(b"hello")
        self.plugin._extract_single_file_with_progress(self.path("note.txt.gz"), self.path("o/note.txt"))
        self.assertEqual(self.read_abs(self.path("o/note.txt"), True), b"hello")

        import bz2
        import lzma
        with bz2.open(self.path("b.txt.bz2"), "wb") as handle:
            handle.write(b"bz")
        with lzma.open(self.path("x.txt.xz"), "wb") as handle:
            handle.write(b"xz")
        self.plugin._extract_single_file_with_progress(self.path("b.txt.bz2"), self.path("o/b.txt"))
        self.plugin._extract_single_file_with_progress(self.path("x.txt.xz"), self.path("o/x.txt"))
        self.assertEqual(self.read_abs(self.path("o/b.txt"), True), b"bz")
        self.assertEqual(self.read_abs(self.path("o/x.txt"), True), b"xz")

    def test_corrupt_single_file_leaves_no_partial_output(self):
        self.write("bad.txt.gz", "not gzip")
        with self.assertRaises(Exception):
            self.plugin._extract_single_file_with_progress(self.path("bad.txt.gz"), self.path("o/bad.txt"))
        self.assertFalse(os.path.exists(self.path("o/bad.txt")))

    def test_seven_zip_lookup_prefers_7z_and_accepts_7zz(self):
        installed = {"7zz": "/usr/bin/7zz"}
        with mock.patch("shutil.which", side_effect=installed.get):
            self.assertEqual(self.plugin._seven_zip(), "/usr/bin/7zz")
        installed["7z"] = "/usr/bin/7z"
        with mock.patch("shutil.which", side_effect=installed.get):
            self.assertEqual(self.plugin._seven_zip(), "/usr/bin/7z")
        with mock.patch("shutil.which", return_value=None):
            self.assertIsNone(self.plugin._seven_zip())

    @unittest.skipUnless(shutil.which("7z") or shutil.which("7za"), "7z não instalado")
    def test_seven_zip_extraction_and_listing(self):
        import subprocess
        self.write("pkg/a.txt", "a")
        self.write("pkg/sub/b.txt", "b")
        subprocess.run([shutil.which("7z") or shutil.which("7za"), "a", "-bd", "-bso0", self.path("pkg.7z"), self.path("pkg")], check=True, cwd=self.work)
        self.assertEqual(self.plugin._archive_contains_single_root_folder(self.path("pkg.7z")), "pkg")
        self.plugin._run_extraction_with_progress(self.path("pkg.7z"), self.path("out"))
        self.assertEqual(self.read_abs(self.path("out/pkg/sub/b.txt")), "b")

    def test_unsupported_format(self):
        with self.assertRaises(ValueError):
            self.plugin._run_extraction_with_progress(self.path("file.unknown"), self.path("out"))

    def test_external_tool_failure_is_reported(self):
        self.plugin._start_operation_progress("x", "op")
        with self.assertRaises(RuntimeError):
            self.plugin._run_external_extract(["sh", "-c", "echo boom >&2; exit 3"], 0, "op")


class PlanExtractionTests(PluginTestCase):
    def test_single_root_matching_name_extracts_in_place(self):
        make_zip(self.path("proj.zip"), {"proj/a": "1", "proj/b/c": "2"})
        target, flatten, final = self.plugin._plan_extraction(self.path("proj.zip"), self.work)
        self.assertEqual((target, flatten, final), (self.work, False, self.path("proj")))

    def test_existing_folder_gets_unique_name_and_flatten(self):
        make_zip(self.path("proj.zip"), {"proj/a": "1", "proj/b/c": "2"})
        self.make_dir("proj")
        target, flatten, final = self.plugin._plan_extraction(self.path("proj.zip"), self.work)
        self.assertEqual(target, self.path("proj (1)"))
        self.assertTrue(flatten)
        self.assertEqual(final, target)

    def test_multi_root_goes_into_named_folder(self):
        make_zip(self.path("many.zip"), {"a/x": "1", "b/y": "2"})
        target, flatten, final = self.plugin._plan_extraction(self.path("many.zip"), self.work)
        self.assertEqual((target, flatten, final), (self.path("many"), False, self.path("many")))

    def test_single_compressed_file_plan(self):
        with gzip.open(self.path("log.txt.gz"), "wb") as handle:
            handle.write(b"x")
        target, flatten, final = self.plugin._plan_extraction(self.path("log.txt.gz"), self.work)
        self.assertEqual((target, flatten, final), (self.path("log.txt"), False, self.path("log.txt")))

    def test_flatten_single_root_folder(self):
        self.write("dst/root/a.txt", "a")
        self.write("dst/root/sub/b.txt", "b")
        self.plugin._flatten_single_root_folder(self.path("dst"), "root")
        self.assertEqual(sorted(os.listdir(self.path("dst"))), ["a.txt", "sub"])

    def test_flatten_is_skipped_when_other_entries_exist(self):
        self.write("dst/root/a.txt", "a")
        self.write("dst/other.txt", "o")
        self.plugin._flatten_single_root_folder(self.path("dst"), "root")
        self.assertTrue(os.path.isdir(self.path("dst/root")))
        self.plugin._flatten_single_root_folder(self.path("dst"), "missing")


if __name__ == "__main__":
    unittest.main()
