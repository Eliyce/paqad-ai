#!/usr/bin/env python3
"""Unit tests for build/bump_version.py (CI-14 deterministic half).

Standard library only (Python 3.9+). No network. Writes nothing outside temporary folders.

Proves:
  - a patch, minor or major changeset bumps the version scalar to the expected next version;
  - only the version line in build/skills.yml changes, every other line is untouched;
  - build.build() regenerates every manifest with the new version;
  - two consecutive bump-plus-build runs are byte-identical (CI-8 discipline preserved);
  - the highest bump across several changesets wins;
  - --dry-run writes nothing;
  - a missing changeset directive exits non-zero (fails loudly, never guesses a bump).
"""

import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
BUILD_DIR = os.path.join(REPO_ROOT, "build")
if BUILD_DIR not in sys.path:
    sys.path.insert(0, BUILD_DIR)

import build
import bump_version

PLUGIN_NAME = "paqad-product-discovery"


def _read_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def _list_relpaths(root):
    paths = set()
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d != "__pycache__"]
        for name in filenames:
            if name.endswith(".pyc"):
                continue
            full = os.path.join(dirpath, name)
            paths.add(os.path.relpath(full, root).replace(os.sep, "/"))
    return paths


class BumpVersionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.source = os.path.join(self.tmp, "source")
        for sub in ("skills", "shared", "build"):
            shutil.copytree(os.path.join(REPO_ROOT, sub), os.path.join(self.source, sub))
        self.changeset_dir = os.path.join(self.source, ".changeset")
        os.makedirs(self.changeset_dir)
        self.skills_yml = os.path.join(self.source, "build", "skills.yml")
        self.dist = os.path.join(self.tmp, "dist")

    def _write_changeset(self, level, name="change"):
        path = os.path.join(self.changeset_dir, "{0}.md".format(name))
        with open(path, "w", encoding="utf-8") as handle:
            handle.write('---\n"{0}": {1}\n---\n\nA short summary.\n'.format(PLUGIN_NAME, level))

    def _run(self, dry_run=False):
        return bump_version.run(self.source, self.changeset_dir, self.dist, dry_run)

    def _plugin_version(self):
        manifest = _read_json(
            os.path.join(self.dist, "plugins", PLUGIN_NAME, ".claude-plugin", "plugin.json")
        )
        return manifest["version"]

    def test_patch_bump(self):
        self._write_changeset("patch")
        result = self._run()
        self.assertEqual(result["previous"], "0.0.0")
        self.assertEqual(result["next"], "0.0.1")
        self.assertEqual(bump_version.read_version(self.skills_yml), "0.0.1")
        self.assertEqual(self._plugin_version(), "0.0.1")

    def test_minor_bump(self):
        self._write_changeset("minor")
        self.assertEqual(self._run()["next"], "0.1.0")
        self.assertEqual(self._plugin_version(), "0.1.0")

    def test_major_bump(self):
        self._write_changeset("major")
        self.assertEqual(self._run()["next"], "1.0.0")
        self.assertEqual(self._plugin_version(), "1.0.0")

    def test_highest_bump_wins(self):
        self._write_changeset("patch", name="a")
        self._write_changeset("minor", name="b")
        self.assertEqual(self._run()["bump"], "minor")

    def test_only_the_version_line_changes(self):
        with open(self.skills_yml, "r", encoding="utf-8") as handle:
            before = handle.readlines()
        self._write_changeset("minor")
        self._run()
        with open(self.skills_yml, "r", encoding="utf-8") as handle:
            after = handle.readlines()
        self.assertEqual(len(before), len(after))
        differing = [i for i in range(len(before)) if before[i] != after[i]]
        self.assertEqual(len(differing), 1, "more than the version line changed")
        self.assertTrue(after[differing[0]].startswith("version:"))

    def test_double_build_is_byte_identical(self):
        self._write_changeset("minor")
        self._run()
        dist_a = os.path.join(self.tmp, "a")
        dist_b = os.path.join(self.tmp, "b")
        build.build(self.source, dist_a)
        build.build(self.source, dist_b)
        paths_a = _list_relpaths(dist_a)
        self.assertEqual(paths_a, _list_relpaths(dist_b))
        for rel in sorted(paths_a):
            with open(os.path.join(dist_a, rel), "rb") as handle:
                bytes_a = handle.read()
            with open(os.path.join(dist_b, rel), "rb") as handle:
                bytes_b = handle.read()
            self.assertEqual(bytes_a, bytes_b, "differs: {0}".format(rel))

    def test_dry_run_writes_nothing(self):
        self._write_changeset("major")
        with open(self.skills_yml, "rb") as handle:
            before = handle.read()
        result = self._run(dry_run=True)
        self.assertEqual(result["next"], "1.0.0")
        with open(self.skills_yml, "rb") as handle:
            self.assertEqual(handle.read(), before)
        self.assertFalse(os.path.isdir(self.dist), "dry-run must not build the dist")

    def test_no_changeset_raises(self):
        with self.assertRaises(bump_version.BumpError):
            self._run()

    def test_readme_is_not_a_changeset(self):
        with open(os.path.join(self.changeset_dir, "README.md"), "w", encoding="utf-8") as handle:
            handle.write("# Changesets\n\nThis describes the patch and minor convention.\n")
        with self.assertRaises(bump_version.BumpError):
            self._run()


if __name__ == "__main__":
    unittest.main()
