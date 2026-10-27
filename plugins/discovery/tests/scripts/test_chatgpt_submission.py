#!/usr/bin/env python3
"""Unit tests for the ChatGPT directory package, its submission zip and the pre-submission check.

Standard library only. No network. Writes nothing outside temporary working folders. Covers the
native package build/build.py emits under dist/hosts/chatgpt-directory, build/package_chatgpt.py
(a deterministic zip of exactly that plugin root) and build/check_chatgpt_submission.py: the happy
path on the real built package, one failing fixture per rule code, the metadata warning, both input
modes, the input errors and determinism. Every failing fixture mutates a copy of the real package
(or a zip written here); no manifest value is copied by hand.
"""

import contextlib
import io
import json
import os
import shutil
import struct
import sys
import tempfile
import unittest
import warnings
import zipfile
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
BUILD_DIR = os.path.join(REPO_ROOT, "build")
if BUILD_DIR not in sys.path:
    sys.path.insert(0, BUILD_DIR)

import build  # noqa: E402
import check_chatgpt_submission as check  # noqa: E402
import package_chatgpt  # noqa: E402

PLUGIN_NAME = "paqad-product-discovery"
EM_DASH, EN_DASH = chr(0x2014), chr(0x2013)
INTERFACE_AT = "{0}/plugin.json:extensions.com.openai.interface.".format(PLUGIN_NAME)
MANIFEST_AT = "{0}/plugin.json:".format(PLUGIN_NAME)
STATE = {}


def setUpModule():
    STATE["tmp"] = tempfile.mkdtemp()
    STATE["dist"] = os.path.join(STATE["tmp"], "dist")
    build.build(REPO_ROOT, STATE["dist"])
    STATE["config"] = build.load_config(os.path.join(REPO_ROOT, "build", "skills.yml"))
    STATE["package"] = package_chatgpt.default_package_dir(STATE["dist"], STATE["config"])


def tearDownModule():
    shutil.rmtree(STATE["tmp"], ignore_errors=True)


def read_bytes(path):
    with open(path, "rb") as handle:
        return handle.read()


