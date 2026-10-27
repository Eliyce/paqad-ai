#!/usr/bin/env python3
"""Build a field-by-field refine change set with conflict and rich-content guards (EDT-4 to EDT-9).

Reads the ticket snapshot taken at the start of a refine, the proposed field changes the
diagnosis wants, and (optionally) the live tracker state, and produces a before/after change set
that the host applies only after an explicit, digest-bound "apply it". It writes nothing to any
tracker; it only plans the change.

What it enforces:
  EDT-4  the change set is field-by-field and limited to summary, description, labels, parent and
         links; a proposed change to any other field is refused.
  EDT-6  conflict detection (AC-31): when --live is given and the live ticket's last_updated is
         newer than the snapshot's last_updated, a conflict is flagged and the whole change set is
         withheld until the user decides.
  EDT-7  rich-content guard (AC-32): when the CURRENT (snapshot) description holds images, panels,
         mentions or merged-cell tables, the tool never emits a Markdown "replace" on description;
         it emits "append_section" or "append_comment" instead and the op itself reports which.
  EDT-8  a split (AC-33): new child tickets are carried as new_children, each linked under the same
         epic, and the original ticket is kept (no change entry removes it).
  EDT-5  a digest-bound approval basis (AC-34): change_set.digest is canonical.digest over the
         change set with its own digest field excluded, so any later edit to the set voids approval.
  EDT-9  never emits a delete or a close; the only ops are replace, append_section, append_comment.

Rich-content heuristics (documented so a reviewer can audit them). The current description is
scanned for, in both Markdown and Jira/ADF forms:
  - image: Markdown "![" , Jira "!name.ext!" , or an ADF media marker ("type":"media...").
  - panel: Jira "{panel" , an ADF panel marker ("type":"panel") , or a ":::" fenced block.
  - mention: Jira "[~" , an ADF mention marker ("type":"mention") , or an "@" name.
  - merged-cell table: a "colspan" or "rowspan" attribute (HTML or ADF table cell).
Any hit means the description is rich and must not be replaced with Markdown.

Standard library only (Python 3.9+). No network. Read-only: writes nothing outside stdout.

CLI:
  diff_ticket.py --snapshot <snapshot.json> --proposed <proposed.json> [--live <live.json>]

snapshot.json: {"key", "fields": {"summary","description","labels":[],"parent","links":[]},
                "last_updated": ISO8601}
proposed.json: {"ticket_key", "fields": {<subset of the five fields>}, "new_children": [
                {"title","parent_epic","link_to"}], "description_mode": "section"|"comment"}
live.json:     {"last_updated": ISO8601, ...}

stdout: {"ok", "conflict", "change_set": {"ticket_key", "changes": [{"field","before","after",
         "op"}], "new_children": [...], "digest"}, "issues": [...]}
Exit 0 on a clean, conflict-free change set; 1 on a conflict or an error.
"""

import argparse
import json
import re
import sys
from pathlib import Path

import canonical

ALLOWED_FIELDS = ("summary", "description", "labels", "parent", "links")
ALLOWED_OPS = ("replace", "append_section", "append_comment")

IMAGE = re.compile(r"!\[|!\S+\.(?:png|jpe?g|gif|svg|bmp|webp)!|\"type\"\s*:\s*\"media", re.I)
PANEL = re.compile(r"\{panel|\"type\"\s*:\s*\"panel\"|^\s*:::", re.M)
MENTION = re.compile(r"\[~|\"type\"\s*:\s*\"mention\"|(?<![\w/])@[A-Za-z]")
MERGED_CELL = re.compile(r"\b(?:colspan|rowspan)\b", re.I)

RICH_MARKERS = (("image", IMAGE), ("panel", PANEL),
                ("mention", MENTION), ("merged_cell_table", MERGED_CELL))


def rich_markers(description):
    """Return the list of rich-content marker names found in the description text."""
    text = description if isinstance(description, str) else json.dumps(description or "")
    return [name for name, pattern in RICH_MARKERS if pattern.search(text)]


def _norm(value):
    """A comparable form for equality: lists compare order-insensitively, others by value."""
    if isinstance(value, list):
        return sorted(json.dumps(item, sort_keys=True) for item in value)
    return value


def build_change_set(snapshot, proposed):
    """Return (change_set, issues). change_set is None only when a proposed field is illegal."""
    issues = []
    snap_fields = snapshot.get("fields", {}) or {}
    proposed_fields = proposed.get("fields", {}) or {}
    ticket_key = proposed.get("ticket_key") or snapshot.get("key")

    illegal = [name for name in proposed_fields if name not in ALLOWED_FIELDS]
    for name in illegal:
        issues.append(canonical.issue(
            "FIELD_NOT_ALLOWED", name,
            "Proposed change to a field outside summary, description, labels, parent, links."))
    if illegal:
        return None, issues

    description_mode = proposed.get("description_mode", "section")
    rich = rich_markers(snap_fields.get("description"))

    changes = []
    for field in ALLOWED_FIELDS:
        if field not in proposed_fields:
            continue
        before = snap_fields.get(field)
        after = proposed_fields[field]
        if _norm(before) == _norm(after):
            continue  # no real change, nothing to emit
        op = "replace"
        if field == "description" and rich:
            op = "append_comment" if description_mode == "comment" else "append_section"
            issues.append(canonical.issue(
                "RICH_CONTENT_GUARD", "description",
                "Current description holds rich content ({0}); emitting {1} rather than a "
                "Markdown replace.".format(", ".join(rich), op)))
        changes.append({"field": field, "before": before, "after": after, "op": op})

    new_children = []
    for child in proposed.get("new_children", []) or []:
        new_children.append({
            "title": child.get("title"),
            "parent_epic": child.get("parent_epic"),
            "link_to": child.get("link_to"),
        })

    change_set = {
        "ticket_key": ticket_key,
        "changes": changes,
        "new_children": new_children,
        "digest": "",
    }
    change_set["digest"] = canonical.digest(
        {k: v for k, v in change_set.items() if k != "digest"})
    return change_set, issues


def detect_conflict(snapshot, live):
    """True when the live ticket's last_updated is strictly newer than the snapshot's (EDT-6)."""
    if not live:
        return False
    snap_time = snapshot.get("last_updated")
    live_time = live.get("last_updated")
    if not snap_time or not live_time:
        return False
    return str(live_time) > str(snap_time)


def run(snapshot, proposed, live=None):
    """Return (result_dict, exit_code)."""
    if detect_conflict(snapshot, live):
        issue = canonical.issue(
            "CONFLICT", snapshot.get("key", ""),
            "The live ticket was updated after the refine snapshot; withholding the change set "
            "until the user decides.")
        return {"ok": False, "conflict": True, "change_set": None, "issues": [issue]}, 1

    change_set, issues = build_change_set(snapshot, proposed)
    if change_set is None:
        return {"ok": False, "conflict": False, "change_set": None, "issues": issues}, 1
    return {"ok": True, "conflict": False, "change_set": change_set, "issues": issues}, 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="Build a refine change set.")
    parser.add_argument("--snapshot", required=True, type=Path)
    parser.add_argument("--proposed", required=True, type=Path)
    parser.add_argument("--live", type=Path, default=None)
    args = parser.parse_args(argv)

    snapshot = canonical.load(args.snapshot)
    proposed = canonical.load(args.proposed)
    live = canonical.load(args.live) if args.live else None

    result, code = run(snapshot, proposed, live)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return code


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr)
        sys.exit(1)
