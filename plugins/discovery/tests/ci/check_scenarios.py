#!/usr/bin/env python3
"""CI-13 scenario-coverage check.

Asserts that the scenario list under tests/evals/scenarios/*.yml covers the section-13 acceptance
scenarios the evals are responsible for. The documented split is honoured: a conversation-shape
acceptance scenario is scenario-covered (it appears as an `acceptance:` id in a scenario yml), and a
script-proven acceptance scenario carries no scenario because the unit suite proves it. The
conversation-shape and script-proven sets are declared in the scenario READMEs and yml headers, so a
scenario removed from a yml body is still caught: its AC stays declared conversation-shape yet is no
longer scenario-covered.

The check fails loudly listing: any declared conversation-shape AC with no scenario; any section-13
AC that is neither scenario-covered nor declared script-proven; and any scenario targeting an AC that
is not a section-13 acceptance scenario.

The scenario yml files are read with run_parity.py's YAML reader (reused, not re-derived).
Standard library only (Python 3.9+). No network. Read-only.

CLI:
  check_scenarios.py [--scenarios-dir <dir>] [--requirements <REQUIREMENTS.md>]

stdout: {"ok", "findings", ...}. Exit 0 clean, 1 on any finding (fails loudly, never a silent pass).
"""

import argparse
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))

EVALS_DIR = os.path.join(REPO_ROOT, "tests", "evals")
if EVALS_DIR not in sys.path:
    sys.path.insert(0, EVALS_DIR)

import run_parity

DEFAULT_SCENARIOS_DIR = os.path.join(EVALS_DIR, "scenarios")
DEFAULT_REQUIREMENTS = os.path.join(os.path.dirname(os.path.dirname(REPO_ROOT)), "docs", "plugin-discovery", "REQUIREMENTS.md")

AC_TOKEN = re.compile(r"AC-(\d+)(?:\s+to\s+AC-(\d+))?")
TABLE_AC = re.compile(r"^\|\s*AC-(\d+)\s*\|")
CLAUSE_SPLIT = re.compile(r"[;.]\s")


def extract_acs(clause):
    """Return the set of AC numbers named in a clause, expanding 'AC-x to AC-y' ranges."""
    numbers = set()
    for match in AC_TOKEN.finditer(clause):
        start = int(match.group(1))
        if match.group(2):
            end = int(match.group(2))
            numbers.update(range(start, end + 1))
        else:
            numbers.add(start)
    return numbers


def parse_section13(requirements_path):
    """Return the set of AC numbers declared as acceptance scenarios in section 13."""
    acs = set()
    in_section = False
    with open(requirements_path, "r", encoding="utf-8") as handle:
        for line in handle:
            if line.startswith("## 13."):
                in_section = True
                continue
            if in_section and line.startswith("## "):
                break
            if in_section:
                match = TABLE_AC.match(line.strip())
                if match:
                    acs.add(int(match.group(1)))
    return acs


def _declaration_text(scenarios_dir):
    """Return the combined declaration text from the scenario README and yml headers."""
    parts = []
    readme = os.path.join(scenarios_dir, "README.md")
    if os.path.isfile(readme):
        with open(readme, "r", encoding="utf-8") as handle:
            parts.append(handle.read())
    for path in sorted(glob.glob(os.path.join(scenarios_dir, "*.yml"))):
        with open(path, "r", encoding="utf-8") as handle:
            comments = [
                line.strip().lstrip("#").strip()
                for line in handle
                if line.strip().startswith("#")
            ]
        parts.append(" ".join(comments))
    return "\n".join(parts)


def parse_declarations(scenarios_dir):
    """Return (conversation_shape, script_proven) AC sets from the declaration text."""
    text = _declaration_text(scenarios_dir).replace("\n", " ")
    conv = set()
    script_raw = set()
    for clause in CLAUSE_SPLIT.split(text):
        lowered = clause.lower()
        acs = extract_acs(clause)
        if not acs:
            continue
        if "script-proven" in lowered or "script-covered" in lowered or "script proven" in lowered:
            script_raw.update(acs)
        elif "conversation-shape" in lowered:
            conv.update(acs)
    return conv, script_raw - conv


def scenario_covered(scenarios_dir):
    """Return the set of AC numbers covered by a scenario in any scenarios/*.yml file."""
    covered = set()
    for path in sorted(glob.glob(os.path.join(scenarios_dir, "*.yml"))):
        data = run_parity.load_scenarios(path)
        for scenario in data.get("scenarios") or []:
            if not isinstance(scenario, dict):
                continue
            acceptance = scenario.get("acceptance")
            if not acceptance:
                continue
            for match in AC_TOKEN.finditer(str(acceptance)):
                covered.add(int(match.group(1)))
    return covered


def check(scenarios_dir=DEFAULT_SCENARIOS_DIR, requirements_path=DEFAULT_REQUIREMENTS):
    """Return the list of coverage findings (empty when every section-13 AC is accounted for)."""
    section13 = parse_section13(requirements_path)
    conv, script = parse_declarations(scenarios_dir)
    covered = scenario_covered(scenarios_dir)
    findings = []
    if not section13:
        findings.append("no section-13 acceptance scenarios were parsed from REQUIREMENTS.md")
        return findings
    for ac in sorted(conv):
        if ac not in covered:
            findings.append(
                "AC-{0} is a declared conversation-shape acceptance scenario but no scenario "
                "exercises it".format(ac)
            )
    accounted = covered | conv | script
    for ac in sorted(section13):
        if ac not in accounted:
            findings.append(
                "AC-{0} is in REQUIREMENTS section 13 but is neither scenario-covered nor "
                "declared script-proven".format(ac)
            )
    for ac in sorted(covered):
        if ac not in section13:
            findings.append(
                "a scenario targets AC-{0}, which is not a section-13 acceptance scenario".format(ac)
            )
    return findings


def main(argv=None):
    parser = argparse.ArgumentParser(description="CI-13 scenario-coverage check.")
    parser.add_argument("--scenarios-dir", default=DEFAULT_SCENARIOS_DIR)
    parser.add_argument("--requirements", default=DEFAULT_REQUIREMENTS)
    args = parser.parse_args(argv)

    findings = check(args.scenarios_dir, args.requirements)
    print(json.dumps({"ok": not findings, "findings": findings}, indent=2, ensure_ascii=False))
    return 1 if findings else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr)
        sys.exit(1)
