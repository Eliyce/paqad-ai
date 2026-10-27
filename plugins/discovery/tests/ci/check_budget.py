#!/usr/bin/env python3
"""CI-10 budget check over the BUILT dist.

Measures each installable plugin unit in the built dist and fails when any single unit exceeds
5 MB or 300 files. An installable unit is what a user actually receives: the combined plugin under
dist/plugins/<name> and each per-host branch under dist/hosts/<host>/plugins/<name> (resolved
decision D-01M4D8JRWCTAHJSHAQDE69M5A3, per_branch). The whole-dist total is also reported for
visibility but is not a failure, because the per-host branches (PLG-12) carry byte-identical copies
of the one skills tree and only one branch is installed per host.

The measured size and count per unit, and the whole-dist total, are reported so the CI log shows the
headroom. The dist is built first when it is absent (reusing build.build, like run_parity.py) so the
check never passes vacuously on a missing build.

Standard library only (Python 3.9+). No network. Reads the built dist; writes nothing.

CLI:
  check_budget.py [--dist <dist-root>] [--source <repo-root>] [--max-bytes N] [--max-files N]

stdout: {"ok", "findings", "units", "total_bytes", "total_files"}. Exit 0 clean, 1 over budget.
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

MAX_BYTES = 5 * 1024 * 1024
MAX_FILES = 300


def measure(root):
    """Return (total_bytes, file_count) under root, matching what the build actually emits."""
    total_bytes = 0
    file_count = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d != "__pycache__")
        for name in sorted(filenames):
            if name.endswith(".pyc"):
                continue
            total_bytes += os.path.getsize(os.path.join(dirpath, name))
            file_count += 1
    return total_bytes, file_count


def installable_units(dist_root):
    """Return the absolute paths of every installable plugin unit in the built dist."""
    units = []
    combined = os.path.join(dist_root, "plugins")
    if os.path.isdir(combined):
        for child in sorted(os.listdir(combined)):
            path = os.path.join(combined, child)
            if os.path.isdir(path):
                units.append(path)
    hosts = os.path.join(dist_root, "hosts")
    if os.path.isdir(hosts):
        for host in sorted(os.listdir(hosts)):
            plugins = os.path.join(hosts, host, "plugins")
            if not os.path.isdir(plugins):
                continue
            for child in sorted(os.listdir(plugins)):
                path = os.path.join(plugins, child)
                if os.path.isdir(path):
                    units.append(path)
    return units


def check(dist_root, max_bytes=MAX_BYTES, max_files=MAX_FILES):
    """Return (findings, report) for the built dist, measuring each installable unit."""
    findings = []
    units_report = []
    units = installable_units(dist_root)
    if not units:
        findings.append("no installable plugin unit found under the dist; is the dist built?")
    for unit in units:
        unit_bytes, unit_files = measure(unit)
        rel = os.path.relpath(unit, dist_root).replace(os.sep, "/")
        units_report.append({
            "unit": rel,
            "bytes": unit_bytes,
            "files": unit_files,
            "bytes_headroom": max_bytes - unit_bytes,
            "files_headroom": max_files - unit_files,
        })
        if unit_bytes > max_bytes:
            findings.append(
                "unit '{0}' is over the size budget: {1} bytes exceeds {2} bytes".format(
                    rel, unit_bytes, max_bytes
                )
            )
        if unit_files > max_files:
            findings.append(
                "unit '{0}' is over the file budget: {1} files exceeds {2} files".format(
                    rel, unit_files, max_files
                )
            )
    total_bytes, total_files = measure(dist_root)
    report = {
        "ok": not findings,
        "findings": findings,
        "max_bytes": max_bytes,
        "max_files": max_files,
        "units": units_report,
        "total_bytes": total_bytes,
        "total_files": total_files,
    }
    return findings, report


def ensure_dist(dist_root, source_root=REPO_ROOT):
    """Build the dist in place when it is absent so the check never passes vacuously."""
    if not os.path.isdir(os.path.join(dist_root, "plugins")):
        build.build(source_root, dist_root)
    return dist_root


def main(argv=None):
    parser = argparse.ArgumentParser(description="CI-10 budget check over the built dist.")
    parser.add_argument("--dist", default=DEFAULT_DIST)
    parser.add_argument("--source", default=REPO_ROOT)
    parser.add_argument("--max-bytes", type=int, default=MAX_BYTES)
    parser.add_argument("--max-files", type=int, default=MAX_FILES)
    args = parser.parse_args(argv)

    ensure_dist(args.dist, args.source)
    findings, report = check(args.dist, args.max_bytes, args.max_files)
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 1 if findings else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr)
        sys.exit(1)
