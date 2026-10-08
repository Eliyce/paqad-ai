#!/usr/bin/env python3
"""Validate a canonical ticket set against the section 8.3 shape and the structural rules.

Checks, in order:

  * the object matches the 8.3 shape fixed by ticket-set.schema.json (hand-validated, since the
    stdlib has no JSON-Schema validator): required fields, a closed property set (no extra
    properties), the epic and ticket ref patterns, and the title length limit;
  * the digest is current: sha256 of the canonical JSON of the whole object with the digest field
    removed, compared to the stored digest (a mismatch is a stale digest);
  * every epic has at least one ticket;
  * every ticket belongs to exactly one epic (no ticket ref appears under two epics);
  * every done_when list holds 2 to 8 statements;
  * no title is duplicated across the set;
  * every depends_on points at a ticket ref that exists in the set, OR at an external tracker issue
    (e.g. PROJ-123, resolved through canonical.is_external_ref) which is a valid dependency;
  * the depends_on graph has no dependency cycle (depth-first, adapted from 0.2.0 ticket_errors).

Standard library only. No network. Read-only.

CLI:
  check_ticket_set.py --ticket-set <ticket-set.json>

stdout: {"ok", "issues"}. Exit 0 clean, 1 on any failure.
"""

import argparse
import re
import sys
from pathlib import Path

import canonical

TRACKER_KEYS = ("kind", "project_key", "epic_type", "story_type")

# The ticket-set.schema.json shape, hand-validated here (the stdlib has no JSON-Schema validator).
TITLE_MAX = 80
EPIC_REF = re.compile(r"^E[0-9]+$")
TICKET_REF = re.compile(r"^E[0-9]+-T[0-9]+$")
TOP_LEVEL_KEYS = {"run_id", "revision", "digest", "tracker", "epics"}
TRACKER_ALLOWED = {"kind", "project_key", "epic_type", "story_type"}
EPIC_ALLOWED = {"ref", "title", "body_markdown", "labels", "tickets"}
TICKET_ALLOWED = {"ref", "title", "body_markdown", "done_when", "depends_on", "assignee_hint"}


def _extra_props(obj, allowed, path):
    """Return an EXTRA_PROPERTY issue for each key not in the schema's allowed set (closed shape)."""
    return [canonical.issue("EXTRA_PROPERTY", "{0}.{1}".format(path, key),
                            "Unexpected property not in the ticket-set shape: {0}.".format(key))
            for key in sorted(set(obj) - allowed)]


def _title_too_long(title, path):
    """Return a TITLE_TOO_LONG issue when the title is over the schema maximum."""
    if isinstance(title, str) and len(title) > TITLE_MAX:
        return [canonical.issue("TITLE_TOO_LONG", path + ".title",
                                "Title is over {0} characters.".format(TITLE_MAX))]
    return []


def _bad_ref(ref, pattern, path):
    """Return a BAD_REF issue when the ref does not match its schema pattern."""
    if not (isinstance(ref, str) and pattern.match(ref)):
        return [canonical.issue("BAD_REF", path + ".ref",
                                "Ref does not match the required pattern: {0!r}.".format(ref))]
    return []


def shape_errors(ticket_set):
    """Return structural errors against the 8.3 shape. Stops the deeper checks when the top-level
    shape is wrong so later checks can assume the containers exist."""
    errors = []
    if not isinstance(ticket_set, dict):
        return [canonical.issue("SCHEMA", "$", "Ticket set must be a JSON object.")]
    errors.extend(_extra_props(ticket_set, TOP_LEVEL_KEYS, "$"))
    if not canonical.text(ticket_set.get("run_id")):
        errors.append(canonical.issue("SCHEMA", "run_id", "Nonempty run_id required."))
    if not isinstance(ticket_set.get("revision"), int) or isinstance(ticket_set.get("revision"), bool):
        errors.append(canonical.issue("SCHEMA", "revision", "Integer revision required."))
    if not canonical.text(ticket_set.get("digest")):
        errors.append(canonical.issue("SCHEMA", "digest", "Nonempty digest required."))
    tracker = ticket_set.get("tracker")
    if not isinstance(tracker, dict):
        errors.append(canonical.issue("SCHEMA", "tracker", "Expected a tracker object."))
    else:
        errors.extend(_extra_props(tracker, TRACKER_ALLOWED, "tracker"))
        for key in TRACKER_KEYS:
            if not canonical.text(tracker.get(key)):
                errors.append(canonical.issue("SCHEMA", "tracker." + key, "Nonempty text required."))
    epics = ticket_set.get("epics")
    if not isinstance(epics, list) or not epics:
        errors.append(canonical.issue("SCHEMA", "epics", "Expected a nonempty list of epics."))
        return errors
    for i, epic in enumerate(epics):
        p = "epics[{0}]".format(i)
        if not isinstance(epic, dict):
            errors.append(canonical.issue("SCHEMA", p, "Expected an epic object."))
            continue
        errors.extend(_extra_props(epic, EPIC_ALLOWED, p))
        for key in ("ref", "title", "body_markdown"):
            if not canonical.text(epic.get(key)):
                errors.append(canonical.issue("SCHEMA", p + "." + key, "Nonempty text required."))
        errors.extend(_bad_ref(epic.get("ref"), EPIC_REF, p))
        errors.extend(_title_too_long(epic.get("title"), p))
        if not isinstance(epic.get("labels"), list):
            errors.append(canonical.issue("SCHEMA", p + ".labels", "Expected a list of labels."))
        tickets = epic.get("tickets")
        if not isinstance(tickets, list):
            errors.append(canonical.issue("SCHEMA", p + ".tickets", "Expected a list of tickets."))
            continue
        for j, ticket in enumerate(tickets):
            tp = "{0}.tickets[{1}]".format(p, j)
            if not isinstance(ticket, dict):
                errors.append(canonical.issue("SCHEMA", tp, "Expected a ticket object."))
                continue
            errors.extend(_extra_props(ticket, TICKET_ALLOWED, tp))
            for key in ("ref", "title", "body_markdown"):
                if not canonical.text(ticket.get(key)):
                    errors.append(canonical.issue("SCHEMA", tp + "." + key, "Nonempty text required."))
            errors.extend(_bad_ref(ticket.get("ref"), TICKET_REF, tp))
            errors.extend(_title_too_long(ticket.get("title"), tp))
            if not isinstance(ticket.get("done_when"), list):
                errors.append(canonical.issue("SCHEMA", tp + ".done_when", "Expected a list."))
            if not isinstance(ticket.get("depends_on"), list):
                errors.append(canonical.issue("SCHEMA", tp + ".depends_on", "Expected a list."))
            if "assignee_hint" not in ticket:
                errors.append(canonical.issue("SCHEMA", tp + ".assignee_hint",
                                              "assignee_hint is required (string or null)."))
    return errors


