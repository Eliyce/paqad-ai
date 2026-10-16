#!/usr/bin/env python3
"""Assemble dist/ for the paqad-product-discovery plugin from a single source of truth.

Standard library only (Python 3.9+). No network. Reads name, version, description, license and
display text, plus the directory listing scalars, from build/skills.yml and from nowhere else,
copies each skill plus its declared shared imports into dist/, and generates all four manifests
from those values so no two manifests can disagree (PLG-11). The Claude branch alone also gets
listing manifests (author, homepage, repository, keywords, display name and the documentation,
support and privacy links) plus the publish files README.md, LICENSE and PRIVACY.md (PLG-12).
The ChatGPT directory branch (dist/hosts/chatgpt-directory) is a native Agent Plugins package: a
root plugin.json with $schema and extensions.com.openai.interface, the same skills tree, a README,
the LICENSE, the privacy policy and assets/logo.png. The directory limits that package must meet
are defined once here; build/check_chatgpt_submission.py imports them.

Guarantees:
  - Fails with a clear error naming the offending import when a SKILL.md references a shared
    file the skill did not declare in skills.yml (PLG-10).
  - Deterministic: two consecutive runs on a clean tree produce byte-identical dist/ output
    (sorted JSON keys, fixed separators, no timestamps).
  - Cleans the dist plugin output at the start of a run so removed inputs do not linger.

The dist/ tree is skills-only. This build never emits agents/, hooks/, commands/, bin/,
.mcp.json, mcp.json or .app.json.
"""

import argparse
import json
import os
import re
import shutil
import sys

# The OpenAI primary manifest carries its host-specific keys under this extension namespace.
# The literal lives here in the build generator, never in shipped skill or shared text.
OPENAI_EXTENSION_KEY = "com.openai"

REQUIRED_SCALARS = ("name", "version", "description", "license", "display_name")

# The ChatGPT directory branch key under dist/hosts/ (PLG-12), named once so the build, the zip
# packer and the pre-submission check all point at the same folder.
CHATGPT_DIRECTORY_HOST = "chatgpt-directory"

# The Agent Plugins manifest schema the ChatGPT directory package declares in "$schema" (O11).
AGENT_PLUGINS_SCHEMA_URL = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"

# The only top-level keys the Agent Plugins schema allows, in the order the package writes them.
AGENT_PLUGINS_MANIFEST_KEYS = (
    "$schema",
    "name",
    "version",
    "description",
    "author",
    "homepage",
    "repository",
    "license",
    "keywords",
    "extensions",
)

# The interface keys the package writes, in order. screenshots, brandColor, brandColorDark,
# composerIcon and termsOfServiceURL are deliberately absent (screenshots are rejected for a
# skills-only package; the others have no owner value).
CHATGPT_INTERFACE_KEYS = (
    "displayName",
    "shortDescription",
    "longDescription",
    "developerName",
    "category",
    "capabilities",
    "defaultPrompt",
    "websiteURL",
    "supportURL",
    "privacyPolicyURL",
    "logo",
)

# The listing logo inside the package, relative to the plugin root. publish/claude/icon.png fills it.
CHATGPT_LOGO_PATH = "./assets/logo.png"

# The ChatGPT directory categories (exact case).
CHATGPT_CATEGORIES = (
    "Productivity",
    "Creativity",
    "Developer Tools",
    "Business & Operations",
    "Data & Analytics",
    "Communication",
    "Education & Research",
    "Security",
    "Finance",
    "Healthcare",
    "Travel",
    "Entertainment",
    "Other",
)

# Every documented ChatGPT directory limit (OpenAI plugin submission docs and the Agent Plugins
# schema, fetched 2026-10-16), defined once. Lengths are characters, sizes are bytes.
CHATGPT_LIMITS = {
    "display_name": 30,
    "short_description": 30,
    "long_description": 4000,
    "developer_name": 80,
    "capabilities_count": 20,
    "capability_length": 120,
    "default_prompts_count": 3,
    "default_prompt_length": 128,
    "manifest_name": 64,
    "manifest_version": 64,
    "manifest_description": 1024,
    "author_name": 120,
    "author_email": 320,
    "manifest_url": 2048,
    "interface_url": 1024,
    "zip_compressed_bytes": 100000000,
    "zip_uncompressed_bytes": 536870912,
    "zip_entries": 5000,
    "path_segments": 20,
    "asset_bytes": 5242880,
    "asset_min_px": 48,
    "asset_max_px": 4096,
    "brand_contrast": 2.0,
    "qualified_skill_name": 64,
    "skill_description": 1024,
}

