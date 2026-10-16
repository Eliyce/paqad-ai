#!/usr/bin/env python3
"""Pre-submission check for the ChatGPT directory zip (CI-16).

Standard library only (Python 3.9+). No network. Checks a submission zip, a package folder, or by
default the built package at dist/hosts/chatgpt-directory/plugins/<name> against OpenAI's
documented plugin submission rules (developers.openai.com/plugins, the Agent Plugins schema,
fetched 2026-10-16): the zip shape, excluded content, the plugin.json manifest and its
extensions.com.openai.interface listing fields, the logo, and every skill's SKILL.md.

This check is necessary, not sufficient. It covers only the documented rules; the portal may
enforce rules it does not document. Every new portal error found on upload becomes a new rule here
plus a failing-fixture test.

Safety: a zip is read in memory with zipfile and is never extracted, written to disk or executed.
In folder mode a symlink is reported, never followed. Both modes load the entries into one neutral
list (archive path, bytes, kind, mode), so every rule runs the same way on both. In folder mode the
archive paths are the ones package_chatgpt.py would write (the folder name, then the relative path).

Every limit, the schema URL, the categories and the logo path come from build/build.py.

CLI:
  check_chatgpt_submission.py [--zip FILE | --package DIR]

stdout: {"ok", "source", "errors", "warnings"}. Exit 0 when there is no error (warnings allowed),
1 on any error, 2 on an input error with {"ok": false, "error"} on stderr.
"""

import argparse
import json
import os
import posixpath
import re
import stat
import struct
import sys
import zipfile
import zlib
from urllib.parse import urlsplit

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import build  # noqa: E402
import package_chatgpt  # noqa: E402

LIMITS = build.CHATGPT_LIMITS
BUILD_FIX = "fix build/build.py (build_chatgpt_directory_manifest) and rebuild"
SKILL_FIX = "fix the frontmatter of the source SKILL.md under skills/ and rebuild"

NAME_PATTERN = re.compile(r"[a-z0-9][a-z0-9_-]*")
SEMVER_PATTERN = re.compile(
    r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    r"(?:-(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)"
    r"(?:\.(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*))*)?"
    r"(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?"
)
COLOR_PATTERN = re.compile(r"#[0-9A-Fa-f]{6}")
MENTION_PATTERN = re.compile(r"@\w")
FRONTMATTER_KEY = re.compile(r"([A-Za-z0-9_][A-Za-z0-9_.-]*):(?:[ \t]+(.*))?")
# Plain values a YAML 1.1 parser reads as a number, boolean, null or date instead of a string.
NON_STRING_PLAIN = re.compile(
    r"[-+]?(?:[0-9][0-9_]*(?:\.[0-9_]*)?|\.[0-9_]+)(?:[eE][-+]?[0-9]+)?"
    r"|[-+]?0x[0-9a-f_]+|[-+]?0o?[0-7_]+|[-+]?[1-9][0-9_]*(?::[0-5]?[0-9])+"
    r"|[-+]?\.inf|\.nan|[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}(?:[Tt \t].*)?"
    r"|true|false|yes|no|on|off|null|~",
    re.IGNORECASE,
)
# A plain value may not start with a YAML indicator character.
PLAIN_INDICATOR_START = "&*!%@`#,]}"
DOUBLE_QUOTED_ESCAPES = {
    "0": "\0", "a": "\a", "b": "\b", "t": "\t", "\t": "\t", "n": "\n", "v": "\v", "f": "\f",
    "r": "\r", "e": "\x1b", " ": " ", '"': '"', "/": "/", "\\": "\\", "N": "\x85",
    "_": "\xa0", "L": "\u2028", "P": "\u2029",
}
DOUBLE_QUOTED_HEX = {"x": 2, "u": 4, "U": 8}
SVG_PATTERN = re.compile(r"<svg[\s>]")
VIEWBOX_PATTERN = re.compile(r"""viewBox\s*=\s*["']([^"']*)["']""")

