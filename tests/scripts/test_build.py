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


class HostBranchTest(unittest.TestCase):
    """AC-8/AC-9/AC-10 (PLG-12): the combined dist/ root stays intact and per-host branches are
    emitted under dist/hosts/<host>/, each carrying only its host's manifest files plus a skills
    tree byte-identical to the combined dist, all generated from the one source (skills.yml)."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.dist = os.path.join(self.tmp, "dist")
        build.build(REPO_ROOT, self.dist)
        self.config = build.load_config(os.path.join(REPO_ROOT, "build", "skills.yml"))
        self.combined_plugin = os.path.join(self.dist, "plugins", PLUGIN_NAME)

    def _branch_root(self, host):
        return os.path.join(self.dist, "hosts", host)

    def _skills_relpaths(self, root):
        plugin_skills = os.path.join(root, "plugins", PLUGIN_NAME, "skills")
        return list_relpaths(plugin_skills)

    def _non_skills_relpaths(self, root):
        skills_prefix = "plugins/{0}/skills/".format(PLUGIN_NAME)
        return {rel for rel in list_relpaths(root) if not rel.startswith(skills_prefix)}

    def test_all_three_branches_exist(self):
        for host in ("claude", "chatgpt", "codex"):
            self.assertTrue(
                os.path.isdir(self._branch_root(host)), "missing branch: {0}".format(host)
            )

    def test_each_branch_carries_only_its_host_manifest_files(self):
        expected = {
            "claude": {
                ".claude-plugin/marketplace.json",
                "plugins/{0}/.claude-plugin/plugin.json".format(PLUGIN_NAME),
            },
            "chatgpt": {
                ".claude-plugin/marketplace.json",
                "plugins/{0}/.claude-plugin/plugin.json".format(PLUGIN_NAME),
            },
            "codex": {
                ".agents/plugins/marketplace.json",
                "plugins/{0}/plugin.json".format(PLUGIN_NAME),
            },
        }
        for host, files in expected.items():
            self.assertEqual(
                self._non_skills_relpaths(self._branch_root(host)),
                files,
                "branch {0} carries unexpected non-skills files".format(host),
            )

    def test_chatgpt_branch_has_no_agents_file(self):
        rels = list_relpaths(self._branch_root("chatgpt"))
        self.assertFalse(
            any(rel.startswith(".agents/") for rel in rels),
            "chatgpt branch must not carry a .agents file",
        )

    def test_codex_branch_is_openai_primary(self):
        openai = read_json(
            os.path.join(self._branch_root("codex"), "plugins", PLUGIN_NAME, "plugin.json")
        )
        self.assertIn("extensions", openai)
        self.assertIn("com.openai", openai["extensions"])
        self.assertIn("skills", openai["extensions"]["com.openai"])

    def test_each_branch_is_skills_only(self):
        for host in ("claude", "chatgpt", "codex"):
            for rel in list_relpaths(self._branch_root(host)):
                parts = rel.split("/")
                for token in FORBIDDEN:
                    self.assertNotIn(
                        token,
                        parts,
                        "forbidden path component in {0} branch: {1}".format(host, rel),
                    )
                self.assertNotIn("__pycache__", parts)
                self.assertFalse(rel.endswith(".pyc"))

    def test_branch_skills_tree_matches_combined(self):
        combined = self._skills_relpaths(self.dist)
        self.assertTrue(combined, "combined dist has no skills tree")
        for host in ("claude", "chatgpt", "codex"):
            branch_skills = self._skills_relpaths(self._branch_root(host))
            self.assertEqual(
                branch_skills, combined, "branch {0} skills set differs".format(host)
            )
            for rel in sorted(combined):
                with open(
                    os.path.join(self.combined_plugin, "skills", rel), "rb"
                ) as handle:
                    combined_bytes = handle.read()
                with open(
                    os.path.join(
                        self._branch_root(host), "plugins", PLUGIN_NAME, "skills", rel
                    ),
                    "rb",
                ) as handle:
                    branch_bytes = handle.read()
                self.assertEqual(
                    combined_bytes,
                    branch_bytes,
                    "branch {0} skill file differs: {1}".format(host, rel),
                )

    def test_branch_manifests_match_the_single_source(self):
        marketplace, plugin_manifest, openai_manifest = build.build_manifests(self.config)
        claude_mp = read_json(
            os.path.join(self._branch_root("claude"), ".claude-plugin", "marketplace.json")
        )
        chatgpt_mp = read_json(
            os.path.join(self._branch_root("chatgpt"), ".claude-plugin", "marketplace.json")
        )
        codex_mp = read_json(
            os.path.join(self._branch_root("codex"), ".agents", "plugins", "marketplace.json")
        )
        for mp in (claude_mp, chatgpt_mp, codex_mp):
            self.assertEqual(mp, marketplace)
        claude_plugin = read_json(
            os.path.join(
                self._branch_root("claude"),
                "plugins",
                PLUGIN_NAME,
                ".claude-plugin",
                "plugin.json",
            )
        )
        self.assertEqual(claude_plugin, plugin_manifest)
        codex_plugin = read_json(
            os.path.join(self._branch_root("codex"), "plugins", PLUGIN_NAME, "plugin.json")
        )
        self.assertEqual(codex_plugin, openai_manifest)

    def test_combined_root_still_intact(self):
        # INV-1: the combined dist root manifests are unchanged by the branch emission.
        for rel in (
            ".claude-plugin/marketplace.json",
            ".agents/plugins/marketplace.json",
            "plugins/{0}/.claude-plugin/plugin.json".format(PLUGIN_NAME),
            "plugins/{0}/plugin.json".format(PLUGIN_NAME),
        ):
            self.assertTrue(
                os.path.isfile(os.path.join(self.dist, *rel.split("/"))),
                "combined dist missing {0}".format(rel),
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
        # ground-in-project is a real skill that does NOT declare references/consulting.md
        # (that shared file exists and is declared only by product-discovery and ask-project).
        # Make its SKILL.md reference the undeclared shared file so the build must fail (PLG-10).
        skill_md = os.path.join(source, "skills", "ground-in-project", "SKILL.md")
        with open(skill_md, "a", encoding="utf-8") as handle:
            handle.write("\nSee references/consulting.md for more.\n")

        dist = os.path.join(tmp, "dist")
        with self.assertRaises(build.BuildError) as ctx:
            build.build(source, dist)
        self.assertIn("references/consulting.md", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
