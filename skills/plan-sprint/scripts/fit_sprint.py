#!/usr/bin/env python3
"""Plan a sprint from capacity and readiness, then apply the sprint field to the chosen set only.

Two subcommands:

  plan   Finds the target future sprint from the sprint field (SPR-1), derives capacity from the
         last three completed sprints and shows it as derived with its numbers (SPR-2, AC-38),
         applies the readiness filter (SPR-3: ready = passes its checks, has a size, and every
         dependency is done or already in the sprint; an unready candidate is listed with what it
         needs, AC-39), and proposes a goal, the fitting tickets in priority order within capacity,
         stretch, left-out-with-reasons, total-versus-capacity and risks (SPR-4). When no future
         sprint exists it reports that and creates nothing (AC-41). When the sprint field cannot be
         set it returns the plan as a by-hand list with by_hand true (U-14). The plan carries a
         canonical digest so apply can bind to it.

  apply  Given an approved plan and the expected digest, recomputes the plan digest and refuses on
         a mismatch. On a match it sets the sprint field on the CHOSEN tickets only (SPR-6, AC-40)
         and prepares a read-back (reusing check_readback's ref normalisation) that confirms each
         chosen ticket now carries the sprint field. It enforces the SPR-7 limits: it never creates,
         starts, closes, renames or reorders a sprint, and never reorders the backlog -- the only
         operation it emits is "set the sprint field" on a chosen ticket.

Standard library only (Python 3.9+). No network. Writes nothing outside stdout.

CLI:
  fit_sprint.py plan --sprint-field <id> --candidates <candidates.json>
                     --history <last-three-sprints.json> [--target-sprint <sprint>]
  fit_sprint.py apply --plan <plan.json> --expect-digest <d>

candidates.json: {"sprints": [{"id","state":"future"|..., "settable": bool}],
                  "candidates": [{"ref","priority","size","checks_pass": bool,
                                  "dependencies": [{"ref","done": bool,"in_sprint": bool}]}]}
history.json:    {"sprints": [{"id","delivered": <number>} x3]}

plan stdout:  {"ok","sprint","capacity":{"value","derived_from":[{"sprint","count"}]},"goal",
               "fitting":[refs],"stretch":[refs],"left_out":[{"ref","reason"}],"total","risks":[...],
               "not_ready":[{"ref","needs"}],"by_hand": bool,"digest"}
apply stdout: {"ok","applied":[refs],"read_back":{...}}
Exit 0 on a clean plan or apply; 1 on no future sprint, a digest mismatch, or an error.
"""

import argparse
import json
import sys
from pathlib import Path

import canonical
import check_readback

STRETCH_FACTOR = 1.25
FUTURE_STATES = ("future", "planned", "upcoming")


def find_target_sprint(sprints, target_sprint=None):
    """Return the target future sprint object, or None when no future sprint exists (AC-41)."""
    future = [s for s in sprints if str(s.get("state", "")).lower() in FUTURE_STATES]
    if target_sprint:
        for sprint in future:
            if sprint.get("id") == target_sprint:
                return sprint
        return None
    return future[0] if future else None


def derive_capacity(history):
    """Derive capacity from the last three completed sprints, shown as derived (SPR-2)."""
    sprints = (history.get("sprints") if isinstance(history, dict) else history) or []
    last_three = sprints[-3:]
    derived_from = [{"sprint": s.get("id"), "count": s.get("delivered", 0)} for s in last_three]
    counts = [s.get("delivered", 0) for s in last_three]
    value = round(sum(counts) / len(counts)) if counts else 0
    return {"value": value, "derived_from": derived_from}


def readiness(candidate, target_sprint_id):
    """Return (ready, needs). ready requires passing checks, a size and resolved deps (SPR-3)."""
    needs = []
    if not candidate.get("checks_pass", False):
        needs.append("its checks to pass")
    size = candidate.get("size")
    if size in (None, "", 0):
        needs.append("a size")
    for dep in candidate.get("dependencies", []) or []:
        done = dep.get("done", False)
        in_sprint = dep.get("in_sprint", False) or dep.get("ref") == target_sprint_id
        if not (done or in_sprint):
            needs.append("dependency {0} done or in the sprint".format(dep.get("ref")))
    return (not needs), needs


