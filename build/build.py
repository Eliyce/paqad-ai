#!/usr/bin/env python3
"""Assemble dist/ for the paqad-product-discovery plugin from a single source of truth.

Standard library only (Python 3.9+). No network. Reads name, version, description, license and
display text from build/skills.yml and from nowhere else, copies each skill plus its declared
shared imports into dist/, and generates all four manifests from those values so no two
manifests can disagree (PLG-11).

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
import shutil
import sys

# The OpenAI primary manifest carries its host-specific keys under this extension namespace.
# The literal lives here in the build generator, never in shipped skill or shared text.
OPENAI_EXTENSION_KEY = "com.openai"

REQUIRED_SCALARS = ("name", "version", "description", "license", "display_name")

# The plugins-directory convention, defined once (a plugin lives at plugins/<name>) so the two
# places that need it (the marketplace "source" string and the on-disk plugin directory) can
# never drift apart.
PLUGINS_DIR = "plugins"


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
            current = {"name": _unquote(value), "imports": []}
            skills.append(current)
            i += 1
            continue
        if indent == 4 and stripped == "imports:":
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


def load_config(skills_yml_path):
    with open(skills_yml_path, "r", encoding="utf-8") as handle:
        config = parse_skills_yml(handle.read())
    for field in REQUIRED_SCALARS:
        if not config.get(field):
            raise BuildError("skills.yml is missing a non-empty '{0}'".format(field))
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

    Excludes __pycache__ directories and *.pyc files so build cruft never reaches dist/ and
    cannot threaten byte-identical repeat builds.
    """
    for dirpath, dirnames, filenames in os.walk(src):
        # Prune bytecode caches in place so os.walk does not descend into or recreate them.
        dirnames[:] = sorted(d for d in dirnames if d != "__pycache__")
        rel = os.path.relpath(dirpath, src)
        target_dir = dst if rel == "." else os.path.join(dst, rel)
        os.makedirs(target_dir, exist_ok=True)
        for name in sorted(filenames):
            if name.endswith(".pyc"):
                continue
            shutil.copyfile(os.path.join(dirpath, name), os.path.join(target_dir, name))


def write_json(path, data):
    text = json.dumps(data, sort_keys=True, indent=2, separators=(",", ": ")) + "\n"
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
    skill_names = [skill["name"] for skill in config["skills"]]

    marketplace = {
        "name": name,
        "owner": {"name": config.get("author", "Paqad")},
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


# --------------------------------------------------------------------------- build


def build(source_root, dist_root):
    skills_yml = os.path.join(source_root, "build", "skills.yml")
    config = load_config(skills_yml)
    name = config["name"]
    shared_root = os.path.join(source_root, "shared")
    shared_files = list_shared_files(shared_root)

    plugin_dir = plugin_dir_path(dist_root, name)

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

        dst_skill = os.path.join(plugin_dir, "skills", skill_name)
        copy_tree(src_skill, dst_skill)

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