# Where each manifest or interface field is filled from in build/skills.yml (PLG-11).
SKILLS_YML_SOURCES = {
    "name": "name",
    "version": "version",
    "description": "description",
    "homepage": "homepage",
    "repository": "repository",
    "keywords": "keywords",
    "author.name": "author",
    "author.email": "author_email",
    "displayName": "display_name",
    "shortDescription": "short_description",
    "longDescription": "long_description",
    "developerName": "author",
    "category": "category",
    "capabilities": "capabilities",
    "defaultPrompt": "default_prompts",
    "websiteURL": "homepage",
    "supportURL": "support_url",
    "privacyPolicyURL": "privacy_policy_url",
}
INTERFACE_REQUIRED = ("displayName", "shortDescription", "longDescription", "developerName", "logo")
INTERFACE_LENGTHS = (
    ("displayName", "display_name"),
    ("shortDescription", "short_description"),
    ("longDescription", "long_description"),
    ("developerName", "developer_name"),
)
INTERFACE_URLS = ("websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL")
BRAND_BACKGROUNDS = (("brandColor", "#FFFFFF"), ("brandColorDark", "#212121"))
ASSET_KEYS = ("logo", "composerIcon")
ASSET_EXTENSIONS = {".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".webp": "webp", ".svg": "svg"}
TOP_LEVEL_EXCLUDED = (
    ("apps", "excluded.app", "an apps/ folder"),
    ("hooks", "excluded.hooks", "a hooks/ folder"),
    ("commands", "excluded.commands", "a commands/ folder"),
    ("agents", "excluded.agents", "a plugin-level agents/ folder"),
    ("bin", "excluded.bin", "a bin/ folder"),
)
SECRET_SUFFIXES = (".pem", ".key", ".p12", ".pfx")
SECRET_PREFIXES = ("id_rsa", "id_ed25519")
REVIEWER_PREFIXES = ("test_credentials", "reviewer_instructions")


class InputError(Exception):
    """The input cannot be checked at all (exit 2)."""


class FrontmatterError(Exception):
    """A SKILL.md frontmatter form this reader does not accept."""


# --------------------------------------------------------------------------- loading


def _entry(path, data, kind, mode):
    return {"path": path, "data": data, "kind": kind, "mode": mode}


def zip_entry_kind(name, mode):
    """Classify a zip entry from its name and the Unix mode in external_attr."""
    file_type = stat.S_IFMT(mode)
    if file_type == stat.S_IFLNK:
        return "symlink"
    if name.endswith("/") or file_type == stat.S_IFDIR:
        return "dir" if file_type in (0, stat.S_IFDIR) else "other"
    return "file" if file_type in (0, stat.S_IFREG) else "other"


def load_zip(zip_path):
    """Read every zip entry in memory; return (entries, compressed size). Never extracts."""
    if not os.path.isfile(zip_path):
        raise InputError("zip not found: {0}".format(zip_path))
    if not zipfile.is_zipfile(zip_path):
        raise InputError("not a zip file: {0}".format(zip_path))
    entries = []
    try:
        with zipfile.ZipFile(zip_path) as archive:
            infos = archive.infolist()
            readable = sum(info.file_size for info in infos) <= LIMITS["zip_uncompressed_bytes"]
            for info in infos:
                mode = (info.external_attr >> 16) & 0xFFFF
                kind = zip_entry_kind(info.filename, mode)
                data = archive.read(info) if kind == "file" and readable else None
                entries.append(_entry(info.filename, data, kind, mode))
                if data is None and kind == "file":
                    entries[-1]["size"] = info.file_size
    except (zipfile.BadZipFile, zlib.error, NotImplementedError, RuntimeError,
            OSError) as exc:
        raise InputError("cannot read zip {0}: {1}".format(zip_path, exc))
    return entries, os.path.getsize(zip_path)


def load_package(package_dir):
    """Load a package folder as the entries package_chatgpt.py would pack. Never follows links."""
    if not os.path.isdir(package_dir):
        raise InputError("package folder not found: {0}".format(package_dir))
    top = os.path.basename(os.path.normpath(package_dir))
    entries = [_entry(top + "/", None, "dir", stat.S_IFDIR | 0o755)]
    for dirpath, dirnames, filenames in os.walk(package_dir):
        rel = os.path.relpath(dirpath, package_dir)
        prefix = top + "/" if rel == "." else "{0}/{1}/".format(top, rel.replace(os.sep, "/"))
        kept = []
        for name in sorted(dirnames):
            if package_chatgpt.is_skipped(name, True):
                continue
            mode = os.lstat(os.path.join(dirpath, name)).st_mode
            if stat.S_ISDIR(mode):
                kept.append(name)
                entries.append(_entry(prefix + name + "/", None, "dir", mode))
            else:
                entries.append(_entry(prefix + name, None, zip_entry_kind(name, mode), mode))
        dirnames[:] = kept
        for name in sorted(filenames):
            if package_chatgpt.is_skipped(name, False):
                continue
            full = os.path.join(dirpath, name)
            mode = os.lstat(full).st_mode
            kind = zip_entry_kind(name, mode)
            data = None
            if kind == "file":
                with open(full, "rb") as handle:
                    data = handle.read()
            entries.append(_entry(prefix + name, data, kind, mode))
    return entries


# --------------------------------------------------------------------------- reporting


class Report(object):
    def __init__(self):
        self.errors = []
        self.warnings = []

    def error(self, rule, path, message):
        self.errors.append({"rule": rule, "path": path, "message": message})

    def warning(self, rule, path, message):
        self.warnings.append({"rule": rule, "path": path, "message": message})

    def result(self, source):
        return {
            "ok": not self.errors,
            "source": source,
            "errors": sorted(self.errors, key=_item_order),
            "warnings": sorted(self.warnings, key=_item_order),
        }


def _item_order(item):
    return item["path"], item["rule"], item["message"]


def _fix(field):
    """How to fix a manifest or interface field: the skills.yml scalar it comes from, if any."""
    scalar = SKILLS_YML_SOURCES.get(field)
    if scalar:
        return "fix '{0}' in build/skills.yml and rebuild".format(scalar)
    return BUILD_FIX


# --------------------------------------------------------------------------- archive rules


def _path_problem(name):
    """Return why an archive path is unsafe, or None."""
    clean = name[:-1] if name.endswith("/") else name
    if name.startswith("/"):
        return "is absolute"
    if re.match(r"[A-Za-z]:", name):
        return "starts with a drive letter"
    if "\\" in name:
        return "contains a backslash"
    segments = clean.split("/")
    if any(segment in ("", ".", "..") for segment in segments):
        return "has an empty, '.' or '..' segment"
    if len(segments) > LIMITS["path_segments"]:
        return "has {0} segments; the limit is {1}".format(len(segments), LIMITS["path_segments"])
    return None


def check_archive(entries, compressed_size, report):
    """Archive-level rules. Returns the entries that are safe regular files or folders."""
    if compressed_size is not None and compressed_size > LIMITS["zip_compressed_bytes"]:
        report.error("archive.compressed_size", ".", "the zip is {0} bytes; the limit is {1}; "
                     "remove large files from the package".format(
                         compressed_size, LIMITS["zip_compressed_bytes"]))
    total = sum(len(e["data"]) if e["data"] is not None else e.get("size", 0) for e in entries)
    if total > LIMITS["zip_uncompressed_bytes"]:
        report.error("archive.uncompressed_size", ".", "the files total {0} bytes uncompressed; "
                     "the limit is {1}; remove large files from the package".format(
                         total, LIMITS["zip_uncompressed_bytes"]))
    if len(entries) > LIMITS["zip_entries"]:
        report.error("archive.entry_count", ".", "the archive has {0} entries; the limit is {1}; "
                     "remove files from the package".format(len(entries), LIMITS["zip_entries"]))
    safe = []
    seen = set()
    for entry in entries:
        problem = _path_problem(entry["path"])
        if problem:
            report.error("archive.path", entry["path"], "the archive path {0}; use a relative "
                         "path with '/' separators, no '.' or '..' and at most {1} segments".format(
                             problem, LIMITS["path_segments"]))
            continue
        clean = entry["path"].rstrip("/")
        if clean in seen:
            report.error("archive.duplicate_entry", entry["path"], "the archive holds more than "
                         "one entry named {0!r}; an unpacker keeps only one of them; repack with "
                         "build/package_chatgpt.py so every entry name is unique".format(clean))
            continue
        seen.add(clean)
        if entry["kind"] not in ("file", "dir"):
            report.error("archive.entry_type", entry["path"], "the entry is a {0} (mode {1}); "
                         "the zip allows regular files and folders only; replace it with a "
                         "regular file".format(entry["kind"], oct(entry["mode"])))
            continue
        safe.append(entry)
    return safe


def find_plugin_root(entries, report):
    """Return (root prefix, files, dirs) or None when no single plugin root exists."""
    files = {}
    dirs = set()
    for entry in entries:
        clean = entry["path"].rstrip("/")
        if entry["kind"] == "file":
            files[clean] = entry["data"]
        else:
            dirs.add(clean)
        parts = clean.split("/")
        for index in range(1, len(parts)):
            dirs.add("/".join(parts[:index]))
    if "plugin.json" in files:
        return "", files, dirs
    top = sorted({path.split("/")[0] for path in list(files) + list(dirs)})
    top_files = sorted(path for path in files if "/" not in path)
    if len(top) == 1 and not top_files:
        root = top[0] + "/"
        if root + "plugin.json" not in files:
            report.error("plugin_root_ambiguous", top[0], "the single top-level folder has no "
                         "plugin.json; put plugin.json at the plugin root and repack with "
                         "build/package_chatgpt.py")
            report.error("manifest.missing", root + "plugin.json", "no plugin.json at the plugin "
                         "root; rebuild with build/build.py and repack")
        return root, files, dirs
    report.error("plugin_root_ambiguous", ".", "the archive must hold plugin.json at its root or "
                 "exactly one top-level folder with no sibling file; found top-level entries {0}; "
                 "pack only the plugin root with build/package_chatgpt.py".format(top))
    return None


# --------------------------------------------------------------------------- excluded content


def check_excluded(root, files, dirs, report):
    rel_dirs = {path[len(root):] for path in dirs if path.startswith(root) and path != root[:-1]}
    for folder, rule, label in TOP_LEVEL_EXCLUDED:
        if folder in rel_dirs:
            report.error(rule, root + folder, "the package carries {0}, which the directory "
                         "rejects; remove it, the package is skills-only".format(label))
    for path in sorted(files):
        if not path.startswith(root):
            continue
        parts = path[len(root):].split("/")
        name = parts[-1]
        found = []
        if name == ".app.json":
            found.append(("excluded.app", "an app manifest"))
        if name in ("mcp.json", ".mcp.json"):
            found.append(("excluded.mcp", "an MCP server configuration"))
        if name == "hooks.json":
            found.append(("excluded.hooks", "a lifecycle hooks file"))
        if name == "CLAUDE.md" or any(
            parts[i] == ".claude" and parts[i + 1].startswith("settings")
            for i in range(len(parts) - 1)
        ):
            found.append(("excluded.claude_files", "a host-specific agent settings file"))
        if name.startswith(REVIEWER_PREFIXES):
            found.append(("excluded.reviewer_files", "reviewer or test credential material"))
        if (name == ".env" or name.startswith(".env.") or name.endswith(SECRET_SUFFIXES)
                or name.startswith(SECRET_PREFIXES)):
            found.append(("excluded.secret", "a secret or key file"))
        for rule, label in found:
            report.error(rule, path, "the package carries {0} ({1}), which the directory "
                         "rejects; remove it from the source and rebuild".format(label, name))


# --------------------------------------------------------------------------- manifest rules


def _url_problem(value, limit):
    if not isinstance(value, str):
        return "is not a string"
    if not value.startswith("https://") or not urlsplit(value).netloc:
        return "is not an https:// URL ({0!r})".format(value)
    if "@" in urlsplit(value).netloc:
        return "carries user info (credentials) ({0!r})".format(value)
    if len(value) > limit:
        return "is {0} characters; the limit is {1}".format(len(value), limit)
    return None


def _text_problem(value, limit):
    if not isinstance(value, str) or not value.strip():
        return "is missing or empty"
    if len(value) > limit:
        return "is {0} characters; the limit is {1}".format(len(value), limit)
    return None


def check_manifest(manifest, at, report):
    """Root plugin.json rules. Returns the interface object, or None when it is unusable."""
    for key in manifest:
        if key not in build.AGENT_PLUGINS_MANIFEST_KEYS:
            report.error("manifest.unknown_key", at + key, "top-level key {0!r} is not allowed; "
                         "the allowed keys are {1}; {2}".format(
                             key, ", ".join(build.AGENT_PLUGINS_MANIFEST_KEYS), BUILD_FIX))
    if manifest.get("$schema") != build.AGENT_PLUGINS_SCHEMA_URL:
        report.error("manifest.schema", at + "$schema", "$schema is {0!r}; it must be exactly "
                     "{1}; {2}".format(manifest.get("$schema"), build.AGENT_PLUGINS_SCHEMA_URL,
                                       BUILD_FIX))
    name = manifest.get("name")
    problem = _text_problem(name, LIMITS["manifest_name"])
    if not problem and (not NAME_PATTERN.fullmatch(name) or "--" in name):
        problem = ("is {0!r}; use lowercase letters, digits, '_' and '-', start with a letter or "
                   "digit and never '--'".format(name))
    if problem:
        report.error("manifest.name", at + "name", "name {0}; {1}".format(problem, _fix("name")))
    version = manifest.get("version")
    problem = _text_problem(version, LIMITS["manifest_version"])
    if not problem and not SEMVER_PATTERN.fullmatch(version):
        problem = "is {0!r}, not SemVer 2.0 (MAJOR.MINOR.PATCH)".format(version)
    if problem:
        report.error("manifest.version", at + "version", "version {0}; {1}".format(
            problem, _fix("version")))
    problem = _text_problem(manifest.get("description"), LIMITS["manifest_description"])
    if problem:
        report.error("manifest.description", at + "description", "description {0}; {1}".format(
            problem, _fix("description")))
    check_author(manifest.get("author"), at, report)
    for field in ("homepage", "repository"):
        value = manifest.get(field)
        if value is None or (field == "repository" and not isinstance(value, str)):
            continue
        problem = _url_problem(value, LIMITS["manifest_url"])
        if problem:
            report.error("manifest.url", at + field, "{0} {1}; {2}".format(
                field, problem, _fix(field)))
    keywords = manifest.get("keywords")
    if keywords is not None and (not isinstance(keywords, list) or not all(
            isinstance(word, str) and word.strip() for word in keywords)):
        report.error("manifest.keywords", at + "keywords", "keywords must be a list of non-empty "
                     "strings; {0}".format(_fix("keywords")))
    interface = (manifest.get("extensions") or {})
    interface = interface.get(build.OPENAI_EXTENSION_KEY) if isinstance(interface, dict) else None
    interface = interface.get("interface") if isinstance(interface, dict) else None
    if not isinstance(interface, dict):
        report.error("manifest.extensions", at + "extensions", "extensions.{0}.interface is "
                     "missing or not an object; {1}".format(build.OPENAI_EXTENSION_KEY, BUILD_FIX))
        return None
    return interface


def check_author(author, at, report):
    path = at + "author"
    if not isinstance(author, dict):
        report.error("manifest.author", path, "author must be an object with name and email; "
                     "{0}".format(_fix("author.name")))
        return
    for key in author:
        if key not in ("name", "email", "url"):
            report.error("manifest.author", path, "author key {0!r} is not allowed; use only "
                         "name, email and url; {1}".format(key, BUILD_FIX))
    problem = _text_problem(author.get("name"), LIMITS["author_name"])
    if problem:
        report.error("manifest.author", path, "author.name {0}; {1}".format(
            problem, _fix("author.name")))
    email = author.get("email")
    if email is not None and (not isinstance(email, str) or len(email) > LIMITS["author_email"]
                              or email.count("@") != 1):
        report.error("manifest.author", path, "author.email {0!r} must hold exactly one '@' and "
                     "at most {1} characters; {2}".format(email, LIMITS["author_email"],
                                                          _fix("author.email")))
    if "url" in author:
        problem = _url_problem(author["url"], LIMITS["manifest_url"])
        if problem:
            report.error("manifest.url", path + ".url", "author.url {0}; {1}".format(
                problem, BUILD_FIX))


# --------------------------------------------------------------------------- interface rules


def _luminance(color):
    channels = []
    for index in (1, 3, 5):
        value = int(color[index:index + 2], 16) / 255.0
        channels.append(value / 12.92 if value <= 0.03928 else ((value + 0.055) / 1.055) ** 2.4)
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]


