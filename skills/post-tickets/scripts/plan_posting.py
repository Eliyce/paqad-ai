#!/usr/bin/env python3
"""Plan and receipt the tracker posting run (PUB-2 to PUB-6). Does not post anything itself.

Builds the ordered operation plan and runs the receipt lifecycle. The host executes each returned
operation against the connector; this script only plans the order, binds approval to the digest,
and records what happened so a lost reply never creates a duplicate and an uncertain write never
retries on its own.

Order (PUB-3): epics first, then each epic's tickets with the created epic as parent, then the
dependency links, then read-back. A child's parent and every link target is a result reference
({"$result": {"operation": <op id>, "path": ["key"]}}) resolved from the referenced create's
verified receipt.

Receipt lifecycle (PUB-5): an operation is claimed in_flight before any write; a reply records it
created and writes the issue key into the posted block; a lost reply records it uncertain and
stops dependent writes; reconcile searches by run label plus item reference and records created if
found, or asks the user (no automatic retry) if not. A created issue is never deleted as a
rollback and a created receipt is never reset to retry.

The link action name is resolved from what the connector exposes: createJiraIssueLink or
createIssueLink, whichever is present (AC-18).

Standard library only. No network.

CLI (over a --state JSON file holding ticket_set, setup, connector, approval, receipts, posted):
  plan_posting.py plan      --state <state.json>
  plan_posting.py next      --state <state.json>
  plan_posting.py claim     --state <state.json>
  plan_posting.py record    --state <state.json> --operation <id> --receipt <receipt.json>
  plan_posting.py reconcile --state <state.json> --operation <id> [--tracker-issues <found.json>]
"""

import argparse
import json
import sys
from pathlib import Path

import canonical

SHARED_LABEL = "paqad-discovery"
SUCCESS = "created"


def current_digest(ticket_set):
    """The digest the approval and plan are bound to: canonical JSON without the digest field."""
    return canonical.digest({k: v for k, v in ticket_set.items() if k != "digest"})


def resolve_link_action(connector):
    """Return the link action the connector exposes (AC-18)."""
    actions = (connector or {}).get("actions", []) or []
    if "createJiraIssueLink" in actions:
        return "createJiraIssueLink"
    if "createIssueLink" in actions:
        return "createIssueLink"
    # Default to the stable name when the connector did not advertise its actions.
    return "createIssueLink"


def _labels(base, run_label):
    labels = list(base or [])
    for extra in (SHARED_LABEL, run_label):
        if extra and extra not in labels:
            labels.append(extra)
    return labels


def _result_ref(op_id):
    return {"$result": {"operation": op_id, "path": ["key"]}}


def build_plan(ticket_set, setup, connector):
    """Return the ordered operation plan bound to the current ticket-set digest."""
    tracker = ticket_set.get("tracker", {})
    project = tracker.get("project_key")
    epic_type = tracker.get("epic_type")
    story_type = tracker.get("story_type")
    run_label = (setup or {}).get("run_label")
    link_action = resolve_link_action(connector)

    operations = []
    epic_op = {}
    ticket_op = {}
    created_refs = []

    # Epics first.
    for epic in ticket_set.get("epics", []):
        op_id = "create-" + epic["ref"]
        epic_op[epic["ref"]] = op_id
        created_refs.append(op_id)
        operations.append({
            "id": op_id,
            "action": "createIssue",
            "kind": "epic",
            "item_ref": epic["ref"],
            "arguments": {
                "project": project,
                "issuetype": epic_type,
                "summary": epic["title"],
                "description": epic.get("body_markdown", ""),
                "labels": _labels(epic.get("labels"), run_label),
            },
        })

    # Then each epic's tickets, parented to the created epic.
    for epic in ticket_set.get("epics", []):
        for ticket in epic.get("tickets", []):
            op_id = "create-" + ticket["ref"]
            ticket_op[ticket["ref"]] = op_id
            created_refs.append(op_id)
            operations.append({
                "id": op_id,
                "action": "createIssue",
                "kind": "story",
                "item_ref": ticket["ref"],
                "arguments": {
                    "project": project,
                    "issuetype": story_type,
                    "summary": ticket["title"],
                    "description": ticket.get("body_markdown", ""),
                    "labels": _labels([], run_label),
                    "parent": _result_ref(epic_op[epic["ref"]]),
                },
            })

    # Then the dependency links (last before read-back).
    for epic in ticket_set.get("epics", []):
        for ticket in epic.get("tickets", []):
            for dep in ticket.get("depends_on", []) or []:
                if dep not in ticket_op:
                    continue
                op_id = "link-{0}-{1}".format(ticket["ref"], dep)
                operations.append({
                    "id": op_id,
                    "action": link_action,
                    "kind": "link",
                    "item_ref": "{0}->{1}".format(ticket["ref"], dep),
                    "arguments": {
                        "type": "Depends",
                        "inward": _result_ref(ticket_op[ticket["ref"]]),
                        "outward": _result_ref(ticket_op[dep]),
                    },
                })

    # Finally, read-back of every created issue.
    operations.append({
        "id": "read-back",
        "action": "readBack",
        "kind": "read_back",
        "item_ref": "*",
        "arguments": {"keys": [_result_ref(op_id) for op_id in created_refs]},
    })

    return {
        "ticket_digest": current_digest(ticket_set),
        "link_action": link_action,
        "operations": operations,
    }