def write_bytes(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(data)


def list_relpaths(root):
    paths = set()
    for dirpath, _, filenames in os.walk(root):
        for name in filenames:
            paths.add(os.path.relpath(os.path.join(dirpath, name), root).replace(os.sep, "/"))
    return paths


def png_bytes(width, height):
    return (b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR"
            + struct.pack(">II", width, height) + b"\x08\x06\x00\x00\x00\x00\x00\x00\x00")


def jpeg_bytes(width, height):
    return (b"\xff\xd8\xff\xe0" + struct.pack(">H", 16) + b"\x00" * 14 + b"\xff\xc0"
            + struct.pack(">HBHH", 17, 8, height, width) + b"\x00" * 12)


def webp_bytes(chunk, width, height):
    if chunk == b"VP8 ":
        payload = b"\x00\x00\x00\x9d\x01\x2a" + struct.pack("<HH", width, height)
    elif chunk == b"VP8L":
        payload = b"\x2f" + ((width - 1) | (height - 1) << 14).to_bytes(4, "little")
    else:
        payload = b"\x00" * 4 + (width - 1).to_bytes(3, "little") + (height - 1).to_bytes(
            3, "little")
    return b"RIFF" + struct.pack("<I", 64) + b"WEBP" + chunk + struct.pack("<I", 16) + payload


def run_main(module, argv):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = module.main(argv)
    return code, out.getvalue(), err.getvalue()


class TempCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def copy_package(self):
        """A writable copy of the real built package, in a folder named after the plugin."""
        root = os.path.join(tempfile.mkdtemp(dir=self.tmp), PLUGIN_NAME)
        shutil.copytree(STATE["package"], root)
        return root

    def edit_manifest(self, root, change):
        path = os.path.join(root, "plugin.json")
        with open(path, encoding="utf-8") as handle:
            manifest = json.load(handle)
        change(manifest)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(manifest, handle, indent=2)

    def edit_interface(self, root, change):
        self.edit_manifest(root, lambda m: change(m["extensions"]["com.openai"]["interface"]))

    def check_folder(self, root):
        return check.check_entries(check.load_package(root), root)

    def check_zip(self, zip_path):
        entries, size = check.load_zip(zip_path)
        return check.check_entries(entries, zip_path, size)

    def real_zip(self, name="real.zip"):
        return package_chatgpt.make_zip(STATE["package"], os.path.join(self.tmp, name))

    def zip_with(self, extra):
        """The real zip plus extra (ZipInfo, bytes) entries appended."""
        path = self.real_zip("extra.zip")
        with zipfile.ZipFile(path, "a") as archive:
            for info, data in extra:
                archive.writestr(info, data)
        return path

    def assert_rule(self, result, rule, path=None):
        matches = [item for item in result["errors"] if item["rule"] == rule]
        self.assertTrue(matches, "no {0} error in {1}".format(rule, result["errors"]))
        self.assertFalse(result["ok"])
        if path is not None:
            self.assertIn(path, [item["path"] for item in matches], matches)
        for item in matches:
            self.assertIn(";", item["message"], item)
        return matches

    def assert_folder_rule(self, mutate, rule, path=None):
        root = self.copy_package()
        mutate(root)
        return self.assert_rule(self.check_folder(root), rule, path)


class PackageLayoutTest(TempCase):
    """AC-1 to AC-4 and AC-19: the native package layout, bytes and manifest."""

    def test_branch_holds_only_the_plugin_root_with_the_documented_files(self):
        branch = os.path.join(STATE["dist"], "hosts", "chatgpt-directory")
        self.assertEqual(os.listdir(branch), ["plugins"])
        self.assertEqual(os.listdir(os.path.join(branch, "plugins")), [PLUGIN_NAME])
        package = STATE["package"]
        self.assertEqual(sorted(os.listdir(package)),
                         ["LICENSE", "PRIVACY.md", "README.md", "TERMS.md", "assets",
                          "plugin.json", "skills"])
        self.assertEqual(os.listdir(os.path.join(package, "assets")), ["logo.png"])
        expected = sorted(build.published_name(s) for s in STATE["config"]["skills"])
        self.assertEqual(sorted(os.listdir(os.path.join(package, "skills"))), expected)

    def test_skills_and_publish_files_are_byte_identical_to_their_sources(self):
        combined = os.path.join(STATE["dist"], "plugins", PLUGIN_NAME, "skills")
        branch = os.path.join(STATE["package"], "skills")
        self.assertEqual(list_relpaths(branch), list_relpaths(combined))
        for rel in list_relpaths(combined):
            self.assertEqual(read_bytes(os.path.join(branch, rel)),
                             read_bytes(os.path.join(combined, rel)), rel)
        for source, target in (("publish/chatgpt/README.md", "README.md"),
                               ("publish/claude/LICENSE", "LICENSE"),
                               ("publish/claude/PRIVACY.md", "PRIVACY.md"),
                               ("publish/claude/TERMS.md", "TERMS.md"),
                               ("publish/claude/icon.png", "assets/logo.png")):
            self.assertEqual(read_bytes(os.path.join(STATE["package"], *target.split("/"))),
                             read_bytes(os.path.join(REPO_ROOT, *source.split("/"))), target)

    def test_manifest_keys_and_values_come_from_the_single_source(self):
        config = STATE["config"]
        with open(os.path.join(STATE["package"], "plugin.json"), encoding="utf-8") as handle:
            manifest = json.load(handle)
        self.assertEqual(manifest, build.build_chatgpt_directory_manifest(config))
        self.assertEqual(tuple(manifest), build.AGENT_PLUGINS_MANIFEST_KEYS)
        self.assertEqual(manifest["$schema"],
                         "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json")
        for key in ("name", "version", "description", "homepage", "repository", "license"):
            self.assertEqual(manifest[key], config[key], key)
        self.assertEqual(manifest["author"], {"name": config["author"],
                                              "email": config["author_email"]})
        self.assertEqual(manifest["keywords"], config["keywords"])
        interface = manifest["extensions"]["com.openai"]["interface"]
        self.assertEqual(tuple(interface), build.CHATGPT_INTERFACE_KEYS)
        self.assertEqual(interface["shortDescription"], "Ideas to ready tickets")
        self.assertEqual(interface["category"], "Productivity")
        pairs = (("displayName", "display_name"), ("longDescription", "long_description"),
                 ("developerName", "author"), ("capabilities", "capabilities"),
                 ("defaultPrompt", "default_prompts"), ("websiteURL", "homepage"),
                 ("supportURL", "support_url"), ("privacyPolicyURL", "privacy_policy_url"),
                 ("termsOfServiceURL", "terms_of_service_url"))
        for key, scalar in pairs:
            self.assertEqual(interface[key], config[scalar], key)
        self.assertEqual(interface["logo"], "./assets/logo.png")
        for absent in ("screenshots", "brandColor", "brandColorDark", "composerIcon"):
            self.assertNotIn(absent, interface)

    def test_readme_is_an_end_user_guide_with_no_version_or_dash(self):
        text = read_bytes(os.path.join(REPO_ROOT, "publish", "chatgpt", "README.md")).decode()
        for phrase in ("`/paqad`", "`paqad-ask`", "`paqad-discover`", "`paqad-refine-ticket`",
                       "`paqad-size-work`", "`paqad-plan-sprint`", "## Example prompts",
                       "code execution", "connector", "## Install", "ChatGPT plugin directory",
                       STATE["config"]["support_url"], STATE["config"]["privacy_policy_url"]):
            self.assertIn(phrase, text)
        self.assertNotIn(STATE["config"]["version"], text)
        self.assertNotIn(EM_DASH, text)
        self.assertNotIn(EN_DASH, text)

    def test_building_creates_no_zip(self):
        self.assertFalse([p for p in list_relpaths(STATE["dist"]) if p.endswith(".zip")])


class ZipTest(TempCase):
    """AC-6 and AC-7: the real zip passes the check and is byte-identical across two runs."""

    def test_real_zip_passes_with_no_error_and_no_warning(self):
        path = self.real_zip()
        code, out, _ = run_main(check, ["--zip", path])
        self.assertEqual(code, 0)
        result = json.loads(out)
        self.assertEqual((result["ok"], result["errors"], result["warnings"]), (True, [], []))
        self.assertEqual(result["source"], path)

    def test_two_runs_are_byte_identical_and_use_the_fixed_encoding(self):
        first = self.real_zip("a.zip")
        second = self.real_zip("b.zip")
        self.assertEqual(read_bytes(first), read_bytes(second))
        with zipfile.ZipFile(first) as archive:
            infos = archive.infolist()
            self.assertEqual(archive.comment, b"")
        names = [info.filename for info in infos]
        self.assertEqual(names, sorted(names))
        self.assertEqual({name.split("/")[0] for name in names}, {PLUGIN_NAME})
        self.assertEqual(names[0], PLUGIN_NAME + "/")
        folders = {name for name in names if name.endswith("/")}
        for name in names:
            parent = name.rstrip("/").rsplit("/", 1)[0] + "/"
            if name != PLUGIN_NAME + "/":
                self.assertIn(parent, folders, name)
            self.assertNotIn("\\", name)
        files = [name[len(PLUGIN_NAME) + 1:] for name in names if not name.endswith("/")]
        self.assertEqual(set(files), list_relpaths(STATE["package"]))
        for info in infos:
            self.assertEqual(info.date_time, (1980, 1, 1, 0, 0, 0))
            self.assertEqual(info.create_system, 3)
            if info.filename.endswith("/"):
                self.assertEqual(info.external_attr, (0o040755 << 16) | 0x10)
                self.assertEqual(info.compress_type, zipfile.ZIP_STORED)
            else:
                self.assertEqual(info.external_attr, 0o100644 << 16)
                self.assertEqual(info.compress_type, zipfile.ZIP_DEFLATED)

    def test_cli_writes_the_zip_and_prints_its_path(self):
        out_path = os.path.join(self.tmp, "nested", "cli.zip")
        code, out, _ = run_main(package_chatgpt, ["--dist", STATE["dist"], "--out", out_path])
        self.assertEqual((code, out.strip()), (0, out_path))
        self.assertEqual(read_bytes(out_path), read_bytes(self.real_zip()))

    def test_default_zip_name_reads_name_and_version(self):
        self.assertEqual(package_chatgpt.default_zip_name(STATE["config"]),
                         "{0}-chatgpt-v{1}.zip".format(PLUGIN_NAME, STATE["config"]["version"]))


class PackageErrorTest(TempCase):
    """AC-8: missing package, symlinks and odd entries stop the packer; cruft is skipped."""

    def dist_copy(self):
        dist = os.path.join(self.tmp, "dist")
        branch = os.path.join(dist, "hosts", "chatgpt-directory")
        shutil.copytree(os.path.join(STATE["dist"], "hosts", "chatgpt-directory"), branch)
        return dist, package_chatgpt.default_package_dir(dist, STATE["config"])

    def run_packer(self, dist):
        return run_main(package_chatgpt, ["--dist", dist, "--out",
                                          os.path.join(self.tmp, "out.zip")])

    def test_missing_package_exits_1(self):
        missing = os.path.join(self.tmp, "nodist")
        code, out, err = self.run_packer(missing)
        self.assertEqual((code, out), (1, ""))
        package = package_chatgpt.default_package_dir(missing, STATE["config"])
        self.assertEqual(err, "ChatGPT directory package not found at {0}; run python3 "
                              "build/build.py first\n".format(package))

    def test_symlinked_file_and_folder_exit_1(self):
        for target in ("README.md", "skills"):
            dist, package = self.dist_copy()
            link = os.path.join(package, "skills", "paqad", "link")
            os.symlink(os.path.join(package, target), link)
            code, _, err = self.run_packer(dist)
            self.assertEqual(code, 1)
            self.assertEqual(err, "{0} is a symlink; the directory zip allows regular files "
                                  "and folders only\n".format(link))
            self.assertFalse(os.path.exists(os.path.join(self.tmp, "out.zip")))
            shutil.rmtree(dist)

    def test_a_fifo_exits_1(self):
        dist, package = self.dist_copy()
        os.mkfifo(os.path.join(package, "pipe"))
        code, _, err = self.run_packer(dist)
        self.assertEqual(code, 1)
        self.assertIn("is not a regular file or folder", err)

    def test_cruft_is_skipped(self):
        dist, package = self.dist_copy()
        write_bytes(os.path.join(package, ".DS_Store"), b"cruft")
        write_bytes(os.path.join(package, "skills", "paqad", "__pycache__", "x.cpython.pyc"), b"x")
        write_bytes(os.path.join(package, "skills", "paqad", "x.pyc"), b"x")
        code, _, _ = self.run_packer(dist)
        self.assertEqual(code, 0)
        with zipfile.ZipFile(os.path.join(self.tmp, "out.zip")) as archive:
            names = archive.namelist()
        for name in names:
            self.assertNotIn(".DS_Store", name)
            self.assertNotIn("__pycache__", name)
            self.assertFalse(name.endswith(".pyc"), name)
        self.assertEqual(read_bytes(os.path.join(self.tmp, "out.zip")),
                         read_bytes(self.real_zip()))

    def test_a_bad_skills_yml_exits_1(self):
        with mock.patch.object(build, "load_config", side_effect=build.BuildError("bad yml")):
            code, _, err = self.run_packer(STATE["dist"])
        self.assertEqual((code, err), (1, "bad yml\n"))


class ArchiveRuleTest(TempCase):
    """AC-9 and AC-13: the archive-level rules."""

    def test_size_and_count_limits(self):
        entries, size = check.load_zip(self.real_zip())
        result = check.check_entries(entries, "x", build.CHATGPT_LIMITS["zip_compressed_bytes"] + 1)
        self.assert_rule(result, "archive.compressed_size", ".")
        with mock.patch.dict(build.CHATGPT_LIMITS, {"zip_entries": 10}):
            self.assert_rule(check.check_entries(entries, "x", size), "archive.entry_count", ".")
        with mock.patch.dict(build.CHATGPT_LIMITS, {"zip_uncompressed_bytes": 1000}):
            self.assert_rule(check.check_entries(entries, "x", size), "archive.uncompressed_size")
            entries, size = check.load_zip(self.real_zip("big.zip"))
            result = check.check_entries(entries, "x", size)
        self.assertEqual({item["rule"] for item in result["errors"]}, {"archive.uncompressed_size"})

    def test_symlink_and_odd_entries_in_a_zip(self):
        link = zipfile.ZipInfo(PLUGIN_NAME + "/skills/paqad/link")
        link.external_attr = 0o120777 << 16
        fifo = zipfile.ZipInfo(PLUGIN_NAME + "/pipe")
        fifo.external_attr = 0o010644 << 16
        odd_dir = zipfile.ZipInfo(PLUGIN_NAME + "/odd/")
        odd_dir.external_attr = 0o100644 << 16
        result = self.check_zip(self.zip_with([(link, b"../x"), (fifo, b""), (odd_dir, b"")]))
        for path in (link.filename, fifo.filename, odd_dir.filename):
            self.assert_rule(result, "archive.entry_type", path)

    def test_symlink_in_a_folder_is_reported_not_followed(self):
        root = self.copy_package()
        outside = os.path.join(self.tmp, "outside")
        os.makedirs(outside)
        os.symlink(outside, os.path.join(root, "skills", "paqad", "dirlink"))
        os.symlink(os.path.join(root, "LICENSE"), os.path.join(root, "filelink"))
        result = self.check_folder(root)
        self.assert_rule(result, "archive.entry_type", PLUGIN_NAME + "/skills/paqad/dirlink")
        self.assert_rule(result, "archive.entry_type", PLUGIN_NAME + "/filelink")

    def test_unsafe_paths_are_reported_and_nothing_is_written(self):
        names = ["../outside.txt", "/abs.txt", "C:/drive.txt", PLUGIN_NAME + "\\back.txt",
                 PLUGIN_NAME + "//empty.txt", PLUGIN_NAME + "/" + "/".join(["d"] * 20) + "/f.txt"]
        path = self.zip_with([(zipfile.ZipInfo(name), b"x") for name in names])
        work = os.path.join(self.tmp, "work")
        os.makedirs(work)
        before = sorted(os.listdir(self.tmp))
        cwd = os.getcwd()
        os.chdir(work)
        try:
            result = self.check_zip(path)
        finally:
            os.chdir(cwd)
        for name in names:
            self.assert_rule(result, "archive.path", name)
        self.assertEqual(os.listdir(work), [])
        self.assertEqual(sorted(os.listdir(self.tmp)), before)
        self.assertFalse(os.path.exists(os.path.join(os.path.dirname(self.tmp), "outside.txt")))

    def test_dot_segments_are_reported(self):
        names = [PLUGIN_NAME + "/./dot.txt", "./" + PLUGIN_NAME + "/lead.txt",
                 PLUGIN_NAME + "/skills/."]
        result = self.check_zip(self.zip_with([(zipfile.ZipInfo(name), b"x") for name in names]))
        for name in names:
            matches = self.assert_rule(result, "archive.path", name)
            self.assertIn("'.'", matches[0]["message"])

    def test_duplicate_entry_names_are_reported(self):
        extra = [(zipfile.ZipInfo(PLUGIN_NAME + "/plugin.json"), b"{}"),
                 (zipfile.ZipInfo(PLUGIN_NAME + "/skills/paqad/SKILL.md"), b"---\n---\n")]
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            path = self.zip_with(extra)
        result = self.check_zip(path)
        for info, _ in extra:
            matches = self.assert_rule(result, "archive.duplicate_entry", info.filename)
            self.assertIn("unique", matches[0]["message"])
        self.assertEqual(len([e for e in result["errors"]
                              if e["rule"] == "archive.duplicate_entry"]), 2)

    def test_a_folder_and_file_with_one_name_are_duplicates(self):
        name = PLUGIN_NAME + "/skills/paqad/SKILL.md"
        path = self.zip_with([(zipfile.ZipInfo(name + "/"), b"")])
        self.assert_rule(self.check_zip(path), "archive.duplicate_entry", name + "/")

    def test_plugin_root_must_be_single(self):
        two_roots = self.zip_with([(zipfile.ZipInfo("other/plugin.json"), b"{}")])
        self.assert_rule(self.check_zip(two_roots), "plugin_root_ambiguous", ".")
        sibling = self.zip_with([(zipfile.ZipInfo("notes.txt"), b"x")])
        self.assert_rule(self.check_zip(sibling), "plugin_root_ambiguous", ".")

    def test_manifest_at_the_archive_root_is_accepted(self):
        path = os.path.join(self.tmp, "flat.zip")
        with zipfile.ZipFile(path, "w") as archive:
            for rel in sorted(list_relpaths(STATE["package"])):
                archive.writestr(rel, read_bytes(os.path.join(STATE["package"], rel)))
        result = self.check_zip(path)
        self.assertEqual(result["errors"], [])

    def test_missing_manifest(self):
        matches = self.assert_folder_rule(
            lambda root: os.remove(os.path.join(root, "plugin.json")), "manifest.missing",
            PLUGIN_NAME + "/plugin.json")
        self.assertIn("plugin.json", matches[0]["message"])
        root = self.copy_package()
        os.remove(os.path.join(root, "plugin.json"))
        self.assert_rule(self.check_folder(root), "plugin_root_ambiguous", PLUGIN_NAME)


class ExcludedContentTest(TempCase):
    """AC-9: excluded content anywhere in the plugin, and the skill files that stay allowed."""

    CASES = (
        ("apps/app.txt", "excluded.app", "apps"),
        ("skills/paqad/.app.json", "excluded.app", None),
        ("skills/paqad/.mcp.json", "excluded.mcp", None),
        ("mcp.json", "excluded.mcp", None),
        ("hooks/run.sh", "excluded.hooks", "hooks"),
        ("skills/paqad/hooks.json", "excluded.hooks", None),
        ("commands/go.md", "excluded.commands", "commands"),
        ("agents/helper.md", "excluded.agents", "agents"),
        ("bin/tool", "excluded.bin", "bin"),
        ("skills/paqad/CLAUDE.md", "excluded.claude_files", None),
        (".claude/settings.local.json", "excluded.claude_files", None),
        ("test_credentials.txt", "excluded.reviewer_files", None),
        ("skills/paqad/reviewer_instructions.md", "excluded.reviewer_files", None),
        (".env", "excluded.secret", None),
        ("skills/paqad/.env.local", "excluded.secret", None),
        ("server.pem", "excluded.secret", None),
        ("skills/paqad/signing.key", "excluded.secret", None),
        ("cert.p12", "excluded.secret", None),
        ("cert.pfx", "excluded.secret", None),
        ("id_rsa", "excluded.secret", None),
        ("id_ed25519.pub", "excluded.secret", None),
    )

    def test_each_excluded_item_fails(self):
        for rel, rule, folder in self.CASES:
            with self.subTest(rel=rel):
                expected = PLUGIN_NAME + "/" + (folder or rel)
                self.assert_folder_rule(
                    lambda root: write_bytes(os.path.join(root, *rel.split("/")), b"x"),
                    rule, expected)

    def test_per_skill_agents_file_and_helper_scripts_stay_allowed(self):
        root = self.copy_package()
        write_bytes(os.path.join(root, "skills", "paqad", "agents", "openai.yaml"), b"x: y\n")
        write_bytes(os.path.join(root, "skills", "paqad", "scripts", "helper.py"), b"print(1)\n")
        self.assertEqual(self.check_folder(root)["errors"], [])


class ManifestRuleTest(TempCase):
    """AC-9: the root plugin.json rules."""

    def manifest_rule(self, change, rule, field):
        return self.assert_folder_rule(lambda root: self.edit_manifest(root, change), rule,
                                       MANIFEST_AT + field)

    def test_bad_json(self):
        for data in (b"{not json", b"[1, 2]", b"\xff\xfe"):
            with self.subTest(data=data):
                self.assert_folder_rule(
                    lambda root: write_bytes(os.path.join(root, "plugin.json"), data),
                    "manifest.json", PLUGIN_NAME + "/plugin.json")

    def test_unknown_key_and_schema(self):
        self.manifest_rule(lambda m: m.update(skills=[]), "manifest.unknown_key", "skills")
        self.manifest_rule(lambda m: m.update({"$schema": "https://example.com/s.json"}),
                           "manifest.schema", "$schema")
        self.manifest_rule(lambda m: m.pop("$schema"), "manifest.schema", "$schema")

    def test_name_and_version(self):
        for name in ("Bad Name", "a--b", "x" * 65, "", None):
            with self.subTest(name=name):
                matches = self.manifest_rule(lambda m: m.update(name=name), "manifest.name",
                                             "name")
                self.assertIn("'name' in build/skills.yml", matches[0]["message"])
        for version in ("3.2", "v3.2.0", "1.0.0-01", "1." + "0" * 64 + ".0"):
            with self.subTest(version=version):
                self.manifest_rule(lambda m: m.update(version=version), "manifest.version",
                                   "version")

    def test_description_and_keywords(self):
        self.manifest_rule(lambda m: m.update(description=" "), "manifest.description",
                           "description")
        self.manifest_rule(lambda m: m.update(description="d" * 1025), "manifest.description",
                           "description")
        self.manifest_rule(lambda m: m.update(keywords=["ok", ""]), "manifest.keywords",
                           "keywords")
        self.manifest_rule(lambda m: m.update(keywords="one"), "manifest.keywords", "keywords")

    def test_author(self):
        def set_author(value):
            return lambda m: m.update(author=value)
        for value in ("Eliyce", None, {"name": "x", "role": "y"}, {"name": ""},
                      {"name": "x" * 121}, {"name": "x", "email": "no-at"},
                      {"name": "x", "email": "a@b@c"}, {"name": "x", "email": 5}):
            with self.subTest(author=value):
                self.manifest_rule(set_author(value), "manifest.author", "author")
        self.manifest_rule(set_author({"name": "x", "url": "https://example.com/" + "a" * 2048}),
                           "manifest.url", "author.url")

    def test_urls(self):
        self.manifest_rule(lambda m: m.update(homepage="http://example.com"), "manifest.url",
                           "homepage")
        self.manifest_rule(lambda m: m.update(homepage="https://user:pw@example.com"),
                           "manifest.url", "homepage")
        self.manifest_rule(lambda m: m.update(repository="ftp://example.com"), "manifest.url",
                           "repository")
        self.manifest_rule(lambda m: m.update(homepage=5), "manifest.url", "homepage")
        root = self.copy_package()
        self.edit_manifest(root, lambda m: m.update(repository={"type": "git"}))
        self.assertEqual(self.check_folder(root)["errors"], [])

    def test_extensions(self):
        self.manifest_rule(lambda m: m.pop("extensions"), "manifest.extensions", "extensions")
        self.manifest_rule(lambda m: m.update(extensions={"com.openai": []}),
                           "manifest.extensions", "extensions")
        self.manifest_rule(lambda m: m.update(extensions=[]), "manifest.extensions",
                           "extensions")


class InterfaceRuleTest(TempCase):
    """AC-9: the extensions.com.openai.interface rules."""

    def interface_rule(self, change, rule, field):
        return self.assert_folder_rule(lambda root: self.edit_interface(root, change), rule,
                                       INTERFACE_AT + field)

    def test_required_and_length(self):
        for key in check.INTERFACE_REQUIRED:
            with self.subTest(key=key):
                self.interface_rule(lambda i: i.pop(key), "interface.required", key)
        for key, limit in (("displayName", 30), ("shortDescription", 30),
                           ("longDescription", 4000), ("developerName", 80)):
            with self.subTest(key=key):
                matches = self.interface_rule(lambda i: i.update({key: "x" * (limit + 1)}),
                                              "interface.length", key)
                self.assertIn(str(limit), matches[0]["message"])
        matches = self.interface_rule(lambda i: i.update(shortDescription="x" * 31),
                                      "interface.length", "shortDescription")
        self.assertIn("'short_description' in build/skills.yml", matches[0]["message"])

    def test_single_line(self):
        self.interface_rule(lambda i: i.update(shortDescription="Ideas\nto tickets"),
                            "interface.single_line", "shortDescription")
        self.interface_rule(lambda i: i.update(displayName="A\rB"), "interface.single_line",
                            "displayName")
        self.interface_rule(lambda i: i["capabilities"].append("two\nlines"),
                            "interface.single_line", "capabilities")
        self.interface_rule(lambda i: i.update(defaultPrompt=["two\nlines"]),
                            "interface.single_line", "defaultPrompt")

    def test_category(self):
        self.interface_rule(lambda i: i.update(category="productivity"), "interface.category",
                            "category")
        self.interface_rule(lambda i: i.pop("category"), "interface.category", "category")

    def test_capabilities(self):
        for value in ("one", ["c"] * 21, ["x" * 121], [""], [5]):
            with self.subTest(value=value):
                self.interface_rule(lambda i: i.update(capabilities=value),
                                    "interface.capabilities", "capabilities")
        root = self.copy_package()
        self.edit_interface(root, lambda i: i.pop("capabilities"))
        self.assertEqual(self.check_folder(root)["errors"], [])

    def test_default_prompt(self):
        for value in ("one", ["a", "b", "c", "d"], ["same", "same"], ["Ask @team now"],
                      ["x" * 129], [""]):
            with self.subTest(value=value):
                self.interface_rule(lambda i: i.update(defaultPrompt=value),
                                    "interface.default_prompt", "defaultPrompt")
        root = self.copy_package()
        self.edit_interface(root, lambda i: i.update(defaultPrompt=["mail me at a @ b"]))
        self.assertEqual(self.check_folder(root)["errors"], [])

    def test_brand_colors(self):
        for key, value in (("brandColor", "#FFFFFE"), ("brandColor", "red"),
                           ("brandColor", 5), ("brandColorDark", "#222222")):
            with self.subTest(key=key, value=value):
                self.interface_rule(lambda i: i.update({key: value}), "interface.brand_color",
                                    key)
        root = self.copy_package()
        self.edit_interface(root, lambda i: i.update(brandColor="#0B5FFF",
                                                     brandColorDark="#7FB2FF"))
        self.assertEqual(self.check_folder(root)["errors"], [])
        self.assertAlmostEqual(check.contrast_ratio("#FFFFFF", "#000000"), 21.0)

    def test_interface_urls(self):
        for key, value in (("supportURL", "http://example.com"),
                           ("websiteURL", "https://u:p@example.com"),
                           ("privacyPolicyURL", "https://example.com/" + "a" * 1024),
                           ("termsOfServiceURL", "https:///nohost")):
            with self.subTest(key=key):
                self.interface_rule(lambda i: i.update({key: value}), "interface.url", key)

    def test_screenshots_are_excluded(self):
        self.interface_rule(lambda i: i.update(screenshots=[]),
                            "screenshot_configuration_excluded", "screenshots")


class AssetRuleTest(TempCase):
    """AC-9: the logo and composerIcon rules."""

    def with_logo(self, rel, data, key="logo"):
        def mutate(root):
            write_bytes(os.path.join(root, *rel.split("/")), data)
            self.edit_interface(root, lambda i: i.update({key: "./" + rel}))
        return mutate

    def test_path(self):
        for value in ("assets/logo.png", "./../outside.png", "./missing.png", 5):
            with self.subTest(value=value):
                self.assert_folder_rule(
                    lambda root: self.edit_interface(root, lambda i: i.update(logo=value)),
                    "asset.path", INTERFACE_AT + "logo")

    def test_format(self):
        real = read_bytes(os.path.join(REPO_ROOT, "publish", "claude", "icon.png"))
        for rel, data in (("assets/logo.jpg", real), ("assets/logo.png", b"plain text"),
                          ("assets/logo.gif", real)):
            with self.subTest(rel=rel):
                self.assert_folder_rule(self.with_logo(rel, data), "asset.format",
                                        PLUGIN_NAME + "/" + rel)

    def test_dimensions(self):
        cases = (
            ("assets/logo.png", png_bytes(100, 80)),
            ("assets/logo.png", png_bytes(32, 32)),
            ("assets/logo.png", png_bytes(5000, 5000)),
            ("assets/logo.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 30),
            ("assets/logo.jpg", jpeg_bytes(100, 90)),
            ("assets/logo.jpg", b"\xff\xd8\xff" + b"\x00" * 20),
            ("assets/logo.webp", webp_bytes(b"VP8 ", 40, 40)),
            ("assets/logo.webp", webp_bytes(b"VP8L", 100, 99)),
            ("assets/logo.webp", webp_bytes(b"VP8X", 4097, 4097)),
            ("assets/logo.webp", webp_bytes(b"ABCD", 64, 64)),
            ("assets/logo.svg", b'<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
            ("assets/logo.svg", b'<svg viewBox="0 0 10 20"></svg>'),
            ("assets/logo.svg", b'<svg viewBox="0 0 a b"></svg>'),
        )
        for rel, data in cases:
            with self.subTest(rel=rel, data=data[:24]):
                self.assert_folder_rule(self.with_logo(rel, data), "asset.dimensions",
                                        PLUGIN_NAME + "/" + rel)

    def test_good_formats_and_composer_icon_pass(self):
        for rel, data in (("assets/logo.jpg", jpeg_bytes(512, 512)),
                          ("assets/logo.webp", webp_bytes(b"VP8 ", 64, 64)),
                          ("assets/logo.webp", webp_bytes(b"VP8L", 300, 300)),
                          ("assets/logo.webp", webp_bytes(b"VP8X", 4096, 4096)),
                          ("assets/logo.svg", b'<?xml version="1.0"?><svg viewBox="0,0,24,24">'
                                              b'</svg>')):
            with self.subTest(rel=rel):
                root = self.copy_package()
                self.with_logo(rel, data, "composerIcon")(root)
                self.assertEqual(self.check_folder(root)["errors"], [])

    def test_size(self):
        with mock.patch.dict(build.CHATGPT_LIMITS, {"asset_bytes": 1000}):
            self.assert_folder_rule(lambda root: None, "asset.size",
                                    PLUGIN_NAME + "/assets/logo.png")


class SkillRuleTest(TempCase):
    """AC-9 and AC-10: the skills/ and SKILL.md rules and the metadata warning."""

    def skill_md(self, root, skill="paqad"):
        return os.path.join(root, "skills", skill, "SKILL.md")

    def set_skill_md(self, data, skill="paqad"):
        return lambda root: write_bytes(self.skill_md(root, skill), data)

    def skill_rule(self, data, rule, skill="paqad"):
        return self.assert_folder_rule(self.set_skill_md(data, skill), rule,
                                       "{0}/skills/{1}/SKILL.md".format(PLUGIN_NAME, skill))

    def test_skills_folder_rules(self):
        skills = PLUGIN_NAME + "/skills"
        self.assert_folder_rule(lambda root: shutil.rmtree(os.path.join(root, "skills")),
                                "skills.missing", skills)

        def empty(root):
            shutil.rmtree(os.path.join(root, "skills"))
            os.makedirs(os.path.join(root, "skills"))
        self.assert_folder_rule(empty, "skills.missing", skills)
        self.assert_folder_rule(
            lambda root: write_bytes(os.path.join(root, "skills", "notes.md"), b"x"),
            "skills.stray_file", skills + "/notes.md")
        self.assert_folder_rule(
            lambda root: write_bytes(os.path.join(root, "skills", ".hidden", "SKILL.md"), b"x"),
            "skills.hidden_dir", skills + "/.hidden")
        self.assert_folder_rule(lambda root: os.remove(self.skill_md(root)),
                                "skill.missing_skill_md", skills + "/paqad/SKILL.md")

    def test_utf8_and_frontmatter(self):
        self.skill_rule(b"---\nname: \xff\n---\nbody\n", "skill.utf8")
        for text in ("no frontmatter\n", "---\nname: paqad\n", "---\n  indented: x\n---\nb\n",
                     "---\nname: paqad\ndescription: >\n  folded\n---\nb\n",
                     "---\nname: 'open\n---\nb\n", "---\njust words\n---\nb\n",
                     "---\nname: a\nname: b\n---\nb\n"):
            with self.subTest(text=text):
                self.skill_rule(text.encode(), "skill.frontmatter")

    def test_name_and_description(self):
        for text in ("---\ndescription: d\n---\nbody\n", "---\nname: 123\ndescription: d\n---\nb\n",
                     "---\nname: [a]\ndescription: d\n---\nb\n",
                     "---\nname: '{0}'\ndescription: d\n---\nb\n".format("n" * 41)):
            with self.subTest(text=text):
                self.skill_rule(text.encode(), "skill.name")
        self.skill_rule(b"---\nname: paqad\n---\nbody\n", "skill.description")
        long_text = "---\nname: paqad\ndescription: {0}\n---\nbody\n".format("d" * 1025)
        self.skill_rule(long_text.encode(), "skill.description")

    def test_duplicate_skill_name(self):
        def duplicate(root):
            text = read_bytes(self.skill_md(root, "paqad-ask")).decode("utf-8")
            write_bytes(self.skill_md(root, "paqad-ask"),
                        text.replace("name: paqad-ask", "name: paqad", 1).encode("utf-8"))
        matches = self.assert_folder_rule(duplicate, "skill.name",
                                          PLUGIN_NAME + "/skills/paqad-ask/SKILL.md")
        self.assertIn("also used by", matches[0]["message"])

    def test_empty_body(self):
        self.skill_rule(b"---\nname: paqad\ndescription: d\n---\n \n\n", "skill.body")

    def test_metadata_is_a_warning_only(self):
        def add_metadata(root):
            text = read_bytes(self.skill_md(root)).decode("utf-8")
            text = text.replace("---\n", "---\nmetadata:\n  owner: team\n  tags: [a]\n", 1)
            write_bytes(self.skill_md(root), text.encode("utf-8"))
        root = self.copy_package()
        add_metadata(root)
        code, out, _ = run_main(check, ["--package", root])
        result = json.loads(out)
        self.assertEqual((code, result["ok"], result["errors"]), (0, True, []))
        self.assertEqual([(w["rule"], w["path"]) for w in result["warnings"]],
                         [("skill.metadata", PLUGIN_NAME + "/skills/paqad/SKILL.md")])

    def test_unquoted_values_a_strict_yaml_parser_rejects(self):
        cases = (
            ("description: the steps: one, two", "contains ': '"),
            ("description: tab\tafter:\tcolon", "contains ': '"),
            ("description: a value # read as a comment", "contains ' #'"),
            ("description: ends with a colon:", "ends with ':'"),
            ("description: &anchor value", "YAML indicator '&'"),
            ("description: - a list item", "YAML indicator '-'"),
            ("description: # only a comment", "YAML indicator '#'"),
        )
        for line, reason in cases:
            text = "---\nname: paqad\n{0}\n---\nbody\n".format(line)
            with self.subTest(line=line):
                matches = self.skill_rule(text.encode("utf-8"), "skill.frontmatter")
                self.assertIn("line 3", matches[0]["message"])
                self.assertIn(reason, matches[0]["message"])
                self.assertIn("double-quote the value", matches[0]["message"])

    def test_bad_quoted_values_are_rejected(self):
        for line, reason in (('description: "open', "unterminated double-quoted"),
                             ("description: 'open", "unterminated single-quoted"),
                             ('description: "bad \\q escape"', "invalid escape"),
                             ('description: "a" b', "text after the closing quote"),
                             ("description: 'it's'", "text after the closing quote")):
            text = "---\nname: paqad\n{0}\n---\nbody\n".format(line)
            with self.subTest(line=line):
                matches = self.skill_rule(text.encode("utf-8"), "skill.frontmatter")
                self.assertIn("line 3", matches[0]["message"])
                self.assertIn(reason, matches[0]["message"])

    def test_plain_values_a_parser_reads_as_non_strings(self):
        for value in ("2026-10-16", "1e3", "0x1F", ".inf", "Null", "~", "12:30"):
            mapping, _ = check.parse_frontmatter("---\nname: {0}\n---\nb".format(value))
            with self.subTest(value=value):
                self.assertIsNone(mapping["name"])

    def test_quoted_descriptions_parse_to_their_text(self):
        mapping, _ = check.parse_frontmatter(
            "---\nname: paqad\n"
            "description: \"It's grounded: get connected, then \\\"post it\\\" # not a comment\" "
            "# a real comment\n"
            "summary: 'It''s fine: ok \"here\" # too'\n"
            "escapes: \"tab\\there \\\\ back \\u00e9 \\x41\"\n"
            "plain: a plain value with:no space after colon#hash and it's fine\n---\nb")
        self.assertEqual(mapping, {
            "name": "paqad",
            "description": 'It\'s grounded: get connected, then "post it" # not a comment',
            "summary": 'It\'s fine: ok "here" # too',
            "escapes": "tab\there \\ back \u00e9 A",
            "plain": "a plain value with:no space after colon#hash and it's fine",
        })

    def test_published_quoted_descriptions_read_as_their_source_text(self):
        skills = os.path.join(STATE["package"], "skills")
        quoted = 0
        for folder in sorted(os.listdir(skills)):
            text = read_bytes(os.path.join(skills, folder, "SKILL.md")).decode("utf-8")
            line = next(l for l in text.split("\n") if l.startswith("description: "))
            raw = line[len("description: "):]
            description = check.parse_frontmatter(text)[0]["description"]
            with self.subTest(skill=folder):
                self.assertFalse(description.startswith(('"', "'")))
                if raw.startswith('"'):
                    quoted += 1
                    self.assertEqual(description, json.loads(raw))
                    self.assertIn(": ", description)
                else:
                    self.assertEqual(description, raw)
        self.assertGreaterEqual(quoted, 3)

    def test_quoted_and_crlf_frontmatter_is_read(self):
        mapping, body = check.parse_frontmatter(
            "---\r\n# comment\r\nname: \"pa\\\"q\"\r\ndescription: 'it''s'\r\n\r\n---\r\nbody")
        self.assertEqual(mapping, {"name": 'pa"q', "description": "it's"})
        self.assertEqual(body, "body")


class ModeTest(TempCase):
    """AC-11 and AC-12: both input modes agree, the default mode finds the build, input errors."""

    def test_package_mode_and_default_mode_pass(self):
        code, out, _ = run_main(check, ["--package", STATE["package"]])
        self.assertEqual((code, json.loads(out)["source"]), (0, STATE["package"]))
        repo = os.path.join(self.tmp, "repo")
        shutil.copytree(os.path.join(REPO_ROOT, "build"), os.path.join(repo, "build"))
        shutil.copytree(STATE["dist"], os.path.join(repo, "dist"))
        with mock.patch.object(check, "REPO_ROOT", repo):
            code, out, _ = run_main(check, [])
        result = json.loads(out)
        self.assertEqual((code, result["ok"]), (0, True))
        self.assertEqual(result["source"], package_chatgpt.default_package_dir(
            os.path.join(repo, "dist"), STATE["config"]))

    def test_folder_and_zip_report_the_same_rule_and_path(self):
        root = self.copy_package()
        write_bytes(os.path.join(root, "hooks", "run.sh"), b"x")
        self.edit_interface(root, lambda i: i.update(category="Nope"))
        zip_path = package_chatgpt.make_zip(root, os.path.join(self.tmp, "bad.zip"))
        code, out, _ = run_main(check, ["--zip", zip_path])
        from_zip = json.loads(out)
        self.assertEqual(code, 1)
        from_folder = self.check_folder(root)
        pairs = [(item["rule"], item["path"]) for item in from_zip["errors"]]
        self.assertEqual(pairs, [(item["rule"], item["path"]) for item in from_folder["errors"]])
        self.assertEqual(pairs, [("excluded.hooks", PLUGIN_NAME + "/hooks"),
                                 ("interface.category", INTERFACE_AT + "category")])

    def test_input_errors_exit_2(self):
        not_zip = os.path.join(self.tmp, "not.zip")
        write_bytes(not_zip, b"plain text")
        corrupt = self.real_zip("corrupt.zip")
        data = bytearray(read_bytes(corrupt))
        with zipfile.ZipFile(corrupt) as archive:
            info = archive.getinfo(PLUGIN_NAME + "/plugin.json")
        start = info.header_offset + 30 + len(info.filename.encode()) + 5
        data[start] ^= 0xFF
        write_bytes(corrupt, bytes(data))
        cases = (["--zip", os.path.join(self.tmp, "missing.zip")], ["--zip", not_zip],
                 ["--zip", corrupt], ["--package", os.path.join(self.tmp, "missing")],
                 ["--zip", not_zip, "--package", STATE["package"]])
        for argv in cases:
            with self.subTest(argv=argv):
                code, out, err = run_main(check, argv)
                self.assertEqual((code, out), (2, ""))
                payload = json.loads(err)
                self.assertFalse(payload["ok"])
                self.assertTrue(payload["error"])
        with mock.patch.object(build, "load_config", side_effect=build.BuildError("bad yml")):
            code, _, err = run_main(check, [])
        self.assertEqual((code, json.loads(err)["error"]), (2, "bad yml"))

    def test_output_is_sorted_by_path_then_rule(self):
        root = self.copy_package()
        write_bytes(os.path.join(root, "bin", "x"), b"x")
        write_bytes(os.path.join(root, "agents", "x"), b"x")
        self.edit_interface(root, lambda i: i.update(category="Nope", screenshots=[]))
        errors = self.check_folder(root)["errors"]
        keys = [(item["path"], item["rule"]) for item in errors]
        self.assertEqual(keys, sorted(keys))
        self.assertEqual(len(keys), 4)

    def test_help_says_necessary_not_sufficient(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), self.assertRaises(SystemExit):
            check.main(["--help"])
        self.assertIn("Necessary, not sufficient", " ".join(out.getvalue().split()))
        self.assertIn("necessary, not sufficient", check.__doc__)


if __name__ == "__main__":
    unittest.main()