def contrast_ratio(first, second):
    """WCAG contrast ratio between two #RRGGBB colours."""
    high, low = sorted((_luminance(first), _luminance(second)), reverse=True)
    return (high + 0.05) / (low + 0.05)


def _check_list(interface, key, rule, count_limit, item_limit, at, report):
    """Shared list checks for capabilities and defaultPrompt; returns the list or None."""
    if key not in interface:
        return None
    items = interface[key]
    path = at + key
    if not isinstance(items, list):
        report.error(rule, path, "{0} must be a list; {1}".format(key, _fix(key)))
        return None
    if len(items) > count_limit:
        report.error(rule, path, "{0} has {1} items; the limit is {2}; {3}".format(
            key, len(items), count_limit, _fix(key)))
    for item in items:
        problem = _text_problem(item, item_limit)
        if problem:
            report.error(rule, path, "a {0} item {1}; {2}".format(key, problem, _fix(key)))
    return [item for item in items if isinstance(item, str)]


def check_interface(interface, at, report):
    for key in INTERFACE_REQUIRED:
        value = interface.get(key)
        if not isinstance(value, str) or not value.strip():
            report.error("interface.required", at + key, "{0} is required and must be a "
                         "non-empty string; {1}".format(key, _fix(key)))
    for key, limit_name in INTERFACE_LENGTHS:
        value = interface.get(key)
        if isinstance(value, str) and len(value) > LIMITS[limit_name]:
            report.error("interface.length", at + key, "{0} is {1} characters; the limit is {2}; "
                         "{3}".format(key, len(value), LIMITS[limit_name], _fix(key)))
    category = interface.get("category")
    if category not in build.CHATGPT_CATEGORIES:
        report.error("interface.category", at + "category", "category {0!r} is not one of {1}; "
                     "{2}".format(category, ", ".join(build.CHATGPT_CATEGORIES), _fix("category")))
    capabilities = _check_list(interface, "capabilities", "interface.capabilities",
                               LIMITS["capabilities_count"], LIMITS["capability_length"], at,
                               report) or []
    prompts = _check_list(interface, "defaultPrompt", "interface.default_prompt",
                          LIMITS["default_prompts_count"], LIMITS["default_prompt_length"], at,
                          report) or []
    if len(set(prompts)) != len(prompts):
        report.error("interface.default_prompt", at + "defaultPrompt", "defaultPrompt has a "
                     "duplicate prompt; every prompt must be unique; {0}".format(
                         _fix("defaultPrompt")))
    for prompt in prompts:
        if MENTION_PATTERN.search(prompt):
            report.error("interface.default_prompt", at + "defaultPrompt", "prompt {0!r} holds "
                         "an @mention, which is not allowed; {1}".format(
                             prompt, _fix("defaultPrompt")))
    single = [(key, interface.get(key)) for key in ("displayName", "shortDescription")]
    single += [("capabilities", item) for item in capabilities]
    single += [("defaultPrompt", item) for item in prompts]
    for key, value in single:
        if isinstance(value, str) and ("\n" in value or "\r" in value):
            report.error("interface.single_line", at + key, "{0} holds a line break; it must be "
                         "one line; {1}".format(key, _fix(key)))
    for key, background in BRAND_BACKGROUNDS:
        if key not in interface:
            continue
        value = interface[key]
        if not isinstance(value, str) or not COLOR_PATTERN.fullmatch(value):
            report.error("interface.brand_color", at + key, "{0} {1!r} is not #RRGGBB; "
                         "{2}".format(key, value, BUILD_FIX))
            continue
        ratio = contrast_ratio(value, background)
        if ratio < LIMITS["brand_contrast"]:
            report.error("interface.brand_color", at + key, "{0} {1} has a contrast ratio of "
                         "{2:.2f}:1 against {3}; the minimum is {4}:1; pick a stronger "
                         "colour".format(key, value, ratio, background, LIMITS["brand_contrast"]))
    for key in INTERFACE_URLS:
        if key in interface:
            problem = _url_problem(interface[key], LIMITS["interface_url"])
            if problem:
                report.error("interface.url", at + key, "{0} {1}; {2}".format(
                    key, problem, _fix(key)))
    if "screenshots" in interface:
        report.error("screenshot_configuration_excluded", at + "screenshots", "a skills-only "
                     "package must not configure screenshots; remove the screenshots key; "
                     "{0}".format(BUILD_FIX))