def plan_digest(plan):
    return canonical.digest({"ticket_digest": plan.get("ticket_digest"),
                             "operations": plan.get("operations")})


def resolve(value, receipts):
    """Resolve result references against verified success receipts (0.2.0 resolve, ported)."""
    if isinstance(value, dict) and set(value) == {"$result"}:
        ref = value["$result"]
        receipt = receipts.get(ref["operation"], {})
        if receipt.get("status") != SUCCESS:
            raise ValueError(
                "Result reference to an operation without a verified success receipt: "
                + str(ref["operation"]))
        resolved = receipt.get("result", {})
        for part in ref["path"]:
            resolved = resolved[part]
        if isinstance(resolved, (dict, list)):
            raise ValueError("Result references must resolve to a scalar identifier.")
        return resolved
    if isinstance(value, dict):
        return {k: resolve(v, receipts) for k, v in value.items()}
    if isinstance(value, list):
        return [resolve(v, receipts) for v in value]
    return value


def _op(state, op_id):
    for op in state.get("plan", {}).get("operations", []):
        if op["id"] == op_id:
            return op
    raise ValueError("Unknown operation id: " + str(op_id))


def next_operation(state):
    """Return (op, resolved_arguments) for the next operation, enforcing the PUB-5 guards."""
    ticket_set = state["ticket_set"]
    plan = state.get("plan")
    if not plan:
        raise ValueError("No plan yet. Build the plan first.")
    current = current_digest(ticket_set)
    if plan.get("ticket_digest") != current:
        raise ValueError("Stale plan: the ticket set changed since the plan was built.")
    approval = state.get("approval")
    if (not isinstance(approval, dict) or approval.get("digest") != current
            or not canonical.text(approval.get("message_ref"))):
        raise ValueError(
            "No approval bound to the current ticket-set digest. Get an explicit go-ahead.")
    receipts = state.get("receipts", {})
    for op in plan["operations"]:
        status = receipts.get(op["id"], {}).get("status")
        if status in (SUCCESS, "not_applied"):
            continue
        if status in ("in_flight", "uncertain"):
            raise ValueError(
                "Reconcile the pending operation before another write: " + op["id"])
        return op, resolve(op["arguments"], receipts)
    raise ValueError("All operations already completed.")


def claim(state):
    """Return the next operation and mark it in_flight before any write."""
    op, arguments = next_operation(state)
    state.setdefault("receipts", {})[op["id"]] = {
        "status": "in_flight", "recorded_at": canonical.now()}
    return {"id": op["id"], "action": op["action"], "arguments": arguments}


def _write_posted(state, op_id, receipt):
    op = _op(state, op_id)
    if op.get("kind") not in ("epic", "story"):
        return
    key = (receipt.get("result") or {}).get("key")
    posted = state.setdefault("posted", {"issues": [], "read_back": {}})
    issues = posted.setdefault("issues", [])
    for row in issues:
        if row.get("ref") == op.get("item_ref"):
            row["issue_key"] = key
            row["status"] = SUCCESS
            return
    issues.append({"ref": op.get("item_ref"), "issue_key": key, "status": SUCCESS})