# The ChatGPT directory listing scalars (PLG-11). Each must be non-empty; there is no silent
# default. default_prompts and capabilities are pipe-separated lists.
CHATGPT_DIRECTORY_SCALARS = (
    "short_description",
    "long_description",
    "category",
    "default_prompts",
    "capabilities",
)

# The directory listing scalars (PLG-11). Each must be non-empty; there is no silent default.
LISTING_SCALARS = (
    "author",
    "author_email",
    "repository",
    "homepage",
    "documentation_url",
    "support_url",
    "privacy_policy_url",
    "keywords",
)

# Listing scalars that are links and must use https.
LISTING_URL_SCALARS = (
    "repository",
    "homepage",
    "documentation_url",
    "support_url",
    "privacy_policy_url",
)

# The plugins-directory convention, defined once (a plugin lives at plugins/<name>) so the two
# places that need it (the marketplace "source" string and the on-disk plugin directory) can
# never drift apart.
PLUGINS_DIR = "plugins"

# Where the combined dist adds per-host branches (PLG-12). The combined dist/ root stays
# byte-identical; the branches live only under dist/hosts/<host>/ (CI-8).
HOSTS_DIR = "hosts"

# Per-host distribution branches (PLG-12). Each branch is emitted from the one source (skills.yml)
# and carries only the marketplace/manifest files that host actually reads, plus the identical
# skills tree. The host names live here in the build generator only; the CI-4 neutral-wording scan
# walks skills/ and shared/, not build/, so naming the hosts here is allowed.
#
# Each entry maps a relative manifest path (with {name} filled from skills.yml) to which generated
# manifest fills it: "marketplace" and "plugin" are the .claude-plugin layout the ChatGPT branch
# reads; "claude_marketplace" and "claude_plugin" are the same manifests plus the documented
# directory listing fields, for the Claude branch only; "openai" is the OpenAI primary manifest
# (extensions.com.openai) the Codex branch reads; "chatgpt_directory" is the native Agent Plugins
# manifest of the ChatGPT directory package. No branch emits agents/, hooks/, commands/, bin/,
# .mcp.json, mcp.json or .app.json.
HOST_BRANCHES = {
    "claude": [
        (".claude-plugin/marketplace.json", "claude_marketplace"),
        ("{plugins}/{name}/.claude-plugin/plugin.json", "claude_plugin"),
    ],
    "chatgpt": [
        (".claude-plugin/marketplace.json", "marketplace"),
        ("{plugins}/{name}/.claude-plugin/plugin.json", "plugin"),
    ],
    "codex": [
        (".agents/plugins/marketplace.json", "marketplace"),
        ("{plugins}/{name}/plugin.json", "openai"),
    ],
    CHATGPT_DIRECTORY_HOST: [
        ("{plugins}/{name}/plugin.json", "chatgpt_directory"),
    ],
}

# Manifest kinds written in their documented key order instead of sorted keys. Insertion order is
# fixed by the generator, so the output stays deterministic.
ORDERED_MANIFEST_KINDS = ("chatgpt_directory",)