def digest_errors(ticket_set):
    stored = ticket_set.get("digest")
    recomputed = canonical.digest({k: v for k, v in ticket_set.items() if k != "digest"})
    if stored != recomputed:
        return [canonical.issue(
            "STALE_DIGEST", "digest",
            "Digest does not match the ticket set. Recompute it after any edit.")]
    return []


def structure_errors(ticket_set):
    errors = []
    epics = ticket_set.get("epics", [])

    # Collect tickets and detect a ticket ref under two epics.
    ticket_refs = []
    ticket_owner = {}
    for epic in epics:
        epic_ref = epic.get("ref")
        tickets = epic.get("tickets", [])
        if not tickets:
            errors.append(canonical.issue(
                "EMPTY_EPIC", "epics[{0}]".format(epic_ref),
                "An epic must hold at least one ticket."))
        for ticket in tickets:
            ref = ticket.get("ref")
            ticket_refs.append(ref)
            if ref in ticket_owner and ticket_owner[ref] != epic_ref:
                errors.append(canonical.issue(
                    "TWO_EPICS", "tickets[{0}]".format(ref),
                    "A ticket belongs to exactly one epic; this ref appears under two."))
            ticket_owner.setdefault(ref, epic_ref)

    known_refs = set(r for r in ticket_refs if r is not None)

    # done_when length and depends_on targets.
    graph = {}
    for epic in epics:
        for ticket in epic.get("tickets", []):
            ref = ticket.get("ref")
            done_when = ticket.get("done_when", [])
            if not isinstance(done_when, list) or not 2 <= len(done_when) <= 8:
                errors.append(canonical.issue(
                    "DONE_WHEN", "tickets[{0}].done_when".format(ref),
                    "done_when must hold 2 to 8 checkable statements."))
            deps = ticket.get("depends_on", []) or []
            graph[ref] = [d for d in deps if isinstance(d, str)]
            for dep in deps:
                if dep not in known_refs and not canonical.is_external_ref(dep):
                    errors.append(canonical.issue(
                        "DANGLING_DEPENDENCY", "tickets[{0}].depends_on".format(ref),
                        "depends_on points at an unknown ticket: {0}.".format(dep)))

    # Duplicate titles across the whole set (epics and tickets).
    titles = {}
    for epic in epics:
        for label, item in [("epics[{0}]".format(epic.get("ref")), epic)] + [
                ("tickets[{0}]".format(t.get("ref")), t) for t in epic.get("tickets", [])]:
            title = item.get("title")
            if isinstance(title, str):
                titles.setdefault(title.strip(), []).append(label)
    for title, where in titles.items():
        if len(where) > 1:
            errors.append(canonical.issue(
                "DUPLICATE_TITLE", where[1],
                "Title is duplicated across the set: {0}.".format(title)))

    # Dependency cycle (depth-first), only over edges to known refs.
    def visit(node, chain):
        if node in chain:
            return True
        return any(visit(dep, chain | {node})
                   for dep in graph.get(node, []) if dep in graph)

    if any(visit(node, set()) for node in graph):
        errors.append(canonical.issue(
            "DEPENDENCY_CYCLE", "tickets", "depends_on forms a cycle."))
    return errors


def check(ticket_set):
    errors = shape_errors(ticket_set)
    if errors:
        return errors
    errors.extend(digest_errors(ticket_set))
    errors.extend(structure_errors(ticket_set))
    return errors


def main(argv=None):
    parser = argparse.ArgumentParser(description="Validate a canonical ticket set.")
    parser.add_argument("--ticket-set", required=True, type=Path)
    args = parser.parse_args(argv)
    ticket_set = canonical.load(args.ticket_set)
    return canonical.result(check(ticket_set))


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, TypeError) as error:
        print('{"ok": false, "error": ' + repr(str(error)) + "}", file=sys.stderr)
        sys.exit(1)
