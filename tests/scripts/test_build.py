#!/usr/bin/env python3
"""Unit tests for build/build.py.

Standard library only. No network. Writes nothing outside temporary working folders.
Asserts: all four manifests exist and agree on name/version/description; the OpenAI keys sit
under extensions.com.openai; two consecutive builds are byte-identical; a skill referencing an
undeclared shared import fails the build; dist/ has no forbidden content; voice.md is copied
into each skill. The Claude branch alone carries the directory listing fields and the publish
files (README.md, LICENSE, PRIVACY.md), and a bad listing scalar or a missing publish file fails
the build.
"""

import json
import os
import re
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
PUBLIC_REPO = "https://github.com/Eliyce/paqad-product-discovery-plugin"
EM_DASH, EN_DASH = chr(0x2014), chr(0x2013)
LISTING_PLUGIN_KEYS = (
    "author",
    "homepage",
    "repository",
    "keywords",
    "displayName",
    "documentationUrl",
    "supportUrl",
    "privacyPolicyUrl",
)
# Every source tree a temp-source build needs (the build reads publish/ and docs/ too).
SOURCE_DIRS = ("skills", "shared", "build", "publish", "docs")
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


def read_text(path):
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def read_bytes(path):
    with open(path, "rb") as handle:
        return handle.read()