def record_receipt(state, op_id, receipt):
    """Record a receipt. created writes the issue key into posted; a created receipt is final."""
    _op(state, op_id)  # validates the id
    status = receipt.get("status")
    if status not in (SUCCESS, "uncertain", "not_applied"):
        raise ValueError("Receipt status must be created, uncertain or not_applied.")
    receipts = state.setdefault("receipts", {})
    previous = receipts.get(op_id, {})
    if previous.get("status") == SUCCESS:
        raise ValueError("A created receipt is never reset to retry: " + op_id)
    if status in (SUCCESS, "uncertain") and previous.get("status") not in ("in_flight", "uncertain"):
        raise ValueError("Claim the operation before recording its result: " + op_id)
    stored = dict(receipt)
    stored["recorded_at"] = canonical.now()
    receipts[op_id] = stored
    if status == SUCCESS:
        _write_posted(state, op_id, stored)
    return stored


def reconcile(state, op_id, tracker_issues=None):
    """Reconcile an uncertain operation by run label plus item reference (PUB-5, AC-11, AC-12)."""
    receipts = state.setdefault("receipts", {})
    previous = receipts.get(op_id, {})
    if previous.get("status") != "uncertain":
        raise ValueError("Reconcile applies only to an uncertain operation: " + str(op_id))
    op = _op(state, op_id)
    run_label = state.get("setup", {}).get("run_label")
    item_ref = op.get("item_ref")
    matches = [issue for issue in (tracker_issues or [])
               if run_label in (issue.get("labels") or [])
               and issue.get("item_ref") == item_ref]
    if matches:
        found_key = matches[0].get("key")
        stored = {
            "status": SUCCESS,
            "result": {"key": found_key},
            "evidence": "Found by run label {0} and item reference {1}.".format(run_label, item_ref),
            "reconciled": True,
            "recorded_at": canonical.now(),
        }
        receipts[op_id] = stored
        _write_posted(state, op_id, stored)
        return {"status": SUCCESS, "issue_key": found_key,
                "item_ref": item_ref, "duplicate_created": False}
    return {
        "status": "ask_user",
        "item_ref": item_ref,
        "retried": False,
        "message": ("No issue found by run label and item reference yet. Jira's search can lag. "
                    "Ask the user before any retry; do not retry automatically."),
    }


def _write_state(path, state):
    Path(path).write_text(json.dumps(state, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Plan and receipt the tracker posting run.")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("plan", "next", "claim", "record", "reconcile"):
        p = sub.add_parser(name)
        p.add_argument("--state", required=True, type=Path)
        if name == "record":
            p.add_argument("--operation", required=True)
            p.add_argument("--receipt", required=True, type=Path)
        if name == "reconcile":
            p.add_argument("--operation", required=True)
            p.add_argument("--tracker-issues", type=Path)
    args = parser.parse_args(argv)

    state = canonical.load(args.state)

    if args.command == "plan":
        state["plan"] = build_plan(state["ticket_set"], state.get("setup", {}),
                                   state.get("connector", {}))
        _write_state(args.state, state)
        print(json.dumps(state["plan"], indent=2, ensure_ascii=False))
        return 0
    if args.command == "next":
        op, arguments = next_operation(state)
        print(json.dumps({"id": op["id"], "action": op["action"], "arguments": arguments},
                         indent=2, ensure_ascii=False))
        return 0
    if args.command == "claim":
        out = claim(state)
        _write_state(args.state, state)
        print(json.dumps(out, indent=2, ensure_ascii=False))
        return 0
    if args.command == "record":
        receipt = canonical.load(args.receipt)
        out = record_receipt(state, args.operation, receipt)
        _write_state(args.state, state)
        print(json.dumps(out, indent=2, ensure_ascii=False))
        return 0
    # reconcile
    tracker_issues = canonical.load(args.tracker_issues) if args.tracker_issues else []
    out = reconcile(state, args.operation, tracker_issues)
    _write_state(args.state, state)
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr)
        sys.exit(1)
