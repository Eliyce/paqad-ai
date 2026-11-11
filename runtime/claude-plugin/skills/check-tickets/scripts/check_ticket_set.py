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
  * the depends_on graph has no dependency cycle (depth-first, adapted from 0.2.0 ticket_errors);
  * an epic with existing_key (an epic that already exists in the tracker and is never changed)
    carries a tracker key, an empty body and no labels, shares its key with no other epic, and is
    free of the title length limit and the duplicate title check, because its title is the live
    title as read;
  * with --record, the existing_key values match the epic choice recorded in the decisions block,
    in epic order, so a redraft cannot drop or change the chosen epic.

Standard library only. No network. Read-only.

CLI:
  check_ticket_set.py --ticket-set <ticket-set.json> [--record <record.json>]

stdout: {"ok", "issues"}. Exit 0 clean, 1 on any failure.

Run with --help to print the usage.
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
EPIC_ALLOWED = {"ref", "title", "body_markdown", "labels", "tickets", "existing_key"}
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


def _is_existing(epic):
    """True when the epic entry names an epic that already exists in the tracker."""
    return "existing_key" in epic


def _existing_epic_errors(epic, path):
    """Return the shape errors of an epic with existing_key: a tracker key, the live title, an empty
    body and no labels. The title length limit does not apply, the text is not ours."""
    errors = []
    key = epic.get("existing_key")
    if not (isinstance(key, str) and canonical.TRACKER_REF.match(key)):
        errors.append(canonical.issue(
            "BAD_EXISTING_KEY", path + ".existing_key",
            "existing_key is not a tracker key: {0!r}.".format(key)))
    if not canonical.text(epic.get("title")):
        errors.append(canonical.issue("SCHEMA", path + ".title", "Nonempty text required."))
    if epic.get("body_markdown") != "":
        errors.append(canonical.issue(
            "EXISTING_EPIC_BODY", path + ".body_markdown",
            "An existing epic is never rewritten: body_markdown must be the empty string."))
    if epic.get("labels") != []:
        errors.append(canonical.issue(
            "EXISTING_EPIC_LABELS", path + ".labels",
            "An existing epic is never labelled: labels must be an empty list."))
    return errors


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
        if _is_existing(epic):
            if not canonical.text(epic.get("ref")):
                errors.append(canonical.issue("SCHEMA", p + ".ref", "Nonempty text required."))
            errors.extend(_bad_ref(epic.get("ref"), EPIC_REF, p))
            errors.extend(_existing_epic_errors(epic, p))
        else:
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

    # Two epic entries may not name the same existing epic.
    seen_keys = set()
    for epic in epics:
        if not _is_existing(epic):
            continue
        key = epic.get("existing_key")
        if key in seen_keys:
            errors.append(canonical.issue(
                "DUPLICATE_EXISTING_KEY", "epics[{0}].existing_key".format(epic.get("ref")),
                "Two epics name the same existing epic: {0}.".format(key)))
        seen_keys.add(key)

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

    # Duplicate titles across the whole set (epics and tickets). The live title of an existing epic
    # is not ours, so it is left out.
    titles = {}
    for epic in epics:
        own = [] if _is_existing(epic) else [("epics[{0}]".format(epic.get("ref")), epic)]
        for label, item in own + [
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


def recorded_epic_choice(record):
    """Return the epic choice list held in the record's decisions block, or an empty list. The block
    is a list of decisions, one of which carries epic_choice; an object form is read the same way."""
    decisions = record.get("decisions") if isinstance(record, dict) else None
    holders = decisions if isinstance(decisions, list) else [decisions]
    for holder in holders:
        if isinstance(holder, dict) and isinstance(holder.get("epic_choice"), list):
            return holder["epic_choice"]
    return []


def epic_choice_errors(ticket_set, record):
    """Return an EPIC_CHOICE_MISMATCH issue when the existing_key values of the set, in epic order,
    are not the existing keys of the recorded epic choice. A missing choice counts as a new epic."""
    chosen = [choice.get("key") if isinstance(choice, dict) and choice.get("mode") == "existing"
              else None for choice in recorded_epic_choice(record)]
    drafted = [epic.get("existing_key") for epic in ticket_set.get("epics", [])]
    width = max(len(chosen), len(drafted))
    chosen += [None] * (width - len(chosen))
    drafted += [None] * (width - len(drafted))
    errors = []
    for index, (want, have) in enumerate(zip(chosen, drafted)):
        if want != have:
            errors.append(canonical.issue(
                "EPIC_CHOICE_MISMATCH", "epics[{0}].existing_key".format(index),
                "The set does not match the recorded epic choice: expected {0}, found {1}.".format(
                    want or "a new epic", have or "a new epic")))
    return errors


def check(ticket_set, record=None):
    errors = shape_errors(ticket_set)
    if errors:
        return errors
    errors.extend(digest_errors(ticket_set))
    errors.extend(structure_errors(ticket_set))
    if record is not None:
        errors.extend(epic_choice_errors(ticket_set, record))
    return errors


def main(argv=None):
    parser = argparse.ArgumentParser(description="Validate a canonical ticket set.")
    parser.add_argument("--ticket-set", required=True, type=Path)
    parser.add_argument("--record", type=Path,
                        help="The discovery record, to compare the set with the recorded epic choice.")
    args = parser.parse_args(argv)
    ticket_set = canonical.load(args.ticket_set)
    record = canonical.load(args.record) if args.record else None
    return canonical.result(check(ticket_set, record))


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, TypeError) as error:
        print('{"ok": false, "error": ' + repr(str(error)) + "}", file=sys.stderr)
        sys.exit(1)
