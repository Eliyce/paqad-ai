#!/usr/bin/env python3
"""Export the approved ticket set as a Jira importer CSV (PUB-8 export fallback).

Columns, in exactly this order:
  Work type, Work item id, Summary, Description, Labels, Parent

Every epic row comes before its story rows, and each story's Parent is the parent epic's Work
item id (the epic ref). Labels are joined with spaces, since a Jira label holds no space.

Standard library only. No network.

CLI:
  export_csv.py --ticket-set <ticket-set.json> [--out <file.csv>]

With --out the CSV is written to that path (inside the working folder); otherwise it is printed to
stdout. Exit 0 clean, 1 on error.
"""

import argparse
import csv
import io
import sys
from pathlib import Path

import canonical

COLUMNS = ["Work type", "Work item id", "Summary", "Description", "Labels", "Parent"]


def rows(ticket_set):
    """Yield one row per epic, each immediately followed by its stories."""
    tracker = ticket_set.get("tracker", {})
    epic_type = tracker.get("epic_type", "Epic")
    story_type = tracker.get("story_type", "Story")
    for epic in ticket_set.get("epics", []):
        yield {
            "Work type": epic_type,
            "Work item id": epic.get("ref", ""),
            "Summary": epic.get("title", ""),
            "Description": epic.get("body_markdown", ""),
            "Labels": " ".join(epic.get("labels", []) or []),
            "Parent": "",
        }
        for ticket in epic.get("tickets", []):
            yield {
                "Work type": story_type,
                "Work item id": ticket.get("ref", ""),
                "Summary": ticket.get("title", ""),
                "Description": ticket.get("body_markdown", ""),
                "Labels": "",
                "Parent": epic.get("ref", ""),
            }


def to_csv(ticket_set):
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=COLUMNS)
    writer.writeheader()
    for row in rows(ticket_set):
        writer.writerow(row)
    return buffer.getvalue()


def main(argv=None):
    parser = argparse.ArgumentParser(description="Export the approved set as a Jira importer CSV.")
    parser.add_argument("--ticket-set", required=True, type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args(argv)
    ticket_set = canonical.load(args.ticket_set)
    text = to_csv(ticket_set)
    if args.out is not None:
        args.out.write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, TypeError) as error:
        print('{"ok": false, "error": ' + repr(str(error)) + "}", file=sys.stderr)
        sys.exit(1)
