#!/usr/bin/env python3
"""Unit tests for the build.py flags that ship the discovery skills inside the paqad plugin.

Standard library only (Python 3.9+). No network. Writes nothing outside temporary folders.

Covers:
  - short published names on every host, with the front door published as start;
  - --host-labels keep and strip (strip removes exactly the description prefix and the
    compatibility line, nothing else);
  - --version, the package.json default and the failure that names a missing package.json;
  - two skills sharing a published name fail naming both;
  - generated skills are self-contained and carry no version.
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
CHECKOUT_ROOT = os.path.dirname(os.path.dirname(REPO_ROOT))
PACKAGE_JSON = os.path.join(CHECKOUT_ROOT, "package.json")
SOURCE_DIRS = ("skills", "shared", "build", "publish")
CHAT_PREFIX = "Chat and Claude Code: "
CHAT_COMPATIBILITY = (
    'compatibility: "claude.ai chat, Cowork or Claude Code; reads project docs and code through a '
    'connector, uploaded files or the open folder"\n'
)
SHORT_NAMES = (
    "ask", "check-tickets", "decide-together", "discover", "get-connected", "ground-in-project",
    "plan-sprint", "post-tickets", "refine-ticket", "shape-idea", "size-work", "start",
    "understand-idea", "write-tickets",
)
FORMER_NAMES = (
    "paqad-discover", "paqad-ask", "paqad-get-connected", "paqad-understand-idea",
    "paqad-ground-in-project", "paqad-shape-idea", "paqad-decide-together", "paqad-write-tickets",
    "paqad-check-tickets", "paqad-post-tickets", "paqad-refine-ticket", "paqad-size-work",
    "paqad-plan-sprint",
)
LEGACY_HOSTS = ("chatgpt", "chatgpt-directory", "codex")
VENDOR_NAMES = ("Claude", "Anthropic", "ChatGPT", "OpenAI", "Codex", "Cowork")


def read_text(path):
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def write_text(path, text):
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)


def read_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def list_files(root):
    found = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for name in sorted(filenames):
            full = os.path.join(dirpath, name)
            with open(full, "rb") as handle:
                found[os.path.relpath(full, root).replace(os.sep, "/")] = handle.read()
    return found


def copy_source(dest):
    for sub in SOURCE_DIRS:
        shutil.copytree(os.path.join(REPO_ROOT, sub), os.path.join(dest, sub))


def label_skill_md(path):
    """Give a SKILL.md the chat prefix and compatibility line when it does not have them yet."""
    text = read_text(path)
    if CHAT_PREFIX in text:
        return
    lines = text.splitlines(True)
    for index, line in enumerate(lines):
        if line.startswith("description:"):
            value = line[len("description:"):].strip()
            if value.startswith('"'):
                value = value[1:-1]
            else:
                value = value.replace("\\", "\\\\").replace('"', '\\"')
            lines[index] = 'description: "' + CHAT_PREFIX + value + '"\n' + CHAT_COMPATIBILITY
            break
    write_text(path, "".join(lines))


def skills_root(dist, host=None):
    base = dist if host is None else os.path.join(dist, "hosts", host)
    return os.path.join(base, "plugins", PLUGIN_NAME, "skills")


class LabelledSourceCase(unittest.TestCase):
    """A temp source with every skill labelled, built once with keep and once with strip."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.source = os.path.join(cls.tmp, "source")
        copy_source(cls.source)
        for name in os.listdir(os.path.join(cls.source, "skills")):
            label_skill_md(os.path.join(cls.source, "skills", name, "SKILL.md"))
        cls.keep = os.path.join(cls.tmp, "keep")
        cls.strip = os.path.join(cls.tmp, "strip")
        build.build(cls.source, cls.keep, version="1.2.3", host_labels="keep")
        build.build(cls.source, cls.strip, version="1.2.3")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)


