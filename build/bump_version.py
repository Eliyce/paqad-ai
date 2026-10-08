#!/usr/bin/env python3
"""CI-14 version bump helper (the deterministic half).

Reads the pending changesets under .changeset/*.md to determine the semantic bump (major, minor or
patch), bumps ONLY the single version scalar in build/skills.yml (the one source of the version,
PLG-11), then rebuilds dist through build.build so every manifest is regenerated from that one source
and no dist manifest is ever hand-edited (RULE-21). The highest bump named across the changesets wins.

If no changeset names a bump, the helper exits non-zero with a clear message rather than guessing a
bump. A --dry-run prints the computed next version and writes nothing.

Standard library only (Python 3.9+). No network. Writes only build/skills.yml and the dist tree.

CLI:
  bump_version.py [--source <repo-root>] [--changeset-dir <dir>] [--dist <dir>] [--dry-run]

stdout: {"ok", "bump", "previous", "next", ...}. Exit 0 on success, non-zero on no changeset.
"""

import argparse
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)

if HERE not in sys.path:
    sys.path.insert(0, HERE)

import build

BUMP_RANK = {"patch": 1, "minor": 2, "major": 3}
BUMP_WORD = re.compile(r"\b(major|minor|patch)\b", re.IGNORECASE)
VERSION_LINE = re.compile(r"^version:\s*(.+?)\s*$")
SEMVER = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


class BumpError(Exception):
    """Raised when the bump cannot be computed or applied; carries a human-readable message."""


def _frontmatter(text):
    """Return the text between the first two '---' fences, or the whole text when absent."""
    lines = text.splitlines()
    if lines and lines[0].strip() == "---":
        for index in range(1, len(lines)):
            if lines[index].strip() == "---":
                return "\n".join(lines[1:index])
    return text


def read_changesets(changeset_dir):
    """Return the highest bump named across the changeset files, or None when none is found."""
    best = None
    for path in sorted(glob.glob(os.path.join(changeset_dir, "*.md"))):
        if os.path.basename(path).lower() == "readme.md":
            continue
        with open(path, "r", encoding="utf-8") as handle:
            text = handle.read()
        match = BUMP_WORD.search(_frontmatter(text)) or BUMP_WORD.search(text)
        if not match:
            continue
        level = match.group(1).lower()
        if best is None or BUMP_RANK[level] > BUMP_RANK[best]:
            best = level
    return best


def compute_next(version, bump):
    """Return the next semantic version string for the given bump level."""
    match = SEMVER.match(version)
    if not match:
        raise BumpError("version '{0}' is not a MAJOR.MINOR.PATCH semantic version".format(version))
    major, minor, patch = (int(match.group(1)), int(match.group(2)), int(match.group(3)))
    if bump == "major":
        major, minor, patch = major + 1, 0, 0
    elif bump == "minor":
        minor, patch = minor + 1, 0
    else:
        patch += 1
    return "{0}.{1}.{2}".format(major, minor, patch)


def read_version(skills_yml_path):
    """Return the current version scalar from build/skills.yml."""
    with open(skills_yml_path, "r", encoding="utf-8") as handle:
        for line in handle:
            match = VERSION_LINE.match(line)
            if match:
                return build._unquote(match.group(1))
    raise BumpError("build/skills.yml has no top-level version scalar")


def write_version(skills_yml_path, next_version):
    """Rewrite only the version scalar line in build/skills.yml, leaving every other line intact."""
    with open(skills_yml_path, "r", encoding="utf-8") as handle:
        lines = handle.readlines()
    replaced = False
    for index, line in enumerate(lines):
        if VERSION_LINE.match(line):
            lines[index] = "version: {0}\n".format(next_version)
            replaced = True
            break
    if not replaced:
        raise BumpError("build/skills.yml has no top-level version scalar to rewrite")
    with open(skills_yml_path, "w", encoding="utf-8") as handle:
        handle.writelines(lines)


def run(source_root, changeset_dir, dist_root, dry_run):
    """Compute the bump, apply it to skills.yml and rebuild dist unless dry_run is set."""
    skills_yml = os.path.join(source_root, "build", "skills.yml")
    bump = read_changesets(changeset_dir)
    if bump is None:
        raise BumpError(
            "no changeset names a bump under {0}; add a .changeset/*.md naming major, minor or "
            "patch before releasing".format(changeset_dir)
        )
    previous = read_version(skills_yml)
    next_version = compute_next(previous, bump)
    result = {
        "ok": True,
        "bump": bump,
        "previous": previous,
        "next": next_version,
        "dry_run": bool(dry_run),
    }
    if dry_run:
        return result
    write_version(skills_yml, next_version)
    build.build(source_root, dist_root)
    result["dist"] = dist_root
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description="CI-14 version bump from changesets.")
    parser.add_argument("--source", default=REPO_ROOT)
    parser.add_argument("--changeset-dir", default=None)
    parser.add_argument("--dist", default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    changeset_dir = args.changeset_dir or os.path.join(args.source, ".changeset")
    dist_root = args.dist or os.path.join(args.source, "dist")
    try:
        result = run(args.source, changeset_dir, dist_root, args.dry_run)
    except BumpError as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr)
        sys.exit(1)
