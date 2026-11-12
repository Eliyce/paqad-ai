#!/usr/bin/env python3
"""Report whether the current step's required blocks are present and not stale (8.5 Record).

Reads the discovery record and checks that the current step's required blocks exist, hold
content and are not marked stale. A present-but-stale block counts as not satisfied, exactly
as the go-back map intends, so a resumed run can tell what still has to be redone (AC-15).

Standard library only. No network. Read-only: it writes nothing.

CLI:
  check_record.py --path <record.json> [--step <n>]   (step defaults to run.step)

stdout: {"ok", "issues"}. Exit 0 when clean, 1 when a required block is missing or stale.

Run with --help to print the usage.
"""

import argparse
import sys
from pathlib import Path

import canonical
import record

# The required-blocks map, the mode-specific required map and the present() test are the single
# canonical definitions in record.py (RULE-11). This reader imports them rather than keeping its
# own copies, so the two files can never drift. record.py is safe to import: its CLI is guarded by
# __main__. Which map governs a given record is decided by record.required_for, keyed off run.mode:
# REQUIRED in build mode and MODE_REQUIRED in the existing-work modes.
REQUIRED = record.REQUIRED
MODE_REQUIRED = record.MODE_REQUIRED
present = record.present

SCAN_KEYS = {"lines_read", "jira_prefixes", "github_refs"}
PREFIX_KEYS = {"prefix", "count"}
SCAN_PATH = "setup -> ticket_key_scan"
SCAN_MESSAGE = (
    "The ticket key scan holds counts only: lines_read, each prefix with its count, and "
    "github_refs, never examples, branch names or commit text."
)


def is_count(value):
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def prefix_ok(entry):
    return (
        isinstance(entry, dict)
        and set(entry) == PREFIX_KEYS
        and isinstance(entry["prefix"], str)
        and is_count(entry["count"])
    )


def scan_issues(rec):
    setup = rec.get("setup")
    scan = setup.get("ticket_key_scan") if isinstance(setup, dict) else None
    if scan is None:
        return []
    valid = (
        isinstance(scan, dict)
        and set(scan) == SCAN_KEYS
        and is_count(scan["lines_read"])
        and is_count(scan["github_refs"])
        and isinstance(scan["jira_prefixes"], list)
        and all(prefix_ok(entry) for entry in scan["jira_prefixes"])
    )
    return [] if valid else [canonical.issue("SCAN", SCAN_PATH, SCAN_MESSAGE)]


def check(rec, step=None):
    """Return the list of issues for the given step (run.step by default)."""
    issues = []
    run = rec.get("run")
    if not isinstance(run, dict):
        return [canonical.issue("RECORD", "run", "Record is missing its run block.")]
    mode = run.get("mode", "build")
    if step is None:
        step = run.get("step")
    # Build mode keeps its exact step-keyed behaviour, including the unknown-step guard (INV-1).
    if mode == "build" and step not in REQUIRED:
        return [canonical.issue("STEP", "step", "Unknown step {0}.".format(step))]
    stale = set(rec.get("stale", []))
    for block in record.required_for(rec, step):
        path = "step {0} -> {1}".format(step, block)
        if not present(rec.get(block)):
            issues.append(canonical.issue("MISSING", path, "Required block is missing or empty."))
        elif block in stale:
            issues.append(canonical.issue("STALE", path, "Required block is stale and must be redone."))
    return issues + scan_issues(rec)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Check the record for the current step.")
    parser.add_argument("--path", required=True, type=Path)
    parser.add_argument("--step", type=int)
    args = parser.parse_args(argv)
    rec = canonical.load(args.path)
    issues = check(rec, step=args.step)
    return canonical.result(issues)


if __name__ == "__main__":
    sys.exit(main())
