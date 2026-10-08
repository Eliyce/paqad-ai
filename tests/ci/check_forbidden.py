#!/usr/bin/env python3
"""CI-3 forbidden-content check over the BUILT dist (PLG-1, PLG-2).

Walks the built dist tree and fails when any forbidden path exists in the plugin: a bin/,
agents/, hooks/ or commands/ directory, or a .mcp.json, mcp.json or .app.json file. The dist
is built first when it is absent (reusing build.build, as run_parity.py does) so the check never
passes vacuously on a missing build.

Standard library only (Python 3.9+). No network. Reads the built dist; writes nothing.

CLI:
  check_forbidden.py [--dist <dist-root>] [--source <repo-root>]

stdout: {"ok", "findings"}. Exit 0 clean, 1 on any finding (fails loudly, never a silent pass).
"""

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))

BUILD_DIR = os.path.join(REPO_ROOT, "build")
if BUILD_DIR not in sys.path:
    sys.path.insert(0, BUILD_DIR)

import build

DEFAULT_DIST = os.path.join(REPO_ROOT, "dist")

FORBIDDEN_DIRS = ("bin", "agents", "hooks", "commands")
FORBIDDEN_FILES = (".mcp.json", "mcp.json", ".app.json")


def scan(dist_root):
    """Return the list of forbidden-path findings under dist_root (empty when clean)."""
    findings = []
    for dirpath, dirnames, filenames in os.walk(dist_root):
        dirnames[:] = sorted(d for d in dirnames if d != "__pycache__")
        for name in sorted(dirnames):
            if name in FORBIDDEN_DIRS:
                rel = os.path.relpath(os.path.join(dirpath, name), dist_root)
                findings.append(
                    "forbidden directory '{0}' in dist: {1}".format(name, rel.replace(os.sep, "/"))
                )
        for name in sorted(filenames):
            if name in FORBIDDEN_FILES:
                rel = os.path.relpath(os.path.join(dirpath, name), dist_root)
                findings.append(
                    "forbidden file '{0}' in dist: {1}".format(name, rel.replace(os.sep, "/"))
                )
    return findings


def ensure_dist(dist_root, source_root=REPO_ROOT):
    """Build the dist in place when it is absent so the check never passes vacuously."""
    if not os.path.isdir(os.path.join(dist_root, "plugins")):
        build.build(source_root, dist_root)
    return dist_root


def main(argv=None):
    parser = argparse.ArgumentParser(description="CI-3 forbidden-content check over the built dist.")
    parser.add_argument("--dist", default=DEFAULT_DIST)
    parser.add_argument("--source", default=REPO_ROOT)
    args = parser.parse_args(argv)

    ensure_dist(args.dist, args.source)
    findings = scan(args.dist)
    print(json.dumps({"ok": not findings, "findings": findings}, indent=2, ensure_ascii=False))
    return 1 if findings else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr)
        sys.exit(1)
