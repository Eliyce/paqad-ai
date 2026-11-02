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
    return issues


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