# --------------------------------------------------------------------------- asset rules


def image_format(data):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if SVG_PATTERN.search(data[:4096].decode("utf-8", "replace")):
        return "svg"
    return None


def _jpeg_size(data):
    index = 2
    while index + 9 <= len(data):
        if data[index] != 0xFF:
            return None
        marker = data[index + 1]
        length = struct.unpack(">H", data[index + 2:index + 4])[0]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            height, width = struct.unpack(">HH", data[index + 5:index + 9])
            return width, height
        index += 2 + length
    return None


def _webp_size(data):
    chunk = data[12:16]
    if chunk == b"VP8 " and len(data) >= 30:
        width, height = struct.unpack("<HH", data[26:30])
        return width & 0x3FFF, height & 0x3FFF
    if chunk == b"VP8L" and len(data) >= 25:
        b0, b1, b2, b3 = data[21:25]
        return 1 + (b0 | (b1 & 0x3F) << 8), 1 + (b1 >> 6 | b2 << 2 | (b3 & 0x0F) << 10)
    if chunk == b"VP8X" and len(data) >= 30:
        width = int.from_bytes(data[24:27], "little") + 1
        height = int.from_bytes(data[27:30], "little") + 1
        return width, height
    return None


def raster_size(kind, data):
    """(width, height) of a PNG, JPEG or WebP, or None when the header cannot be read."""
    if kind == "png":
        if data[12:16] != b"IHDR" or len(data) < 24:
            return None
        return struct.unpack(">II", data[16:24])
    if kind == "jpeg":
        return _jpeg_size(data)
    return _webp_size(data)