# Per-host publish files (PLG-12): each source file, relative to the source root, is copied to
# every listed target inside dist/hosts/<host>/. The Claude branch is the root of the public
# directory repo, so it needs a README, a LICENSE and the privacy policy. The ChatGPT directory
# branch carries the same files inside its plugin root, which is what the submission zip packs.
HOST_PUBLISH_FILES = {
    "claude": [
        ("publish/claude/README.md", ("README.md", "{plugins}/{name}/README.md")),
        ("publish/claude/LICENSE", ("LICENSE", "{plugins}/{name}/LICENSE")),
        ("docs/privacy-policy.md", ("PRIVACY.md",)),
        ("publish/claude/icon.png", ("{plugins}/{name}/.claude-plugin/icon.png",)),
    ],
    CHATGPT_DIRECTORY_HOST: [
        ("publish/chatgpt/README.md", ("{plugins}/{name}/README.md",)),
        ("publish/claude/LICENSE", ("{plugins}/{name}/LICENSE",)),
        ("docs/privacy-policy.md", ("{plugins}/{name}/PRIVACY.md",)),
        ("publish/claude/icon.png", ("{plugins}/{name}/" + CHATGPT_LOGO_PATH[2:],)),
    ],
}

# File names copy_tree never copies, so OS cruft never reaches dist/.
SKIPPED_FILE_NAMES = (".DS_Store",)


def plugin_rel_path(name):
    """Return the plugin path relative to the dist root, forward-slashed for manifests."""
    return "{0}/{1}".format(PLUGINS_DIR, name)


def plugin_dir_path(dist_root, name):
    """Return the absolute plugin directory inside dist_root."""
    return os.path.join(dist_root, PLUGINS_DIR, name)


class BuildError(Exception):
    """Raised when the build cannot proceed; carries a human-readable message."""


# --------------------------------------------------------------------------- config parsing


def _unquote(value):
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        return value[1:-1]
    return value


def _parse_skills_list(lines, i, n):
    skills = []
    current = None
    while i < n:
        raw = lines[i]
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            i += 1
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        if indent == 0:
            break
        if indent == 2 and stripped.startswith("- "):
            item = stripped[2:].strip()
            key, sep, value = item.partition(":")
            if not sep or key.strip() != "name":
                raise BuildError(
                    "skills.yml line {0}: expected '- name: <skill>'".format(i + 1)
                )
            current = {"name": _unquote(value), "publish": None, "imports": []}
            skills.append(current)
            i += 1
            continue
        if indent == 4 and stripped == "imports:":
            i += 1
            continue
        if indent == 4 and stripped.startswith("publish:"):
            if current is None:
                raise BuildError(
                    "skills.yml line {0}: publish before any skill".format(i + 1)
                )
            current["publish"] = _unquote(stripped[len("publish:"):])
            i += 1
            continue
        if indent == 6 and stripped.startswith("- "):
            if current is None:
                raise BuildError("skills.yml line {0}: import before any skill".format(i + 1))
            current["imports"].append(_unquote(stripped[2:]))
            i += 1
            continue
        raise BuildError("skills.yml line {0}: unexpected content {1!r}".format(i + 1, raw))
    return skills, i


def parse_skills_yml(text):
    """Parse the restricted flat-mapping-plus-skills-list shape used by skills.yml."""
    config = {}
    lines = text.splitlines()
    i = 0
    n = len(lines)
    while i < n:
        raw = lines[i]
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            i += 1
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        if indent != 0:
            raise BuildError("skills.yml line {0}: unexpected indentation".format(i + 1))
        key, sep, value = stripped.partition(":")
        if not sep:
            raise BuildError("skills.yml line {0}: expected 'key: value'".format(i + 1))
        key = key.strip()
        if key == "skills" and not value.strip():
            skills, i = _parse_skills_list(lines, i + 1, n)
            config["skills"] = skills
            continue
        config[key] = _unquote(value)
        i += 1
    return config


def published_name(skill):
    """Return the skill's published name (the publish field, or the source name when absent)."""
    return skill.get("publish") or skill["name"]


def rewrite_skill_md(text, name_map):
    """Rewrite source skill names to their published names across a SKILL.md's whole text.

    One left-to-right re.sub over the text. The alternation lists every source name ordered
    longest-first so a shorter name can never match inside a longer one, and each occurrence is
    guarded by a non-word-and-non-hyphen lookbehind and lookahead so an embedded name is left
    alone. Because the inserted published name is preceded by its own 'paqad-' the single pass
    cannot re-process its output, so the plugin name 'paqad-product-discovery' can never be
    corrupted into 'paqad-paqad-discover'. This one pass fixes the front-matter 'name:' line and
    every sibling reference in the body together.
    """
    if not name_map:
        return text
    sources = sorted(name_map, key=len, reverse=True)
    pattern = re.compile(
        r"(?<![\w-])(?:" + "|".join(re.escape(s) for s in sources) + r")(?![\w-])"
    )
    return pattern.sub(lambda m: name_map[m.group(0)], text)


