#!/usr/bin/env python3
"""CI-19 host-verdict integrity check.

Parses the verdict tables in hosts/<host>.md and fails when a recorded support state is malformed or
claims a supported host without evidence, so the hand-filled record can never drift out of the CI-19
vocabulary or assert installed/verified support with an empty Evidence cell.

A verdict table is any Markdown table whose header row carries both a Verdict column and an Evidence
column; the two columns are resolved by header name, not a fixed index, so a host file may order its
other columns freely. A host file with no verdict table contributes no findings.

Allowed verdicts (REQUIREMENTS.md section 12.5, CI-19): pending, packaged, installed, verified.
Evidence is required only for installed and verified, which assert a host action; pending and
packaged assert none and need no evidence.

Standard library only (Python 3.9+). No network. Read-only.

CLI:
  check_host_verdicts.py [--host-file <path> ...]

stdout: {"ok", "findings"}. Exit 0 clean, 1 on any finding (fails loudly, never a silent pass).
"""

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
HOSTS_DIR = os.path.join(REPO_ROOT, "hosts")
DEFAULT_HOST_FILES = [
    os.path.join(HOSTS_DIR, "claude.md"),
    os.path.join(HOSTS_DIR, "chatgpt.md"),
    os.path.join(HOSTS_DIR, "codex.md"),
]
ALLOWED_VERDICTS = ("pending", "packaged", "installed", "verified")
EVIDENCE_REQUIRED = ("installed", "verified")


def _cells(line):
    stripped = line.strip()
    if not stripped.startswith("|"):
        return None
    inner = stripped.strip("|")
    return [cell.strip() for cell in inner.split("|")]


def _is_separator(cells):
    return bool(cells) and all(set(cell) <= set("-: ") and "-" in cell for cell in cells)


def _column_index(header, name):
    for index, cell in enumerate(header):
        if cell.strip().lower() == name:
            return index
    return None


def parse_rows(host_files=None):
    """Return the recorded verdict rows as dicts: {file, label, verdict, evidence}.

    A missing host file yields one row with verdict '<missing>' so a wrong path fails the check
    loudly rather than passing as an empty, valid-looking parse.
    """
    if host_files is None:
        host_files = DEFAULT_HOST_FILES
    rows = []
    for path in host_files:
        rel = os.path.relpath(path, REPO_ROOT)
        if not os.path.isfile(path):
            rows.append({"file": rel, "label": "", "verdict": "<missing>", "evidence": ""})
            continue
        with open(path, "r", encoding="utf-8") as handle:
            lines = handle.read().splitlines()
        verdict_col = None
        evidence_col = None
        in_table = False
        for line in lines:
            cells = _cells(line)
            if cells is None:
                verdict_col = None
                evidence_col = None
                in_table = False
                continue
            if _is_separator(cells):
                continue
            vcol = _column_index(cells, "verdict")
            ecol = _column_index(cells, "evidence")
            if vcol is not None and ecol is not None:
                verdict_col = vcol
                evidence_col = ecol
                in_table = True
                continue
            if not in_table or verdict_col >= len(cells) or evidence_col >= len(cells):
                continue
            rows.append(
                {
                    "file": rel,
                    "label": cells[0] if cells else "",
                    "verdict": cells[verdict_col].strip(),
                    "evidence": cells[evidence_col].strip(),
                }
            )
    return rows


def check(host_files=None):
    """Return the list of verdict-integrity findings (empty when every recorded verdict is valid)."""
    findings = []
    for row in parse_rows(host_files):
        verdict = row["verdict"].strip().lower()
        if verdict not in ALLOWED_VERDICTS:
            findings.append(
                "{0}: row '{1}' has verdict '{2}', not one of {3}".format(
                    row["file"], row["label"], row["verdict"], ", ".join(ALLOWED_VERDICTS)
                )
            )
        elif verdict in EVIDENCE_REQUIRED and not row["evidence"]:
            findings.append(
                "{0}: row '{1}' is '{2}' but carries no evidence".format(
                    row["file"], row["label"], verdict
                )
            )
    return findings


def main(argv=None):
    parser = argparse.ArgumentParser(description="CI-19 host-verdict integrity check.")
    parser.add_argument("--host-file", action="append", dest="host_files", default=None)
    args = parser.parse_args(argv)

    findings = check(args.host_files)
    print(json.dumps({"ok": not findings, "findings": findings}, indent=2, ensure_ascii=False))
    return 1 if findings else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr)
        sys.exit(1)