def _svg_problem(data):
    match = VIEWBOX_PATTERN.search(data.decode("utf-8", "replace"))
    numbers = match.group(1).replace(",", " ").split() if match else []
    try:
        width, height = float(numbers[2]), float(numbers[3])
    except (IndexError, ValueError):
        return "the SVG has no readable viewBox"
    if len(numbers) != 4 or width <= 0 or width != height:
        return "the SVG viewBox {0!r} is not square".format(match.group(1))
    return None


def check_asset(key, value, root, files, at, report):
    path = at + key
    if not isinstance(value, str) or not value.startswith("./"):
        report.error("asset.path", path, "{0} {1!r} must be a './' path inside the plugin root; "
                     "{2}".format(key, value, BUILD_FIX))
        return
    rel = posixpath.normpath(value[2:])
    if rel == ".." or rel.startswith("../") or rel.startswith("/"):
        report.error("asset.path", path, "{0} {1!r} resolves outside the plugin root; "
                     "{2}".format(key, value, BUILD_FIX))
        return
    data = files.get(root + rel)
    if data is None:
        report.error("asset.path", path, "{0} {1!r} names no file in the package; add the file "
                     "(publish/claude/icon.png fills the logo) and rebuild".format(key, value))
        return
    entry_path = root + rel
    if len(data) > LIMITS["asset_bytes"]:
        report.error("asset.size", entry_path, "{0} is {1} bytes; the limit is {2}; use a "
                     "smaller image".format(key, len(data), LIMITS["asset_bytes"]))
    kind = image_format(data)
    extension = ASSET_EXTENSIONS.get(posixpath.splitext(rel)[1].lower())
    if kind is None or extension != kind:
        report.error("asset.format", entry_path, "{0} content is {1} and its extension says {2}; "
                     "use a PNG, JPEG, WebP or SVG whose extension matches its content".format(
                         key, kind or "not an image", extension or "an unsupported type"))
        return
    if kind == "svg":
        problem = _svg_problem(data)
    else:
        size = raster_size(kind, data)
        problem = None
        if size is None:
            problem = "the image size cannot be read"
        elif size[0] != size[1] or not (
                LIMITS["asset_min_px"] <= size[0] <= LIMITS["asset_max_px"]):
            problem = "the image is {0}x{1} px; it must be square and {2} to {3} px".format(
                size[0], size[1], LIMITS["asset_min_px"], LIMITS["asset_max_px"])
    if problem:
        report.error("asset.dimensions", entry_path, "{0}: {1}; use a square image of {2} to {3} "
                     "px".format(key, problem, LIMITS["asset_min_px"], LIMITS["asset_max_px"]))