def parse_keywords(text):
    """Split the comma-separated keywords scalar into a list, dropping empty entries."""
    keywords = [part.strip() for part in text.split(",") if part.strip()]
    if not keywords:
        raise BuildError("skills.yml 'keywords' has no keyword after splitting on commas")
    return keywords


def parse_pipe_list(text, field):
    """Split a pipe-separated list scalar into trimmed entries; an empty entry fails the build."""
    entries = [part.strip() for part in text.split("|")]
    if any(not entry for entry in entries):
        raise BuildError(
            "skills.yml '{0}' has an empty entry after splitting on '|'; remove the extra "
            "'|' or fill the entry".format(field)
        )
    return entries


def _check_length(field, value, limit):
    if len(value) > limit:
        raise BuildError(
            "skills.yml '{0}' is {1} characters; the limit is {2}".format(field, len(value), limit)
        )


def check_chatgpt_directory_scalars(config):
    """Require the ChatGPT directory scalars and hold them, display_name and author to the
    directory limits (CHATGPT_LIMITS). Replaces the two list scalars with their parsed lists."""
    for field in CHATGPT_DIRECTORY_SCALARS:
        if not config.get(field):
            raise BuildError("skills.yml is missing a non-empty '{0}'".format(field))
    if config["category"] not in CHATGPT_CATEGORIES:
        raise BuildError(
            "skills.yml 'category' must be one of {0}, got {1!r}".format(
                ", ".join(CHATGPT_CATEGORIES), config["category"]
            )
        )
    _check_length("display_name", config["display_name"], CHATGPT_LIMITS["display_name"])
    _check_length("author", config["author"], CHATGPT_LIMITS["developer_name"])
    _check_length(
        "short_description", config["short_description"], CHATGPT_LIMITS["short_description"]
    )
    _check_length(
        "long_description", config["long_description"], CHATGPT_LIMITS["long_description"]
    )
    prompts = parse_pipe_list(config["default_prompts"], "default_prompts")
    if len(prompts) > CHATGPT_LIMITS["default_prompts_count"]:
        raise BuildError(
            "skills.yml 'default_prompts' has {0} entries; the limit is {1}".format(
                len(prompts), CHATGPT_LIMITS["default_prompts_count"]
            )
        )
    if len(set(prompts)) != len(prompts):
        raise BuildError("skills.yml 'default_prompts' has a duplicate entry")
    for prompt in prompts:
        if "@" in prompt:
            raise BuildError(
                "skills.yml 'default_prompts' entry {0!r} contains '@'; prompts may not "
                "mention anything".format(prompt)
            )
        _check_length("default_prompts", prompt, CHATGPT_LIMITS["default_prompt_length"])
    capabilities = parse_pipe_list(config["capabilities"], "capabilities")
    if len(capabilities) > CHATGPT_LIMITS["capabilities_count"]:
        raise BuildError(
            "skills.yml 'capabilities' has {0} entries; the limit is {1}".format(
                len(capabilities), CHATGPT_LIMITS["capabilities_count"]
            )
        )
    for capability in capabilities:
        _check_length("capabilities", capability, CHATGPT_LIMITS["capability_length"])
    config["default_prompts"] = prompts
    config["capabilities"] = capabilities


def check_listing_scalars(config):
    """Require every listing scalar (no default) and https on every listing link."""
    for field in LISTING_SCALARS:
        if not config.get(field):
            raise BuildError("skills.yml is missing a non-empty '{0}'".format(field))
    for field in LISTING_URL_SCALARS:
        if not config[field].startswith("https://"):
            raise BuildError(
                "skills.yml '{0}' must start with https://, got {1!r}".format(
                    field, config[field]
                )
            )


