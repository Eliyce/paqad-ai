#!/usr/bin/env python3
"""Compare the created issues to the approved set after normalisation (PUB-6).

Reads the approved ticket set and the created issues, normalises each comparable field, and
reports whether the created issues match the approved set. A partial result (some issues match,
some are missing or differ) is reported as partial, never as done.

Normalisation removes whitespace differences, list markers and escaping from body text, folds
labels and links into sets, and reduces the Sources item reference to the run ID plus item
reference.

Standard library only. No network. Read-only.

CLI:
  check_readback.py --approved <ticket-set.json> --created <created-issues.json>

The created issues file is a list of objects:
  { "ref", "title", "type", "parent" (parent ref), "labels" [..], "links" [{"target": ref}..],
    "sources_ref" (e.g. "DR-20261005-7K2Q / E1-T1"), "body" }

stdout: {"ok", "status" (match | partial | mismatch), "differences": [..]}. Exit 0 on a full
match, 1 otherwise.
"""

import argparse
import json
import re
import sys
from pathlib import Path

import canonical

LIST_MARKER = re.compile(r"(?m)^\s*(?:[-*+]|\d+[.)])\s+")
ESCAPE = re.compile(r"\\(.)")
WHITESPACE = re.compile(r"\s+")


def norm_text(value):
    """Collapse whitespace, drop list markers and escaping so bodies compare on content."""
    text = str(value or "")
    text = LIST_MARKER.sub("", text)
    text = ESCAPE.sub(r"\1", text)
    text = WHITESPACE.sub(" ", text)
    return text.strip().casefold()


def norm_title(value):
    return WHITESPACE.sub(" ", str(value or "")).strip().casefold()


def norm_ref(value):
    return WHITESPACE.sub("", str(value or "")).casefold()


def expected_items(ticket_set):
    """Flatten the approved set into comparable records keyed by ref."""
    tracker = ticket_set.get("tracker", {})
    run_id = ticket_set.get("run_id", "")
    items = {}
    for epic in ticket_set.get("epics", []):
        items[epic["ref"]] = {
            "ref": epic["ref"],
            "title": norm_title(epic.get("title")),
            "type": norm_title(tracker.get("epic_type")),
            "parent": "",
            "labels": set(epic.get("labels", [])),
            "links": set(),
            "sources_ref": norm_ref("{0} / {1}".format(run_id, epic["ref"])),
            "body": norm_text(epic.get("body_markdown")),
        }
        for ticket in epic.get("tickets", []):
            links = set(norm_ref(dep) for dep in ticket.get("depends_on", []) or [])
            items[ticket["ref"]] = {
                "ref": ticket["ref"],
                "title": norm_title(ticket.get("title")),
                "type": norm_title(tracker.get("story_type")),
                "parent": norm_ref(epic["ref"]),
                "labels": set(),
                "links": links,
                "sources_ref": norm_ref("{0} / {1}".format(run_id, ticket["ref"])),
                "body": norm_text(ticket.get("body_markdown")),
            }
    return items


def created_record(issue):
    return {
        "title": norm_title(issue.get("title")),
        "type": norm_title(issue.get("type")),
        "parent": norm_ref(issue.get("parent")),
        "labels": set(issue.get("labels", [])),
        "links": set(norm_ref((link or {}).get("target")) for link in issue.get("links", []) or []),
        "sources_ref": norm_ref(issue.get("sources_ref")),
        "body": norm_text(issue.get("body")),
    }


def compare(approved, created):
    """Return (status, differences). status is match, partial or mismatch."""
    expected = expected_items(approved)
    actual = {issue.get("ref"): created_record(issue) for issue in created}

    differences = []
    matched = 0
    for ref, want in expected.items():
        got = actual.get(ref)
        if got is None:
            differences.append(canonical.issue("MISSING", ref, "Approved item was not created."))
            continue
        item_diffs = []
        for field in ("title", "type", "parent", "sources_ref", "body"):
            if want[field] != got[field]:
                item_diffs.append(field)
        # labels: every approved label must be present (extras like the run label are allowed).
        if not want["labels"].issubset(got["labels"]):
            item_diffs.append("labels")
        if want["links"] != got["links"]:
            item_diffs.append("links")
        if item_diffs:
            differences.append(canonical.issue(
                "DIFF", ref, "Fields differ after normalisation: " + ", ".join(item_diffs)))
        else:
            matched += 1

    extra = [ref for ref in actual if ref not in expected]
    for ref in extra:
        differences.append(canonical.issue("EXTRA", str(ref), "Created issue not in the approved set."))

    if not differences:
        status = "match"
    elif matched > 0:
        status = "partial"
    else:
        status = "mismatch"
    return status, differences


def main(argv=None):
    parser = argparse.ArgumentParser(description="Compare created issues to the approved set.")
    parser.add_argument("--approved", required=True, type=Path)
    parser.add_argument("--created", required=True, type=Path)
    args = parser.parse_args(argv)
    approved = canonical.load(args.approved)
    created = canonical.load(args.created)
    status, differences = compare(approved, created)
    print(json.dumps({"ok": status == "match", "status": status, "differences": differences},
                     indent=2, ensure_ascii=False))
    return 0 if status == "match" else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr)
        sys.exit(1)