# --------------------------------------------------------------------------- skill rules


def _double_quoted(value, number):
    """Return (text, rest) for a double-quoted value, applying YAML escapes."""
    out = []
    index = 1
    while index < len(value):
        char = value[index]
        if char == '"':
            return "".join(out), value[index + 1:]
        if char != "\\":
            out.append(char)
            index += 1
            continue
        escape = value[index + 1:index + 2]
        if escape in DOUBLE_QUOTED_ESCAPES:
            out.append(DOUBLE_QUOTED_ESCAPES[escape])
            index += 2
            continue
        width = DOUBLE_QUOTED_HEX.get(escape)
        digits = value[index + 2:index + 2 + width] if width else ""
        if not width or len(digits) != width or not re.fullmatch(r"[0-9A-Fa-f]+", digits) \
                or int(digits, 16) > 0x10FFFF:
            raise FrontmatterError("line {0} has an invalid escape '\\{1}' in a double-quoted "
                                   "value; write a literal backslash as '\\\\'".format(
                                       number, escape))
        out.append(chr(int(digits, 16)))
        index += 2 + width
    raise FrontmatterError("line {0} has an unterminated double-quoted value".format(number))


def _single_quoted(value, number):
    """Return (text, rest) for a single-quoted value, where '' stands for one quote."""
    out = []
    index = 1
    while index < len(value):
        char = value[index]
        if char == "'":
            if value[index + 1:index + 2] == "'":
                out.append("'")
                index += 2
                continue
            return "".join(out), value[index + 1:]
        out.append(char)
        index += 1
    raise FrontmatterError("line {0} has an unterminated single-quoted value".format(number))


