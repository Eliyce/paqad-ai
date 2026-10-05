#!/usr/bin/env python3
"""Unit tests for build/build.py.

Standard library only. No network. Writes nothing outside temporary working folders.
Asserts: all four manifests exist and agree on name/version/description; the OpenAI keys sit
under extensions.com.openai; two consecutive builds are byte-identical; a skill referencing an
undeclared shared import fails the build; dist/ has no forbidden content; voice.md is copied
into each skill.
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

import build  # noqa: E402

PLUGIN_NAME = "paqad-product-discovery"
FORBIDDEN = (
    "agents",
    "hooks",
    "commands",
    "bin",
    ".mcp.json",
    "mcp.json",
    ".app.json",
)


def read_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def list_relpaths(root):
    paths = set()
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for name in filenames:
            full = os.path.join(dirpath, name)
            paths.add(os.path.relpath(full, root).replace(os.sep, "/"))
    return paths


class BuildOutputTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.dist = os.path.join(self.tmp, "dist")
        build.build(REPO_ROOT, self.dist)
        self.plugin_dir = os.path.join(self.dist, "plugins", PLUGIN_NAME)

    def _manifest_paths(self):
        return {
            "claude_marketplace": os.path.join(
                self.dist, ".claude-plugin", "marketplace.json"
            ),
            "agents_marketplace": os.path.join(
                self.dist, ".agents", "plugins", "marketplace.json"
            ),
            "plugin": os.path.join(self.plugin_dir, ".claude-plugin", "plugin.json"),
            "openai": os.path.join(self.plugin_dir, "plugin.json"),
        }

    def test_all_four_manifests_exist(self):
        for key, path in self._manifest_paths().items():
            self.assertTrue(os.path.isfile(path), "missing manifest: {0}".format(key))

    def test_manifests_agree_on_identity(self):
        paths = self._manifest_paths()
        plugin = read_json(paths["plugin"])
        openai = read_json(paths["openai"])
        claude_mp = read_json(paths["claude_marketplace"])
        agents_mp = read_json(paths["agents_marketplace"])

        name, version, description = (
            plugin["name"],
            plugin["version"],
            plugin["description"],
        )
        # The two plugin manifests agree directly.
        for manifest in (plugin, openai):
            self.assertEqual(manifest["name"], name)
            self.assertEqual(manifest["version"], version)
            self.assertEqual(manifest["description"], description)
        # The marketplace manifests carry the same identity in their single plugin entry.
        for marketplace in (claude_mp, agents_mp):
            self.assertEqual(marketplace["name"], name)
            entry = marketplace["plugins"][0]
            self.assertEqual(entry["name"], name)
            self.assertEqual(entry["version"], version)
            self.assertEqual(entry["description"], description)

    def test_openai_keys_under_extension(self):
        openai = read_json(self._manifest_paths()["openai"])
        self.assertIn("extensions", openai)
        self.assertIn("com.openai", openai["extensions"])
        ext = openai["extensions"]["com.openai"]
        self.assertIn("skills", ext)
        self.assertIn("display_name", ext)

    def test_voice_copied_into_each_skill(self):
        skills_root = os.path.join(self.plugin_dir, "skills")
        for skill_name in sorted(os.listdir(skills_root)):
            voice = os.path.join(skills_root, skill_name, "references", "voice.md")
            self.assertTrue(
                os.path.isfile(voice),
                "voice.md not copied into {0}".format(skill_name),
            )

    def test_no_forbidden_content(self):
        for rel in list_relpaths(self.dist):
            parts = rel.split("/")
            for token in FORBIDDEN:
                self.assertNotIn(
                    token, parts, "forbidden path component in dist: {0}".format(rel)
                )

    def test_no_bytecode_in_dist(self):
        # Build cruft must never reach dist/ (determinism hazard for AC-5/FR-9).
        for rel in list_relpaths(self.dist):
            parts = rel.split("/")
            self.assertNotIn(
                "__pycache__", parts, "bytecode cache in dist: {0}".format(rel)
            )
            self.assertFalse(
                rel.endswith(".pyc"), "compiled bytecode in dist: {0}".format(rel)
            )


class DeterminismTest(unittest.TestCase):
    def test_two_builds_byte_identical(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        dist_a = os.path.join(tmp, "a")
        dist_b = os.path.join(tmp, "b")
        build.build(REPO_ROOT, dist_a)
        build.build(REPO_ROOT, dist_b)

        paths_a = list_relpaths(dist_a)
        paths_b = list_relpaths(dist_b)
        self.assertEqual(paths_a, paths_b)
        for rel in sorted(paths_a):
            with open(os.path.join(dist_a, rel), "rb") as handle:
                bytes_a = handle.read()
            with open(os.path.join(dist_b, rel), "rb") as handle:
                bytes_b = handle.read()
            self.assertEqual(bytes_a, bytes_b, "differs: {0}".format(rel))


class UndeclaredImportTest(unittest.TestCase):
    def test_undeclared_shared_import_fails_build(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        source = os.path.join(tmp, "source")
        for sub in ("skills", "shared", "build"):
            shutil.copytree(
                os.path.join(REPO_ROOT, sub), os.path.join(source, sub)
            )
        # Add a shared file that a skill references but does not declare in skills.yml.
        extra = os.path.join(source, "shared", "references", "extra.md")
        with open(extra, "w", encoding="utf-8") as handle:
            handle.write("# extra shared reference\n")
        skill_md = os.path.join(source, "skills", "discover-read", "SKILL.md")
        with open(skill_md, "a", encoding="utf-8") as handle:
            handle.write("\nSee references/extra.md for more.\n")

        dist = os.path.join(tmp, "dist")
        with self.assertRaises(build.BuildError) as ctx:
            build.build(source, dist)
        self.assertIn("references/extra.md", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