def copy_source(dest):
    """Copy every source tree the build reads into dest, for a temp-source build."""
    for sub in SOURCE_DIRS:
        shutil.copytree(os.path.join(REPO_ROOT, sub), os.path.join(dest, sub))


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

    def test_openai_skills_list_equals_published_names(self):
        # AC-5: the OpenAI manifest skills list equals the published names and contains "paqad".
        openai = read_json(self._manifest_paths()["openai"])
        skills = openai["extensions"]["com.openai"]["skills"]
        config = build.load_config(os.path.join(REPO_ROOT, "build", "skills.yml"))
        expected = [build.published_name(skill) for skill in config["skills"]]
        self.assertEqual(skills, expected)
        self.assertIn("paqad", skills)

    def test_voice_copied_into_each_skill(self):
        skills_root = os.path.join(self.plugin_dir, "skills")
        for skill_name in sorted(os.listdir(skills_root)):
            voice = os.path.join(skills_root, skill_name, "references", "voice.md")
            self.assertTrue(
                os.path.isfile(voice),
                "voice.md not copied into {0}".format(skill_name),
            )

    def test_github_profile_copied_into_declaring_skills(self):
        skills_root = os.path.join(self.plugin_dir, "skills")
        for skill_name in ("paqad-get-connected", "paqad-post-tickets"):
            profile = os.path.join(
                skills_root, skill_name, "references", "tracker-profiles-github.md"
            )
            self.assertTrue(
                os.path.isfile(profile),
                "tracker-profiles-github.md not copied into {0}".format(skill_name),
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
                "README.md",
                "LICENSE",
                "PRIVACY.md",
                "plugins/{0}/README.md".format(PLUGIN_NAME),
                "plugins/{0}/LICENSE".format(PLUGIN_NAME),
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
        claude_listing_mp, claude_listing_plugin = build.build_claude_listing_manifests(self.config)
        claude_mp = read_json(
            os.path.join(self._branch_root("claude"), ".claude-plugin", "marketplace.json")
        )
        chatgpt_mp = read_json(
            os.path.join(self._branch_root("chatgpt"), ".claude-plugin", "marketplace.json")
        )
        codex_mp = read_json(
            os.path.join(self._branch_root("codex"), ".agents", "plugins", "marketplace.json")
        )
        self.assertEqual(claude_mp, claude_listing_mp)
        for mp in (chatgpt_mp, codex_mp):
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
        self.assertEqual(claude_plugin, claude_listing_plugin)
        chatgpt_plugin = read_json(
            os.path.join(
                self._branch_root("chatgpt"),
                "plugins",
                PLUGIN_NAME,
                ".claude-plugin",
                "plugin.json",
            )
        )
        self.assertEqual(chatgpt_plugin, plugin_manifest)
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


class ListingManifestTest(unittest.TestCase):
    """Spec AC-2 to AC-5 (PLG-11, PLG-12): only the Claude branch manifests carry the directory
    listing fields, every value comes from skills.yml, and every manifest reads version 3.2.0."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.dist = os.path.join(cls.tmp, "dist")
        build.build(REPO_ROOT, cls.dist)
        cls.config = build.load_config(os.path.join(REPO_ROOT, "build", "skills.yml"))
        cls.claude = os.path.join(cls.dist, "hosts", "claude")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def manifest(self, *parts):
        return read_json(os.path.join(self.dist, *parts))

    def base_manifests(self):
        """(relative path parts, generated manifest, base manifest) for every non-Claude file."""
        marketplace, plugin_manifest, openai_manifest = build.build_manifests(self.config)
        plugin_rel = ("plugins", PLUGIN_NAME)
        return [
            ((".claude-plugin", "marketplace.json"), marketplace),
            ((".agents", "plugins", "marketplace.json"), marketplace),
            (plugin_rel + (".claude-plugin", "plugin.json"), plugin_manifest),
            (plugin_rel + ("plugin.json",), openai_manifest),
            (("hosts", "chatgpt", ".claude-plugin", "marketplace.json"), marketplace),
            (("hosts", "chatgpt") + plugin_rel + (".claude-plugin", "plugin.json"), plugin_manifest),
            (("hosts", "codex", ".agents", "plugins", "marketplace.json"), marketplace),
            (("hosts", "codex") + plugin_rel + ("plugin.json",), openai_manifest),
        ]

    def test_claude_plugin_carries_the_listing_fields(self):
        plugin = self.manifest("hosts", "claude", "plugins", PLUGIN_NAME, ".claude-plugin",
                               "plugin.json")
        self.assertEqual(plugin["license"], "MIT")
        self.assertEqual(plugin["author"], {"name": "Eliyce", "email": "haider@eliyce.com"})
        self.assertEqual(plugin["keywords"], [
            "product-discovery", "product-management", "user-stories", "tickets", "jira",
            "backlog", "sprint-planning"])
        self.assertEqual(plugin["displayName"], "Paqad Product Discovery")
        for key in ("homepage", "repository", "documentationUrl", "supportUrl", "privacyPolicyUrl"):
            self.assertTrue(plugin[key].startswith(PUBLIC_REPO), key)
        self.assertNotIn("paqad" + ".dev", json.dumps(plugin))
        for key in ("name", "version", "description"):
            self.assertTrue(plugin[key], key)

    def test_claude_marketplace_has_owner_email_and_description(self):
        marketplace = self.manifest("hosts", "claude", ".claude-plugin", "marketplace.json")
        self.assertEqual(marketplace["owner"], {"name": "Eliyce", "email": "haider@eliyce.com"})
        self.assertEqual(marketplace["metadata"], {"description": self.config["description"]})

    def test_other_manifests_keep_the_base_shape(self):
        for parts, base in self.base_manifests():
            built = self.manifest(*parts)
            self.assertEqual(set(built), set(base), "/".join(parts))
            for key in LISTING_PLUGIN_KEYS + ("metadata",):
                self.assertNotIn(key, built, "/".join(parts))
            self.assertNotIn("email", built.get("owner", {}), "/".join(parts))

    def test_every_manifest_reads_the_version_and_owner(self):
        self.assertEqual(self.config["version"], "3.2.0")
        for rel in list_relpaths(self.dist):
            if not rel.endswith(".json") or "/skills/" in rel:
                continue
            manifest = self.manifest(*rel.split("/"))
            # A marketplace carries the version on its plugin entries, a plugin manifest on itself.
            for entry in manifest.get("plugins", [manifest]):
                self.assertEqual(entry.get("version"), "3.2.0", rel)
            if "owner" in manifest:
                self.assertEqual(manifest["owner"]["name"], "Eliyce", rel)

    def test_the_old_domain_is_gone_from_source_and_dist(self):
        old_domain = ("paqad" + ".dev").encode("utf-8")
        skipped = {".git", ".paqad", "dist", ".idea", ".claude", "__pycache__"}
        offenders = []
        for root in (REPO_ROOT, self.dist):
            for dirpath, dirnames, filenames in os.walk(root):
                dirnames[:] = [d for d in dirnames if d not in skipped]
                for name in filenames:
                    if old_domain in read_bytes(os.path.join(dirpath, name)):
                        offenders.append(os.path.join(dirpath, name))
        self.assertEqual(offenders, [])
        schema = read_json(os.path.join(REPO_ROOT, "skills", "write-tickets", "assets",
                                        "ticket-set.schema.json"))
        self.assertEqual(schema["$id"], "https://paqad.ai/schemas/ticket-set.schema.json")


class PublishFilesTest(unittest.TestCase):
    """Spec AC-6 to AC-9 and AC-11: the Claude branch carries README.md, LICENSE and PRIVACY.md,
    byte-identical to their sources, the other branches and the combined root carry none, and the
    nudge link is the one exact link everywhere it is written."""

    NUDGE_LINK = "https://paqad.ai/?src=discovery-plugin"

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.dist = os.path.join(cls.tmp, "dist")
        build.build(REPO_ROOT, cls.dist)
        cls.config = build.load_config(os.path.join(REPO_ROOT, "build", "skills.yml"))
        cls.claude = os.path.join(cls.dist, "hosts", "claude")
        cls.plugin_rel = "plugins/{0}".format(PLUGIN_NAME)
        cls.readme = read_text(os.path.join(cls.claude, cls.plugin_rel, "README.md"))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def targets(self):
        return [
            ("publish/claude/README.md", "README.md"),
            ("publish/claude/README.md", self.plugin_rel + "/README.md"),
            ("publish/claude/LICENSE", "LICENSE"),
            ("publish/claude/LICENSE", self.plugin_rel + "/LICENSE"),
            ("docs/privacy-policy.md", "PRIVACY.md"),
        ]

    def test_targets_are_byte_identical_to_their_sources(self):
        for source, target in self.targets():
            self.assertEqual(
                read_bytes(os.path.join(self.claude, *target.split("/"))),
                read_bytes(os.path.join(REPO_ROOT, *source.split("/"))),
                target,
            )

    def test_only_the_claude_branch_carries_publish_files(self):
        roots = (self.dist, os.path.join(self.dist, "hosts", "chatgpt"),
                 os.path.join(self.dist, "hosts", "codex"))
        for root in roots:
            for _, target in self.targets():
                self.assertFalse(os.path.exists(os.path.join(root, *target.split("/"))),
                                 "{0} in {1}".format(target, root))

    def test_readme_is_an_end_user_guide(self):
        self.assertGreaterEqual(len(self.readme.split()), 40)
        examples = self.readme[self.readme.index("## Example prompts"):]
        examples = examples[:examples.index("\n## ", 1)]
        prompts = re.findall(r"^- `([^`]+)`$", examples, re.MULTILINE)
        self.assertGreaterEqual(len(prompts), 3)
        self.assertTrue(any(prompt.startswith("/paqad ") for prompt in prompts))
        positions = [self.readme.index("`{0}`".format(skill)) for skill in (
            "/paqad", "paqad-ask", "paqad-discover", "paqad-refine-ticket", "paqad-size-work",
            "paqad-plan-sprint")]
        self.assertEqual(positions[0], min(positions), "/paqad must come first")
        for phrase in ("code execution", "repository", "Jira connector", "## Install",
                       self.config["support_url"], self.config["privacy_policy_url"],
                       self.config["author_email"], "src=discovery-plugin"):
            self.assertIn(phrase, self.readme)

    def test_readme_carries_no_version_number(self):
        self.assertNotIn(self.config["version"], self.readme)
        self.assertIsNone(re.search(r"\bv?\d+\.\d+(\.\d+)?\b", self.readme))

    def test_license_is_the_full_mit_text(self):
        for target in ("LICENSE", self.plugin_rel + "/LICENSE"):
            text = read_text(os.path.join(self.claude, *target.split("/")))
            for phrase in ("MIT License", "Copyright (c) 2026 Eliyce",
                           "Permission is hereby granted, free of charge",
                           'THE SOFTWARE IS PROVIDED "AS IS"'):
                self.assertIn(phrase, text, target)

    def test_privacy_policy_discloses_and_gives_contact(self):
        text = read_text(os.path.join(self.claude, "PRIVACY.md"))
        for phrase in ("src=discovery-plugin", self.NUDGE_LINK, "only when you approve",
                       "## Contact", self.config["support_url"], self.config["author_email"],
                       "## Changes"):
            self.assertIn(phrase, text)

    def test_publish_files_have_no_em_or_en_dash(self):
        for _, target in self.targets():
            text = read_text(os.path.join(self.claude, *target.split("/")))
            self.assertNotIn(EM_DASH, text, target)
            self.assertNotIn(EN_DASH, text, target)

    def test_nudge_link_is_the_one_exact_link(self):
        source = os.path.join(REPO_ROOT, "shared", "references", "evidence-levels.md")
        copies = [os.path.join(dirpath, "evidence-levels.md")
                  for dirpath, _, names in os.walk(self.dist) if "evidence-levels.md" in names]
        self.assertTrue(copies, "no built copy of evidence-levels.md")
        for path in [source] + copies:
            text = read_text(path)
            self.assertEqual(re.findall(r"https://paqad\.ai[^\s`]*", text), [self.NUDGE_LINK])
            self.assertIn("Use only this link", text)
        self.assertIn(self.NUDGE_LINK, self.readme)


class BranchHygieneTest(unittest.TestCase):
    """Spec AC-13 (NFR-1): OS and build cruft never reaches the Claude branch, and the branch stays
    within the directory's file size and file count limits."""

    def test_claude_branch_is_clean_and_within_limits(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        source = os.path.join(tmp, "source")
        copy_source(source)
        for folder in (("skills", "ground-in-project"), ("shared", "references"),
                       ("publish", "claude")):
            with open(os.path.join(source, *folder + (".DS_Store",)), "wb") as handle:
                handle.write(b"\x00\x01cruft")
        dist = os.path.join(tmp, "dist")
        build.build(source, dist)
        branch = os.path.join(dist, "hosts", "claude")
        rels = list_relpaths(branch)
        self.assertLess(len(rels), 512)
        for rel in rels:
            parts = rel.split("/")
            self.assertNotIn(".DS_Store", parts, rel)
            self.assertNotIn("__pycache__", parts, rel)
            self.assertFalse(rel.endswith(".pyc"), rel)
            self.assertLess(os.path.getsize(os.path.join(branch, rel)), 256 * 1024, rel)
        self.assertFalse(any(".DS_Store" in rel for rel in list_relpaths(dist)))


class ListingFailureTest(unittest.TestCase):
    """Spec AC-10 (FR-4, FR-5): a missing or bad listing scalar, or a missing publish file, fails
    the build with an error naming the field or file; nothing is defaulted or skipped."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.source = os.path.join(self.tmp, "source")
        copy_source(self.source)
        self.skills_yml = os.path.join(self.source, "build", "skills.yml")

    def set_scalar(self, key, line):
        text = read_text(self.skills_yml)
        new_text = re.sub(r"(?m)^{0}:.*\n".format(re.escape(key)), line, text, count=1)
        self.assertNotEqual(new_text, text, key)
        with open(self.skills_yml, "w", encoding="utf-8") as handle:
            handle.write(new_text)

    def assert_build_fails(self, *names):
        with self.assertRaises(build.BuildError) as ctx:
            build.build(self.source, os.path.join(self.tmp, "dist"))
        for name in names:
            self.assertIn(name, str(ctx.exception))

    def test_each_missing_listing_scalar_fails(self):
        original = read_text(self.skills_yml)
        for key in build.LISTING_SCALARS:
            with open(self.skills_yml, "w", encoding="utf-8") as handle:
                handle.write(original)
            self.set_scalar(key, "")
            self.assert_build_fails("'{0}'".format(key))

    def test_a_non_https_listing_url_fails(self):
        self.set_scalar("support_url", 'support_url: "http://example.com/issues"\n')
        self.assert_build_fails("support_url", "http://example.com/issues")

    def test_empty_keywords_fail(self):
        self.set_scalar("keywords", 'keywords: " , ,"\n')
        self.assert_build_fails("keywords")

    def test_keywords_are_stripped_and_empties_dropped(self):
        self.assertEqual(build.parse_keywords(" a, b ,,c ,"), ["a", "b", "c"])

    def test_a_missing_publish_file_fails(self):
        os.remove(os.path.join(self.source, "publish", "claude", "README.md"))
        self.assert_build_fails("publish/claude/README.md")

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
        copy_source(source)
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



class SharedRepositoryFilesTest(unittest.TestCase):
    """AC-24 (PLG-9, PLG-10): the shared repository rule and onboarded check reach exactly their
    declaring skills, byte-identical to the shared source, and an undeclared mention fails."""

    CONNECT = ("references", "connect-repository.md")
    CHECK = ("scripts", "check_onboarded.py")
    CONNECT_SKILLS = ("paqad-ask", "paqad-get-connected", "paqad-ground-in-project",
                      "paqad-refine-ticket", "paqad-size-work")
    CHECK_SKILLS = ("paqad-ask", "paqad-get-connected", "paqad-ground-in-project")

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.dist = os.path.join(cls.tmp, "dist")
        build.build(REPO_ROOT, cls.dist)
        cls.skills_root = os.path.join(cls.dist, "plugins", PLUGIN_NAME, "skills")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def read_bytes(self, path):
        with open(path, "rb") as handle:
            return handle.read()

    def assert_shipped_to(self, parts, skills):
        source = self.read_bytes(os.path.join(REPO_ROOT, "shared", *parts))
        for skill in sorted(os.listdir(self.skills_root)):
            built = os.path.join(self.skills_root, skill, *parts)
            if skill in skills:
                self.assertEqual(self.read_bytes(built), source, "{0} copy differs".format(skill))
            else:
                self.assertFalse(os.path.exists(built), "{0} ships {1}".format(skill, parts[-1]))

    def test_connect_repository_in_the_five_declaring_skills(self):
        self.assert_shipped_to(self.CONNECT, self.CONNECT_SKILLS)

    def test_check_onboarded_in_the_three_declaring_skills(self):
        self.assert_shipped_to(self.CHECK, self.CHECK_SKILLS)
        self.assertFalse(
            os.path.exists(os.path.join(self.skills_root, "paqad-plan-sprint", *self.CHECK))
        )

    def test_undeclared_connect_repository_fails_the_build(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        source = os.path.join(tmp, "source")
        copy_source(source)
        skill_md = os.path.join(source, "skills", "plan-sprint", "SKILL.md")
        with open(skill_md, "a", encoding="utf-8") as handle:
            handle.write("\nGet documents as in references/connect-repository.md.\n")
        with self.assertRaises(build.BuildError) as ctx:
            build.build(source, os.path.join(tmp, "dist"))
        self.assertIn("references/connect-repository.md", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