def _plain_problem(value):
    """Return why a strict YAML parser would reject or misread a plain value, or None."""
    if value[0] in PLAIN_INDICATOR_START:
        return "starts with the YAML indicator {0!r}".format(value[0])
    if value[:2] in ("- ", "? ", ": ") or value in ("-", "?", ":"):
        return "starts with the YAML indicator {0!r}".format(value[0])
    if ": " in value or ":\t" in value:
        return "contains ': ', which YAML reads as a nested mapping"
    if value.endswith(":"):
        return "ends with ':', which YAML reads as a nested mapping"
    if " #" in value or "\t#" in value:
        return "contains ' #', which YAML reads as the start of a comment"
    return None


def _scalar(value, number):
    """Parse a one-line frontmatter value: a quoted or plain string, or a non-string marker.

    Quoted values are decoded as YAML does (double quotes with backslash escapes, single quotes
    with '' for a quote). A plain value that a strict YAML parser would reject or read
    differently fails loudly with its line number.
    """
    if value[0] in "|>":
        raise FrontmatterError("line {0} uses a block scalar ({1}), which this check cannot "
                               "read; write the value on one line".format(number, value[0]))
    if value[0] in "\"'":
        text, rest = (_double_quoted if value[0] == '"' else _single_quoted)(value, number)
        if rest.strip() and not re.match(r"[ \t]+#", rest):
            raise FrontmatterError("line {0} has text after the closing quote; quote the whole "
                                   "value".format(number))
        return text
    if value[0] in "[{" or NON_STRING_PLAIN.fullmatch(value):
        return None
    problem = _plain_problem(value)
    if problem:
        raise FrontmatterError("line {0} has an unquoted value that {1}; double-quote the value "
                               "and escape any '\"' or '\\' inside it".format(number, problem))
    return value


def parse_frontmatter(text):
    """Return (mapping, body) for a SKILL.md; raise FrontmatterError on an unsupported form.

    A minimal mapping reader: top-level 'key: value' lines between '---' lines. A key with no
    value may carry an indented block below it (read as a non-string). Anything else fails.
    """
    lines = [line.rstrip("\r") for line in text.split("\n")]
    if lines[0] != "---":
        raise FrontmatterError("the first line is not '---'")
    try:
        close = lines.index("---", 1)
    except ValueError:
        raise FrontmatterError("no closing '---' line")
    mapping = {}
    in_block = False
    for number, line in enumerate(lines[1:close], 2):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line[0] in " \t":
            if in_block:
                continue
            raise FrontmatterError("line {0} is indented outside a nested block".format(number))
        match = FRONTMATTER_KEY.fullmatch(line)
        if not match:
            raise FrontmatterError("line {0} is not 'key: value'".format(number))
        key, value = match.group(1), (match.group(2) or "").strip()
        if key in mapping:
            raise FrontmatterError("line {0} repeats the key {1!r}".format(number, key))
        in_block = not value
        mapping[key] = _scalar(value, number) if value else None
    return mapping, "\n".join(lines[close + 1:])


def check_skills(root, files, dirs, plugin_name, report):
    skills_dir = root + "skills"
    if skills_dir not in dirs:
        report.error("skills.missing", skills_dir, "the package has no skills/ folder; rebuild "
                     "with build/build.py")
        return
    prefix = skills_dir + "/"
    for path in sorted(files):
        if path.startswith(prefix) and "/" not in path[len(prefix):]:
            report.error("skills.stray_file", path, "a file sits directly under skills/; every "
                         "skill must be a folder; remove the file")
    skill_dirs = sorted(path for path in dirs
                        if path.startswith(prefix) and "/" not in path[len(prefix):])
    if not skill_dirs:
        report.error("skills.missing", skills_dir, "skills/ holds no skill folder; rebuild with "
                     "build/build.py")
    seen = {}
    for skill_dir in skill_dirs:
        folder = skill_dir[len(prefix):]
        if folder.startswith("."):
            report.error("skills.hidden_dir", skill_dir, "skill folder {0!r} is hidden; remove "
                         "it or rename it without the leading '.'".format(folder))
            continue
        check_skill(skill_dir + "/SKILL.md", files, plugin_name, seen, report)