def build_plan(sprint_field, candidates_doc, history, target_sprint=None):
    """Return (plan_dict, exit_code). plan_dict is None with code 1 when no future sprint exists."""
    sprints = candidates_doc.get("sprints", []) or []
    target = find_target_sprint(sprints, target_sprint)
    if target is None:
        plan = {
            "ok": False,
            "sprint": None,
            "reason": "No future sprint exists. A sprint is created by the team in the tracker; "
                      "this tool plans into an existing future sprint and creates nothing.",
            "created": [],
        }
        return plan, 1

    sprint_id = target.get("id")
    settable = target.get("settable", True) and bool(sprint_field)
    capacity = derive_capacity(history)
    cap_value = capacity["value"]

    candidates = candidates_doc.get("candidates", []) or []
    ready, not_ready = [], []
    for cand in candidates:
        is_ready, needs = readiness(cand, sprint_id)
        if is_ready:
            ready.append(cand)
        else:
            not_ready.append({"ref": cand.get("ref"), "needs": needs})

    ready.sort(key=lambda c: (c.get("priority", 1_000_000), str(c.get("ref"))))

    fitting, stretch, left_out = [], [], []
    running = 0
    for cand in ready:
        size = cand.get("size") or 0
        if running + size <= cap_value:
            fitting.append(cand.get("ref"))
            running += size
        elif running + size <= cap_value * STRETCH_FACTOR:
            stretch.append(cand.get("ref"))
        else:
            left_out.append({"ref": cand.get("ref"),
                             "reason": "Beyond the sprint capacity of {0}.".format(cap_value)})

    goal = ("Deliver the top {0} ready item(s) for {1} within a capacity of {2}."
            .format(len(fitting), sprint_id, cap_value)) if fitting else \
           "No ready item fits {0}; capacity is {1}.".format(sprint_id, cap_value)

    risks = []
    if len(capacity["derived_from"]) < 3:
        risks.append("Capacity is derived from fewer than three completed sprints.")
    if not_ready:
        risks.append("{0} candidate(s) are not ready and were excluded.".format(len(not_ready)))
    if stretch:
        risks.append("{0} stretch item(s) only fit if the sprint runs ahead.".format(len(stretch)))
    if not risks:
        risks.append("No capacity or readiness risks detected.")

    plan = {
        "ok": True,
        "sprint": sprint_id,
        "capacity": capacity,
        "goal": goal,
        "fitting": fitting,
        "stretch": stretch,
        "left_out": left_out,
        "total": running,
        "risks": risks,
        "not_ready": not_ready,
        "by_hand": not settable,
        "digest": "",
    }
    plan["digest"] = plan_digest(plan)
    return plan, 0


def plan_digest(plan):
    """canonical.digest over the plan with its ok, reason and digest fields excluded."""
    body = {k: v for k, v in plan.items() if k not in ("digest", "ok")}
    return canonical.digest(body)


def apply_plan(plan, expect_digest, tracker_state=None):
    """Set the sprint field on the chosen tickets only, bound to the plan digest (SPR-6, AC-40)."""
    actual = plan_digest(plan)
    if actual != expect_digest:
        return {
            "ok": False,
            "error": "The plan digest does not match the approved digest; refusing to apply.",
            "expected": expect_digest,
            "actual": actual,
            "applied": [],
        }, 1

    chosen = list(plan.get("fitting", []))
    # SPR-7: the ONLY operation emitted is a sprint-field set on a chosen ticket.
    operations = [{"op": "set_sprint_field", "ref": ref, "sprint": plan.get("sprint")}
                  for ref in chosen]

    # Read-back: confirm every chosen ticket now carries the sprint field, reusing the shared
    # ref normalisation so comparison matches post-tickets' read-back semantics.
    state = tracker_state or {}
    set_refs = {check_readback.norm_ref(ref)
                for ref, value in state.items() if value == plan.get("sprint")}
    confirmed, missing = [], []
    for ref in chosen:
        (confirmed if check_readback.norm_ref(ref) in set_refs else missing).append(ref)
    status = "match" if (chosen and not missing) else ("partial" if confirmed else "mismatch")
    read_back = {"status": status, "confirmed": confirmed, "missing": missing}

    return {"ok": True, "applied": chosen, "operations": operations,
            "read_back": read_back}, 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="Plan or apply a sprint fit.")
    sub = parser.add_subparsers(dest="command", required=True)

    pp = sub.add_parser("plan", help="Plan a sprint fit.")
    pp.add_argument("--sprint-field", required=True)
    pp.add_argument("--candidates", required=True, type=Path)
    pp.add_argument("--history", required=True, type=Path)
    pp.add_argument("--target-sprint", default=None)

    ap = sub.add_parser("apply", help="Apply an approved plan.")
    ap.add_argument("--plan", required=True, type=Path)
    ap.add_argument("--expect-digest", required=True)
    ap.add_argument("--tracker-state", type=Path, default=None)

    args = parser.parse_args(argv)

    if args.command == "plan":
        candidates_doc = canonical.load(args.candidates)
        history = canonical.load(args.history)
        plan, code = build_plan(args.sprint_field, candidates_doc, history, args.target_sprint)
        print(json.dumps(plan, indent=2, ensure_ascii=False))
        return code

    plan = canonical.load(args.plan)
    tracker_state = canonical.load(args.tracker_state) if args.tracker_state else None
    result, code = apply_plan(plan, args.expect_digest, tracker_state)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return code


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr)
        sys.exit(1)