def load_config(skills_yml_path):
    with open(skills_yml_path, "r", encoding="utf-8") as handle:
        config = parse_skills_yml(handle.read())
    for field in REQUIRED_SCALARS:
        if not config.get(field):
            raise BuildError("skills.yml is missing a non-empty '{0}'".format(field))
    check_listing_scalars(config)
    config["keywords"] = parse_keywords(config["keywords"])
    check_chatgpt_directory_scalars(config)
    if not config.get("skills"):
        raise BuildError("skills.yml declares no skills")
    return config


# --------------------------------------------------------------------------- shared imports


def list_shared_files(shared_root):
    """Return the set of shared file paths (relative, forward-slash) available under shared/."""
    found = set()
    if not os.path.isdir(shared_root):
        return found
    for dirpath, dirnames, filenames in os.walk(shared_root):
        dirnames.sort()
        for name in filenames:
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, shared_root).replace(os.sep, "/")
            found.add(rel)
    return found


def undeclared_shared_imports(skill_md_text, declared, shared_files):
    """Return shared files a SKILL.md references but did not declare in skills.yml."""
    undeclared = []
    for shared_rel in sorted(shared_files):
        if shared_rel in skill_md_text and shared_rel not in declared:
            undeclared.append(shared_rel)
    return undeclared


# --------------------------------------------------------------------------- copying


def copy_tree(src, dst):
    """Deterministically copy a directory tree, creating parents as needed.

    Excludes __pycache__ directories, *.pyc files and .DS_Store files so build and OS cruft never
    reaches dist/ and cannot threaten byte-identical repeat builds.
    """
    for dirpath, dirnames, filenames in os.walk(src):
        # Prune bytecode caches in place so os.walk does not descend into or recreate them.
        dirnames[:] = sorted(d for d in dirnames if d != "__pycache__")
        rel = os.path.relpath(dirpath, src)
        target_dir = dst if rel == "." else os.path.join(dst, rel)
        os.makedirs(target_dir, exist_ok=True)
        for name in sorted(filenames):
            if name.endswith(".pyc") or name in SKIPPED_FILE_NAMES:
                continue
            shutil.copyfile(os.path.join(dirpath, name), os.path.join(target_dir, name))


def write_json(path, data, sort_keys=True):
    text = json.dumps(data, sort_keys=sort_keys, indent=2, separators=(",", ": ")) + "\n"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)


# --------------------------------------------------------------------------- manifests


def build_manifests(config):
    name = config["name"]
    version = config["version"]
    description = config["description"]
    license_id = config["license"]
    display_name = config["display_name"]
    skill_names = [published_name(skill) for skill in config["skills"]]

    marketplace = {
        "name": name,
        "owner": {"name": config["author"]},
        "plugins": [
            {
                "name": name,
                "source": "./{0}".format(plugin_rel_path(name)),
                "description": description,
                "version": version,
            }
        ],
    }
    plugin_manifest = {
        "name": name,
        "version": version,
        "description": description,
        "license": license_id,
    }
    openai_manifest = {
        "name": name,
        "version": version,
        "description": description,
        "license": license_id,
        "extensions": {
            OPENAI_EXTENSION_KEY: {
                "display_name": display_name,
                "skills": skill_names,
            }
        },
    }
    return marketplace, plugin_manifest, openai_manifest


def build_claude_listing_manifests(config):
    """Return (marketplace, plugin_manifest) for the Claude branch: the base manifests plus only
    the documented directory listing fields, every value read from skills.yml (PLG-11)."""
    base_marketplace, base_plugin, _ = build_manifests(config)
    author = {"name": config["author"], "email": config["author_email"]}
    plugin_manifest = dict(base_plugin)
    plugin_manifest.update(
        {
            "author": author,
            "homepage": config["homepage"],
            "repository": config["repository"],
            "keywords": list(config["keywords"]),
            "displayName": config["display_name"],
            "documentationUrl": config["documentation_url"],
            "supportUrl": config["support_url"],
            "privacyPolicyUrl": config["privacy_policy_url"],
        }
    )
    marketplace = dict(base_marketplace)
    marketplace["owner"] = dict(author)
    marketplace["metadata"] = {"description": config["description"]}
    return marketplace, plugin_manifest