def check_skill(path, files, plugin_name, seen, report):
    data = files.get(path)
    if data is None:
        report.error("skill.missing_skill_md", path, "the skill folder has no SKILL.md; add one "
                     "or remove the folder")
        return
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        report.error("skill.utf8", path, "SKILL.md is not valid UTF-8 ({0}); save it as "
                     "UTF-8".format(exc))
        return
    try:
        mapping, body = parse_frontmatter(text)
    except FrontmatterError as exc:
        report.error("skill.frontmatter", path, "the frontmatter is not a supported mapping: "
                     "{0}; {1}".format(exc, SKILL_FIX))
        return
    name = mapping.get("name")
    if not isinstance(name, str) or not name.strip():
        report.error("skill.name", path, "name is missing, empty or not a string; "
                     "{0}".format(SKILL_FIX))
    else:
        if name in seen:
            report.error("skill.name", path, "name {0!r} is also used by {1}; every skill name "
                         "must be unique; {2}".format(name, seen[name], SKILL_FIX))
        seen.setdefault(name, path)
        qualified = "{0}:{1}".format(plugin_name, name)
        if plugin_name and len(qualified) > LIMITS["qualified_skill_name"]:
            report.error("skill.name", path, "the qualified name {0!r} is {1} characters; the "
                         "limit is {2}; shorten the publish name in build/skills.yml".format(
                             qualified, len(qualified), LIMITS["qualified_skill_name"]))
    problem = _text_problem(mapping.get("description"), LIMITS["skill_description"])
    if problem:
        report.error("skill.description", path, "description {0}; {1}".format(problem, SKILL_FIX))
    if not body.strip():
        report.error("skill.body", path, "SKILL.md has nothing after the frontmatter; add the "
                     "skill instructions")
    if "metadata" in mapping:
        report.warning("skill.metadata", path, "the frontmatter carries metadata, which the "
                       "directory ignores; remove it to keep the listing honest")


# --------------------------------------------------------------------------- driver


def check_entries(entries, source, compressed_size=None):
    """Run every rule over the neutral entry list and return the result object."""
    report = Report()
    safe = check_archive(entries, compressed_size, report)
    if any(entry["kind"] == "file" and entry["data"] is None for entry in safe):
        # Over the uncompressed limit the contents are never read, so content rules cannot run.
        return report.result(source)
    found = find_plugin_root(safe, report)
    if found is None:
        return report.result(source)
    root, files, dirs = found
    check_excluded(root, files, dirs, report)
    manifest_path = root + "plugin.json"
    plugin_name = None
    raw = files.get(manifest_path)
    manifest = None
    if raw is not None:
        try:
            manifest = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as exc:
            report.error("manifest.json", manifest_path, "plugin.json is not UTF-8 JSON ({0}); "
                         "rebuild with build/build.py".format(exc))
        if manifest is not None and not isinstance(manifest, dict):
            report.error("manifest.json", manifest_path, "plugin.json must hold a JSON object; "
                         "rebuild with build/build.py")
            manifest = None
    if manifest is not None:
        at = manifest_path + ":"
        interface = check_manifest(manifest, at, report)
        if isinstance(manifest.get("name"), str):
            plugin_name = manifest["name"]
        if interface is not None:
            iat = "{0}extensions.{1}.interface.".format(at, build.OPENAI_EXTENSION_KEY)
            check_interface(interface, iat, report)
            for key in ASSET_KEYS:
                if key in interface and (key != "logo" or interface[key]):
                    check_asset(key, interface[key], root, files, iat, report)
    check_skills(root, files, dirs, plugin_name, report)
    return report.result(source)


def _input_error(message):
    sys.stderr.write(json.dumps({"ok": False, "error": message}) + "\n")
    return 2


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Check the ChatGPT directory submission zip or package folder against "
        "OpenAI's documented submission rules. Necessary, not sufficient: the portal may enforce "
        "rules this check does not know; each new portal error becomes a new rule and a test.",
    )
    parser.add_argument("--zip", default=None, help="submission zip to check")
    parser.add_argument("--package", default=None,
                        help="package folder to check (default: the built "
                        "dist/hosts/chatgpt-directory plugin)")
    args = parser.parse_args(argv)
    if args.zip and args.package:
        return _input_error("give --zip or --package, not both")
    try:
        if args.zip:
            entries, compressed = load_zip(args.zip)
            result = check_entries(entries, args.zip, compressed)
        else:
            package = args.package
            if package is None:
                config = build.load_config(os.path.join(REPO_ROOT, "build", "skills.yml"))
                package = package_chatgpt.default_package_dir(
                    os.path.join(REPO_ROOT, "dist"), config)
            result = check_entries(load_package(package), package)
    except (InputError, build.BuildError) as exc:
        return _input_error(str(exc))
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
