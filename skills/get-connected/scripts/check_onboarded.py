#!/usr/bin/env python3
"""The GRD-1 onboarded check: is this repository set up for the plugin?

The repository counts as onboarded only when both docs/instructions/registries/modules.md and
at least one docs/modules/<module>/index/summary.md exist. When either is missing the plugin
stops at step 0 with the exact onboarding message and drafts nothing.

Standard library only. No network. Read-only: it writes nothing.

CLI:
  check_onboarded.py [--root <repo-root>]   (root defaults to the current working folder)

stdout: {"ok": true} on pass, or {"ok": false, "message": <stop message>} on fail. Exit 0 on
pass, 1 on fail.
"""

import argparse
import json
import sys
from pathlib import Path

STOP_MESSAGE = ("This repository isn't set up for this yet. Ask your engineering team to "
                "onboard it with paqad, then come back.")


def is_onboarded(root):
    """True when both GRD-1 paths exist under root."""
    root = Path(root)
    registry = root / "docs" / "instructions" / "registries" / "modules.md"
    if not registry.is_file():
        return False
    modules_root = root / "docs" / "modules"
    if not modules_root.is_dir():
        return False
    for summary in modules_root.glob("*/index/summary.md"):
        if summary.is_file():
            return True
    return False


def main(argv=None):
    parser = argparse.ArgumentParser(description="The GRD-1 onboarded check.")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args(argv)
    if is_onboarded(args.root):
        print(json.dumps({"ok": True}))
        return 0
    print(json.dumps({"ok": False, "message": STOP_MESSAGE}))
    return 1


if __name__ == "__main__":
    sys.exit(main())