def build_chatgpt_directory_manifest(config):
    """Return the native Agent Plugins plugin.json of the ChatGPT directory package.

    Exactly the AGENT_PLUGINS_MANIFEST_KEYS at the top level and the CHATGPT_INTERFACE_KEYS under
    extensions.com.openai.interface, in that order, every value read from skills.yml or from one
    constant in this file (PLG-11). author carries no url because skills.yml has no source for it.
    """
    interface_values = {
        "displayName": config["display_name"],
        "shortDescription": config["short_description"],
        "longDescription": config["long_description"],
        "developerName": config["author"],
        "category": config["category"],
        "capabilities": list(config["capabilities"]),
        "defaultPrompt": list(config["default_prompts"]),
        "websiteURL": config["homepage"],
        "supportURL": config["support_url"],
        "privacyPolicyURL": config["privacy_policy_url"],
        "logo": CHATGPT_LOGO_PATH,
    }
    interface = {key: interface_values[key] for key in CHATGPT_INTERFACE_KEYS}
    values = {
        "$schema": AGENT_PLUGINS_SCHEMA_URL,
        "name": config["name"],
        "version": config["version"],
        "description": config["description"],
        "author": {"name": config["author"], "email": config["author_email"]},
        "homepage": config["homepage"],
        "repository": config["repository"],
        "license": config["license"],
        "keywords": list(config["keywords"]),
        "extensions": {OPENAI_EXTENSION_KEY: {"interface": interface}},
    }
    return {key: values[key] for key in AGENT_PLUGINS_MANIFEST_KEYS}


# --------------------------------------------------------------------------- host branches


def copy_publish_files(source_root, branch_root, host, name):
    """Copy the host's publish files into its branch; a missing source fails the build."""
    for source_rel, targets in HOST_PUBLISH_FILES.get(host, []):
        source = os.path.join(source_root, *source_rel.split("/"))
        if not os.path.isfile(source):
            raise BuildError("publish file not found: {0}".format(source_rel))
        for target_template in targets:
            target_rel = target_template.format(plugins=PLUGINS_DIR, name=name)
            target = os.path.join(branch_root, *target_rel.split("/"))
            os.makedirs(os.path.dirname(target), exist_ok=True)
            shutil.copyfile(source, target)


def emit_host_branches(source_root, dist_root, config, combined_plugin_dir):
    """Emit the per-host branches under dist/hosts/<host>/ from the one source (PLG-12).

    Reuses build_manifests() so every branch's manifests are generated from the same name, version
    and description as the combined dist (PLG-11), and reuses copy_tree() to copy the already
    assembled combined skills tree into each branch so every branch's skills tree is byte-identical
    to the combined dist. The combined dist/ root is left untouched. Each branch then gets its
    host's publish files (HOST_PUBLISH_FILES): the Claude and ChatGPT directory branches.
    """
    name = config["name"]
    marketplace, plugin_manifest, openai_manifest = build_manifests(config)
    claude_marketplace, claude_plugin = build_claude_listing_manifests(config)
    manifests = {
        "marketplace": marketplace,
        "plugin": plugin_manifest,
        "openai": openai_manifest,
        "claude_marketplace": claude_marketplace,
        "claude_plugin": claude_plugin,
        "chatgpt_directory": build_chatgpt_directory_manifest(config),
    }
    combined_skills = os.path.join(combined_plugin_dir, "skills")
    for host in sorted(HOST_BRANCHES):
        branch_root = os.path.join(dist_root, HOSTS_DIR, host)
        branch_plugin = plugin_dir_path(branch_root, name)
        copy_tree(combined_skills, os.path.join(branch_plugin, "skills"))
        for rel_template, which in HOST_BRANCHES[host]:
            rel = rel_template.format(plugins=PLUGINS_DIR, name=name)
            write_json(
                os.path.join(branch_root, *rel.split("/")),
                manifests[which],
                sort_keys=which not in ORDERED_MANIFEST_KINDS,
            )
        copy_publish_files(source_root, branch_root, host, name)


# --------------------------------------------------------------------------- build