class HostLabelsTest(LabelledSourceCase):
    def test_ac5_keep_leaves_the_prefix_and_compatibility_line(self):
        """AC-5: --host-labels keep ships the description prefix and the compatibility line."""
        for name in SHORT_NAMES:
            text = read_text(os.path.join(skills_root(self.keep), name, "SKILL.md"))
            self.assertIn('description: "' + CHAT_PREFIX, text, name)
            self.assertIn(CHAT_COMPATIBILITY, text, name)

    def test_ac5_strip_removes_exactly_the_two_labels(self):
        """AC-5: strip differs from keep only by the prefix and the compatibility line."""
        keep_files = list_files(skills_root(self.keep))
        strip_files = list_files(skills_root(self.strip))
        self.assertEqual(sorted(keep_files), sorted(strip_files))
        for rel, kept in keep_files.items():
            stripped = strip_files[rel]
            if not rel.endswith("/SKILL.md"):
                self.assertEqual(kept, stripped, rel)
                continue
            expected = kept.decode("utf-8").replace(CHAT_COMPATIBILITY, "", 1)
            expected = expected.replace('description: "' + CHAT_PREFIX, 'description: "', 1)
            self.assertEqual(stripped.decode("utf-8"), expected, rel)
            self.assertNotIn(CHAT_PREFIX, stripped.decode("utf-8"), rel)
            self.assertNotIn("\ncompatibility:", stripped.decode("utf-8"), rel)

    def test_ac5_strip_touches_only_the_front_matter(self):
        """AC-5: a label-looking line in the body is left alone."""
        text = ('---\nname: x\ndescription: "Claude Code: Does x."\ncompatibility: "y"\n---\n\n'
                "compatibility: stays in the body\ndescription: Claude Code: stays too\n")
        self.assertEqual(
            build.strip_host_labels(text),
            '---\nname: x\ndescription: "Does x."\n---\n\n'
            "compatibility: stays in the body\ndescription: Claude Code: stays too\n",
        )
        self.assertEqual(build.strip_host_labels("no front matter\n"), "no front matter\n")
        plain = "---\nname: x\ndescription: Plain words.\n---\nbody\n"
        self.assertEqual(build.strip_host_labels(plain), plain)

    def test_ac5_an_unknown_host_labels_value_fails(self):
        """AC-5: only strip and keep are accepted."""
        with self.assertRaises(build.BuildError) as ctx:
            build.build(self.source, os.path.join(self.tmp, "bad"), version="1", host_labels="x")
        self.assertIn("--host-labels", str(ctx.exception))

    def test_ac32_legacy_hosts_carry_no_label_and_no_vendor_name(self):
        """AC-32: the ChatGPT, ChatGPT directory and Codex SKILL.md files carry no Decision 9
        prefix, no compatibility line and no vendor name."""
        for host in LEGACY_HOSTS:
            root = skills_root(self.strip, host)
            self.assertEqual(sorted(os.listdir(root)), sorted(SHORT_NAMES), host)
            for name in SHORT_NAMES:
                text = read_text(os.path.join(root, name, "SKILL.md"))
                front = text.split("\n---", 1)[0]
                self.assertNotIn(CHAT_PREFIX, front, (host, name))
                self.assertNotIn("Claude Code: ", front, (host, name))
                self.assertNotIn("compatibility:", front, (host, name))
                for vendor in VENDOR_NAMES:
                    self.assertIsNone(re.search(r"\b" + vendor + r"\b", text), (host, name, vendor))


class ShortNamesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.dist = os.path.join(cls.tmp, "dist")
        build.build(REPO_ROOT, cls.dist)
        cls.config = build.load_config(os.path.join(BUILD_DIR, "skills.yml"))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_ac4_every_host_publishes_the_short_names(self):
        """AC-4: the ChatGPT, ChatGPT directory and Codex packages carry the 14 short names with
        the front door as start, and each SKILL.md name equals its folder."""
        self.assertEqual(sorted(build.published_name(s) for s in self.config["skills"]),
                         sorted(SHORT_NAMES))
        for host in LEGACY_HOSTS + ("claude",):
            root = skills_root(self.dist, host)
            self.assertEqual(sorted(os.listdir(root)), sorted(SHORT_NAMES), host)
            for name in SHORT_NAMES:
                text = read_text(os.path.join(root, name, "SKILL.md"))
                self.assertRegex(text, r"(?m)^name: " + re.escape(name) + r"$")

    def test_ac4_built_content_is_the_source_apart_from_names_and_labels(self):
        """AC-4: every built file equals its source with only the skill names rewritten and the
        two host labels stripped; scripts and other non-markdown files are byte for byte."""
        name_map = {s["name"]: build.published_name(s) for s in self.config["skills"]}
        for skill in self.config["skills"]:
            built_dir = os.path.join(skills_root(self.dist, "codex"), build.published_name(skill))
            sources = {}
            for rel, data in list_files(os.path.join(REPO_ROOT, "skills", skill["name"])).items():
                sources[rel] = data
            for rel in skill["imports"]:
                with open(os.path.join(REPO_ROOT, "shared", rel), "rb") as handle:
                    sources[rel] = handle.read()
            sources = {rel: data for rel, data in sources.items()
                       if "__pycache__" not in rel and not rel.endswith(".pyc")
                       and not rel.endswith(".DS_Store")}
            built = list_files(built_dir)
            self.assertEqual(sorted(built), sorted(sources), skill["name"])
            for rel, data in sources.items():
                if rel.endswith(".md"):
                    expected = build.rewrite_skill_md(data.decode("utf-8"), name_map)
                    if rel == "SKILL.md":
                        expected = build.strip_host_labels(expected)
                    self.assertEqual(built[rel].decode("utf-8"), expected, rel)
                else:
                    self.assertEqual(built[rel], data, rel)

    def test_ac6_no_former_name_and_the_front_door_is_start(self):
        """AC-6: no former paqad- skill name appears as a whole word in any host build."""
        pattern = re.compile(r"(?<![\w-])(?:" + "|".join(FORMER_NAMES) + r")(?![\w-])")
        offenders = []
        for rel, data in list_files(self.dist).items():
            if pattern.search(data.decode("utf-8", "replace")):
                offenders.append(rel)
        self.assertEqual(offenders, [])
        start = read_text(os.path.join(skills_root(self.dist), "start", "SKILL.md"))
        self.assertIn("name: start\n", start)
        for target in ("| ask |", "| discover |", "| refine-ticket |", "| size-work |",
                       "| plan-sprint |"):
            self.assertIn(target, start)

    def test_ac7_every_referenced_file_ships_inside_its_skill(self):
        """AC-7: every references/, scripts/ or assets/ path a SKILL.md names sits inside its own
        folder, and no built file points back at plugins/discovery/."""
        root = skills_root(self.dist, "claude")
        for name in SHORT_NAMES:
            folder = os.path.join(root, name)
            text = read_text(os.path.join(folder, "SKILL.md"))
            for rel in set(re.findall(r"\b((?:references|scripts|assets)/[\w.-]+\.\w+)", text)):
                self.assertTrue(os.path.isfile(os.path.join(folder, rel)), (name, rel))
        for rel, data in list_files(root).items():
            self.assertNotIn(b"plugins/discovery/", data, rel)


class VersionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def manifest_versions(self, dist):
        versions = set()
        for rel, data in list_files(dist).items():
            if rel.endswith(".json") and "/skills/" not in rel:
                manifest = json.loads(data.decode("utf-8"))
                for entry in manifest.get("plugins", [manifest]):
                    versions.add(entry.get("version"))
        return versions

    def test_ac5_version_flag_overrides(self):
        """AC-5: --version sets every manifest version."""
        dist = os.path.join(self.tmp, "dist")
        self.assertEqual(build.main(["--dist", dist, "--version", "9.8.7"]), 0)
        self.assertEqual(self.manifest_versions(dist), {"9.8.7"})

    def test_ac5_absent_version_reads_package_json(self):
        """AC-5: without --version every manifest reads the repository package.json version."""
        dist = os.path.join(self.tmp, "dist")
        build.build(REPO_ROOT, dist)
        self.assertEqual(self.manifest_versions(dist), {read_json(PACKAGE_JSON)["version"]})
        self.assertEqual(os.path.normpath(build.package_json_path(REPO_ROOT)),
                         os.path.normpath(PACKAGE_JSON))

    def test_ac5_missing_package_json_fails_naming_the_file(self):
        """AC-5: with no --version and no package.json the build fails naming the file."""
        source = os.path.join(self.tmp, "a", "b", "source")
        copy_source(source)
        expected = os.path.join(self.tmp, "a", "package.json")
        with self.assertRaises(build.BuildError) as ctx:
            build.build(source, os.path.join(self.tmp, "dist"))
        self.assertIn(expected, str(ctx.exception))
        self.assertEqual(build.main(["--source", source, "--dist", os.path.join(self.tmp, "d")]), 1)
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "d")))

    def test_ac5_package_json_without_a_version_fails(self):
        """AC-5: a package.json with no version or bad JSON fails naming the file."""
        source = os.path.join(self.tmp, "a", "b", "source")
        copy_source(source)
        package = os.path.join(self.tmp, "a", "package.json")
        for content in ('{"name": "x"}', '{"version": "  "}', "not json"):
            write_text(package, content)
            with self.assertRaises(build.BuildError) as ctx:
                build.build(source, os.path.join(self.tmp, "dist"))
            self.assertIn(package, str(ctx.exception))
        write_text(package, '{"version": "4.5.6"}')
        build.build(source, os.path.join(self.tmp, "dist"))
        self.assertEqual(self.manifest_versions(os.path.join(self.tmp, "dist")), {"4.5.6"})

    def test_ac5_skills_yml_holds_no_version_and_bump_version_is_gone(self):
        """AC-5: skills.yml has no version and bump_version.py is deleted."""
        skills_yml_text = read_text(os.path.join(BUILD_DIR, "skills.yml"))
        self.assertIsNone(re.search(r"(?m)^version:", skills_yml_text))
        self.assertFalse(os.path.exists(os.path.join(BUILD_DIR, "bump_version.py")))
        self.assertFalse(os.path.exists(os.path.join(HERE, "test_bump_version.py")))
        source = os.path.join(self.tmp, "source")
        copy_source(source)
        skills_yml = os.path.join(source, "build", "skills.yml")
        write_text(skills_yml, "version: 1.0.0\n" + read_text(skills_yml))
        with self.assertRaises(build.BuildError) as ctx:
            build.load_config(skills_yml, "1.0.0")
        self.assertIn("must not set a version", str(ctx.exception))
        with self.assertRaises(build.BuildError):
            build.load_config(os.path.join(BUILD_DIR, "skills.yml"), " ")

    def test_ac8_claude_skills_do_not_change_with_the_version(self):
        """AC-8: two Claude-host builds with different versions have identical skill folders."""
        dist_a = os.path.join(self.tmp, "a")
        dist_b = os.path.join(self.tmp, "b")
        build.build(REPO_ROOT, dist_a, version="1.0.0", host_labels="keep")
        build.build(REPO_ROOT, dist_b, version="2.0.0", host_labels="keep")
        files_a = list_files(skills_root(dist_a, "claude"))
        self.assertTrue(files_a)
        self.assertEqual(files_a, list_files(skills_root(dist_b, "claude")))
        for rel, data in files_a.items():
            self.assertNotIn(b"1.0.0", data, rel)


class DuplicatePublishNameTest(unittest.TestCase):
    def test_ac15_two_skills_sharing_a_published_name_fail_naming_both(self):
        """AC-15: two skills with the same published name fail the build naming both."""
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        source = os.path.join(tmp, "source")
        copy_source(source)
        skills_yml = os.path.join(source, "build", "skills.yml")
        text = read_text(skills_yml)
        new_text = text.replace("    publish: size-work\n", "    publish: ask\n", 1)
        self.assertNotEqual(new_text, text)
        write_text(skills_yml, new_text)
        with self.assertRaises(build.BuildError) as ctx:
            build.build(source, os.path.join(tmp, "dist"), version="1.0.0")
        message = str(ctx.exception)
        for part in ("ask-project", "size-work", "'ask'"):
            self.assertIn(part, message)


if __name__ == "__main__":
    unittest.main()
