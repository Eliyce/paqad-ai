#!/usr/bin/env python3
"""Compare the created or updated issues to the approved work after normalisation (PUB-6, EDT-10).

Reads the approved work and the live issues, normalises each comparable field, and reports
whether the live issues match what was approved. A partial result (some match, some are missing
or differ) is reported as partial, never as done.

Two approved shapes are understood, chosen by content:

1. A post-tickets ticket set (has "epics"): every approved epic and ticket must appear in the
   created issues, and a created issue outside the approved set is flagged EXTRA (PUB-6).

2. A refine change set (has "changes", no "epics"): only the fields the refine changed on the
   edited ticket, plus any declared new children, are checked against the live-after issues; a
   live issue outside the change set is NOT flagged, since re-reading a ticket legitimately
   returns issues the refine never touched (EDT-10).

Normalisation removes whitespace differences, list markers and escaping from body text, folds
labels and links into sets, and reduces the Sources item reference to the run ID plus item
reference.

Standard library only. No network. Read-only.

CLI:
  check_readback.py --approved <ticket-set.json | change-set.json> --created <live-issues.json>

The created issues file is a list of objects. For a ticket set:
  { "ref", "title", "type", "parent" (parent ref), "labels" [..], "links" [{"target": ref}..],
    "sources_ref" (e.g. "DR-20261005-7K2Q / E1-T1"), "body" }
For a change set the live-after issues are read leniently, so the refine snapshot "fields" shape
works too: "ref" or "key"; "summary" or "title"; "description" or "body"; "labels"; "parent";
"links" as plain refs or {"target": ref}; and an optional "comments" [..] used to confirm an
append_comment op.

The change set is the object diff_ticket.py emits:
  { "ticket_key", "changes": [{"field", "before", "after", "op"}], "new_children": [..], "digest" }
where "field" is one of summary, description, labels, parent, links and "op" is one of replace,
append_section, append_comment.

stdout: {"ok", "status" (match | partial | mismatch), "differences": [..]}. Exit 0 on a full
match, 1 otherwise.

Run with --help to print the usage.
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


def _live_field(issue, field):
    """Read one edited-ticket field from either the created-issue or the snapshot shape.

    A live-after issue may be flat (post-tickets created-issue shape: title/body/...) or carry a
    nested "fields" object (the refine snapshot shape: summary/description/...). summary reads from
    "summary" then "title"; description reads from "description" then "body"; the rest share a key.
    """
    src = issue.get("fields") if isinstance(issue.get("fields"), dict) else issue
    if field == "summary":
        return src.get("summary", src.get("title"))
    if field == "description":
        return src.get("description", src.get("body"))
    return src.get(field)


def _link_set(links):
    """Fold links into a normalised ref set, accepting plain refs or {"target": ref} objects."""
    refs = set()
    for link in links or []:
        target = link.get("target") if isinstance(link, dict) else link
        refs.add(norm_ref(target))
    return refs


def _field_landed(issue, field, after, op):
    """True when the live-after issue reflects one approved field change (EDT-10).

    A replace op must match the after-value exactly after normalisation. An append op adds
    content, so the after-text only has to be present: in the body for append_section, and in a
    comment (or the body) for append_comment. labels and links use subset so unrelated values the
    tracker already held do not count as a miss.
    """
    if field == "summary":
        return norm_title(after) == norm_title(_live_field(issue, "summary"))
    if field == "description":
        want = norm_text(after)
        body = norm_text(_live_field(issue, "description"))
        if op == "replace":
            return want == body
        if want and want in body:
            return True
        if op == "append_comment":
            return any(want and want in norm_text(comment)
                       for comment in issue.get("comments", []) or [])
        return False
    if field == "labels":
        return set(after or []).issubset(set(_live_field(issue, "labels") or []))
    if field == "parent":
        return norm_ref(after) == norm_ref(_live_field(issue, "parent"))
    if field == "links":
        return _link_set(after).issubset(_link_set(_live_field(issue, "links")))
    return False


def _child_present(child, created):
    """True when a live-after issue matches a declared new child by title under its parent epic."""
    title = norm_title(child.get("title"))
    parent = norm_ref(child.get("parent_epic"))
    return any(norm_title(_live_field(issue, "summary")) == title
               and norm_ref(_live_field(issue, "parent")) == parent
               for issue in created)


def compare_change_set(change_set, created):
    """Compare a refine change set to the live-after issues (EDT-10).

    Only the fields the refine changed on the edited ticket, plus any declared new children, are
    checked. A live issue outside the change set is never flagged, since a re-read legitimately
    returns tickets the refine never touched. The match/partial/mismatch rule is the same as the
    ticket-set path.
    """
    actual = {}
    for issue in created:
        ref = issue.get("ref") if issue.get("ref") is not None else issue.get("key")
        if ref is not None:
            actual[norm_ref(ref)] = issue

    differences = []
    matched = 0

    ticket_key = change_set.get("ticket_key")
    edited = actual.get(norm_ref(ticket_key))
    if edited is None:
        differences.append(canonical.issue(
            "MISSING", str(ticket_key or ""), "Edited ticket was not found in the read-back."))
    else:
        field_diffs = [change.get("field") for change in change_set.get("changes", [])
                       if not _field_landed(edited, change.get("field"), change.get("after"),
                                            change.get("op", "replace"))]
        if field_diffs:
            differences.append(canonical.issue(
                "DIFF", str(ticket_key or ""),
                "Changed fields not confirmed after normalisation: " + ", ".join(field_diffs)))
        else:
            matched += 1

    for child in change_set.get("new_children", []) or []:
        if _child_present(child, created):
            matched += 1
        else:
            differences.append(canonical.issue(
                "MISSING", str(child.get("title") or ""),
                "New child ticket was not found in the read-back."))

    if not differences:
        status = "match"
    elif matched > 0:
        status = "partial"
    else:
        status = "mismatch"
    return status, differences


def compare(approved, created):
    """Return (status, differences). status is match, partial or mismatch.

    A change set (carries "changes" and no "epics") is read back field-by-field against the
    edited ticket (EDT-10); every other shape is the post-tickets ticket set (PUB-6).
    """
    if isinstance(approved, dict) and "changes" in approved and "epics" not in approved:
        return compare_change_set(approved, created)
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