def build(source_root, dist_root):
    skills_yml = os.path.join(source_root, "build", "skills.yml")
    config = load_config(skills_yml)
    name = config["name"]
    shared_root = os.path.join(source_root, "shared")
    shared_files = list_shared_files(shared_root)

    plugin_dir = plugin_dir_path(dist_root, name)

    # The source-folder -> published-name map, built once from the one source of truth, so the
    # SKILL.md rewrite renames the front-matter name: and every sibling reference consistently.
    name_map = {skill["name"]: published_name(skill) for skill in config["skills"]}

    # Clean the dist tree so removed inputs never linger; stays deterministic.
    if os.path.isdir(dist_root):
        shutil.rmtree(dist_root)

    for skill in config["skills"]:
        skill_name = skill["name"]
        declared = list(skill["imports"])
        src_skill = os.path.join(source_root, "skills", skill_name)
        if not os.path.isdir(src_skill):
            raise BuildError("skill folder not found: skills/{0}".format(skill_name))

        skill_md_path = os.path.join(src_skill, "SKILL.md")
        if not os.path.isfile(skill_md_path):
            raise BuildError("skills/{0}/SKILL.md is missing".format(skill_name))
        with open(skill_md_path, "r", encoding="utf-8") as handle:
            skill_md_text = handle.read()

        undeclared = undeclared_shared_imports(skill_md_text, declared, shared_files)
        if undeclared:
            raise BuildError(
                "skills/{0}/SKILL.md references undeclared shared import(s): {1}. "
                "Declare them under this skill's imports in build/skills.yml.".format(
                    skill_name, ", ".join(undeclared)
                )
            )

        dst_skill = os.path.join(plugin_dir, "skills", published_name(skill))
        copy_tree(src_skill, dst_skill)

        # Rewrite the copied SKILL.md so its front-matter name: equals the published folder name
        # (PLG-3) and every sibling reference reads the published name. SKILL.md text only; the
        # manifest JSON is generated separately and is never rewritten.
        dst_skill_md = os.path.join(dst_skill, "SKILL.md")
        with open(dst_skill_md, "r", encoding="utf-8") as handle:
            dst_skill_md_text = handle.read()
        rewritten = rewrite_skill_md(dst_skill_md_text, name_map)
        with open(dst_skill_md, "w", encoding="utf-8") as handle:
            handle.write(rewritten)

        for shared_rel in declared:
            if shared_rel not in shared_files:
                raise BuildError(
                    "skills/{0} declares shared import '{1}' but shared/{1} does not "
                    "exist".format(skill_name, shared_rel)
                )
            src = os.path.join(shared_root, shared_rel.replace("/", os.sep))
            dst = os.path.join(dst_skill, shared_rel.replace("/", os.sep))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(src, dst)

    marketplace, plugin_manifest, openai_manifest = build_manifests(config)
    write_json(os.path.join(dist_root, ".claude-plugin", "marketplace.json"), marketplace)
    write_json(os.path.join(dist_root, ".agents", "plugins", "marketplace.json"), marketplace)
    write_json(os.path.join(plugin_dir, ".claude-plugin", "plugin.json"), plugin_manifest)
    write_json(os.path.join(plugin_dir, "plugin.json"), openai_manifest)

    # Per-host branches under dist/hosts/ (PLG-12). The combined dist/ root above is unchanged.
    emit_host_branches(source_root, dist_root, config, plugin_dir)

    return dist_root


def main(argv=None):
    parser = argparse.ArgumentParser(description="Build dist/ from build/skills.yml.")
    here = os.path.dirname(os.path.abspath(__file__))
    default_source = os.path.dirname(here)
    parser.add_argument("--source", default=default_source, help="repository source root")
    parser.add_argument("--dist", default=None, help="output dist root (default <source>/dist)")
    args = parser.parse_args(argv)
    dist_root = args.dist or os.path.join(args.source, "dist")
    try:
        build(args.source, dist_root)
    except BuildError as exc:
        sys.stderr.write("build failed: {0}\n".format(exc))
        return 1
    sys.stdout.write("build ok: {0}\n".format(dist_root))
    return 0


if __name__ == "__main__":
    sys.exit(main())
