#!/usr/bin/env python3
"""Create, show, update and advance the private discovery record (REC-1).

The discovery record is one JSON object per run. This script writes only to the caller-given
--path inside the working folder: there is no data_root, no PLUGIN_DATA, no lock file and no
history directory (the 0.2.0 writer helpers are dropped, PLG-5, DD-3). It reuses only the two
pure pieces of 0.2.0 logic: the expected-revision refusal and the minimum-affected-block stale
propagation. The invalidation map is the new REC-4 map over the record blocks, not the 0.2.0
STAGES or CONTENT maps (DD-2).

Standard library only. No network.

CLI:
  record.py init --path <record.json> [--run-id <id>] [--mode build]
  record.py show --path <record.json>
  record.py update --path <record.json> --expect-revision <int> --patch <patch.json>
  record.py advance --path <record.json> --expect-revision <int>

stdout: {"revision", "step", "status"} on success. On failure: {"ok": false, "error": <msg>}
to stderr and exit code 1.

Run with --help to print the usage.
"""

import argparse
import json
import random
import sys
from datetime import datetime, timezone
from pathlib import Path

import canonical

# The content blocks a patch may replace. run is managed metadata and is never patched.
# The first group is the S1 build-mode set (unchanged, INV-1). The four trailing blocks are the
# additive S1b existing-work blocks: they are mode-gated, are NOT part of the build-mode CHAIN or
# REQUIRED map, and are only required in their own mode (MODE_REQUIRED below).
BLOCKS = ("setup", "idea", "glossary", "today", "playback", "decisions",
          "assumptions", "outcome", "ticket_set_ref", "readiness", "posted",
          "existing", "changes", "sizing", "sprint_plan")

# The dependency chain (REC-4). When a block changes, every block after it in this order goes
# stale. run, setup, glossary, assumptions and outcome are outside the chain and are kept.
# ticket_set_ref precedes readiness on purpose: the readiness review is a review OF the ticket
# set, so changing the set must redo readiness. The frozen spec's row-wise REC-4 map lists
# "ticket_set_ref -> posted" and "readiness -> posted" separately; this chain reconciles those
# rows and keeps the safe over-invalidation (INV-11) that a ticket_set_ref change also staled
# readiness.
CHAIN = ("idea", "today", "playback", "decisions", "ticket_set_ref", "readiness", "posted")

# The required blocks for each journey step (8.5 Record row). Build mode only (INV-1).
REQUIRED = {
    0: ("setup",),
    1: ("idea",),
    2: ("today",),
    3: ("playback",),
    4: ("decisions", "outcome"),
    5: ("ticket_set_ref", "readiness"),
    6: ("posted",),
}

# The existing-work modes (refine, size, plan) do not walk the build-mode step chain. Each has its
# own ordered required-blocks sequence (S1b Record extension). apply_advance and check_record
# consult REQUIRED in build mode and MODE_REQUIRED in the other modes, keyed off run.mode, so the
# build-mode behaviour is byte-for-byte unchanged (INV-1). The step indexes into the mode sequence:
# in refine mode step 0 requires existing, step 1 requires changes.
MODE_REQUIRED = {
    "refine": ("existing", "changes"),
    "size": ("sizing",),
    "plan": ("sprint_plan",),
}

# Per-mode staleness, kept mode-local so it never touches the build-mode CHAIN. In refine mode
# changes depends on existing: re-snapshotting existing marks changes stale. sizing and sprint_plan
# have no dependents, so their modes carry no mode chain.
MODE_CHAIN = {
    "refine": ("existing", "changes"),
}

# The blocks that carry a REC-7 digest-bound approval (DD-3): changes (refine apply it, EDT-5) and
# sprint_plan (plan apply it, SPR-6). sizing writes no field on its own and is never approved.
APPROVABLE = ("changes", "sprint_plan")


def block_digest(block):
    """The REC-7/INV-8 digest of an approvable block.

    sha256 over the canonical JSON of the block with its own digest field excluded, computed by
    canonical.digest, so it is bound exactly as the build-mode ticket_set_ref digest is bound.
    """
    payload = {key: value for key, value in block.items() if key != "digest"}
    return canonical.digest(payload)


def required_for(record, step=None):
    """Return the required blocks for a step, honouring run.mode (single source, RULE-11).

    Build mode keeps its exact step-keyed REQUIRED map. The existing-work modes index their own
    MODE_REQUIRED sequence by step (step 0 is the first required block, step 1 the second, and so
    on); a step past the sequence requires nothing.
    """
    run = record.get("run") if isinstance(record, dict) else None
    mode = run.get("mode", "build") if isinstance(run, dict) else "build"
    if step is None and isinstance(run, dict):
        step = run.get("step")
    if mode == "build":
        return REQUIRED.get(step, ())
    sequence = MODE_REQUIRED.get(mode, ())
    if isinstance(step, int) and 0 <= step < len(sequence):
        return (sequence[step],)
    return ()

RUN_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"


def mint_run_id():
    """Return a fresh run id of the form DR-YYYYMMDD-XXXX."""
    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    suffix = "".join(random.choice(RUN_ID_ALPHABET) for _ in range(4))
    return "DR-{0}-{1}".format(day, suffix)


def new_record(run_id=None, mode="build"):
    """Return the initial record (revision 0, step 0)."""
    return {
        "run": {
            "run_id": run_id or mint_run_id(),
            "revision": 0,
            "step": 0,
            "updated_at": canonical.now(),
            "mode": mode,
        },
        "setup": {},
        "idea": {},
        "glossary": [],
        "today": [],
        "playback": {},
        "decisions": [],
        "assumptions": [],
        "outcome": {},
        "ticket_set_ref": {},
        "readiness": {},
        "posted": {},
        "existing": [],
        "changes": {},
        "sizing": {},
        "sprint_plan": {},
        "stale": [],
        "approval": None,
    }


def validate(record):
    """Raise ValueError when the record is not a well-formed REC-1 object."""
    if not isinstance(record, dict):
        raise ValueError("Record must be a JSON object.")
    run = record.get("run")
    if not isinstance(run, dict):
        raise ValueError("Record is missing its run block.")
    if not isinstance(run.get("revision"), int) or run["revision"] < 0:
        raise ValueError("run.revision must be a non-negative integer.")
    if not isinstance(run.get("step"), int) or not 0 <= run["step"] <= 6:
        raise ValueError("run.step must be an integer from 0 to 6.")
    for block in BLOCKS:
        if block not in record:
            raise ValueError("Record is missing the {0} block.".format(block))
    if not isinstance(record.get("stale"), list):
        raise ValueError("Record stale list is malformed.")


def present(value):
    """True when a block holds content (a non-empty container or non-empty string)."""
    if isinstance(value, str):
        return bool(value.strip())
    return bool(value)


def apply_update(record, expect_revision, patch):
    """Apply a patch under the expected-revision rule and the REC-4 stale map.

    Refuses a write whose expected revision is not the record's current revision (stale).
    Refuses a patch that names a block outside the documented content blocks. Replaces the
    named blocks, raises the revision by one, marks the dependent blocks stale using the
    minimum-affected-block rule, clears the staleness of any block the patch just wrote, and
    pops any bound approval. Returns the mutated record.
    """
    validate(record)
    current = record["run"]["revision"]
    if expect_revision != current:
        raise ValueError(
            "Stale revision: expected {0}, current {1}.".format(expect_revision, current))
    if not isinstance(patch, dict) or not patch:
        raise ValueError("Patch must name at least one documented block.")
    unknown = sorted(set(patch) - set(BLOCKS))
    if unknown:
        raise ValueError("Patch touches undocumented blocks: {0}.".format(", ".join(unknown)))

    changed = [block for block in patch if record.get(block) != patch[block]]
    chain_changed = [block for block in changed if block in CHAIN]

    # Minimum-affected-block propagation: the earliest changed block in the chain decides how
    # far staleness reaches; every block after it goes stale.
    went_back = False
    dependents = set()
    if chain_changed:
        first = min(CHAIN.index(block) for block in chain_changed)
        dependents = set(CHAIN[first + 1:])
        # A true go-back invalidates work that already existed, so check whether any dependent
        # that is not itself being rewritten currently holds content.
        went_back = any(present(record.get(block))
                        for block in dependents - set(patch))

    # Per-mode staleness (S1b): mode-local and separate from the build CHAIN above, so build-mode
    # behaviour is unchanged. In refine mode re-writing existing stales changes. In build mode the
    # mode chain is empty and this is a no-op.
    mode = record["run"].get("mode", "build")
    mode_chain = MODE_CHAIN.get(mode, ())
    mode_changed = [block for block in changed if block in mode_chain]
    if mode_changed:
        first = min(mode_chain.index(block) for block in mode_changed)
        dependents.update(mode_chain[first + 1:])

    for block in patch:
        record[block] = patch[block]

    stale = set(record.get("stale", []))
    stale.update(dependents)
    # A block written in this patch is now fresh, so it is never stale.
    stale.difference_update(patch.keys())

    record["stale"] = sorted(stale)
    record["run"]["revision"] = current + 1
    record["run"]["updated_at"] = canonical.now()
    record["approval"] = None
    validate(record)
    return "reverted" if went_back else "updated"


def apply_advance(record, expect_revision):
    """Advance the step when the current step's required blocks are present and not stale."""
    validate(record)
    current = record["run"]["revision"]
    if expect_revision != current:
        raise ValueError(
            "Stale revision: expected {0}, current {1}.".format(expect_revision, current))
    step = record["run"]["step"]
    mode = record["run"].get("mode", "build")
    stale = set(record.get("stale", []))
    required = required_for(record, step)
    missing = [block for block in required if not present(record.get(block))]
    if missing:
        raise ValueError(
            "Cannot advance step {0}: missing {1}.".format(step, ", ".join(missing)))
    blocked = [block for block in required if block in stale]
    if blocked:
        raise ValueError(
            "Cannot advance step {0}: stale {1}.".format(step, ", ".join(blocked)))
    final_step = 6 if mode == "build" else len(MODE_REQUIRED.get(mode, ()))
    if step >= final_step:
        raise ValueError("Already at the final step.")
    record["run"]["step"] = step + 1
    record["run"]["revision"] = current + 1
    record["run"]["updated_at"] = canonical.now()
    return "advanced"


def apply_approve(record, expect_revision, block_name, message_ref):
    """Bind a REC-7 approval over an approvable block (DD-3, EDT-5, SPR-6).

    The approval records the block name, the block digest (block_digest, INV-8) and the message
    reference of the explicit apply it, bound exactly as the build-mode ticket_set_ref approval is
    bound. The expected-revision refusal applies in every mode. A later edit to the block pops the
    approval through apply_update (approval set to None on every write), so an edit after approval
    voids it (AC-34, AC-40).
    """
    validate(record)
    current = record["run"]["revision"]
    if expect_revision != current:
        raise ValueError(
            "Stale revision: expected {0}, current {1}.".format(expect_revision, current))
    if block_name not in APPROVABLE:
        raise ValueError(
            "Only {0} may be approved.".format(" and ".join(APPROVABLE)))
    if not canonical.text(message_ref):
        raise ValueError("An approval needs the message reference of the explicit apply it.")
    block = record.get(block_name)
    if not isinstance(block, dict) or not present(block):
        raise ValueError("Cannot approve the empty {0} block.".format(block_name))
    if block_name in set(record.get("stale", [])):
        raise ValueError("Cannot approve a stale {0} block; redo it first.".format(block_name))
    record["approval"] = {
        "block": block_name,
        "digest": block_digest(block),
        "message_ref": message_ref,
    }
    record["run"]["revision"] = current + 1
    record["run"]["updated_at"] = canonical.now()
    return "approved"


def read(path):
    return canonical.load(path)


def write(path, record):
    Path(path).write_text(
        json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main(argv=None):
    parser = argparse.ArgumentParser(description="The discovery record (REC-1).")
    sub = parser.add_subparsers(dest="command", required=True)

    init = sub.add_parser("init")
    init.add_argument("--path", required=True, type=Path)
    init.add_argument("--run-id")
    init.add_argument("--mode", default="build", choices=("build", "refine", "size", "plan"))

    show = sub.add_parser("show")
    show.add_argument("--path", required=True, type=Path)

    update = sub.add_parser("update")
    update.add_argument("--path", required=True, type=Path)
    update.add_argument("--expect-revision", required=True, type=int)
    update.add_argument("--patch", required=True, type=Path)

    advance = sub.add_parser("advance")
    advance.add_argument("--path", required=True, type=Path)
    advance.add_argument("--expect-revision", required=True, type=int)

    approve = sub.add_parser("approve")
    approve.add_argument("--path", required=True, type=Path)
    approve.add_argument("--expect-revision", required=True, type=int)
    approve.add_argument("--block", required=True, choices=APPROVABLE)
    approve.add_argument("--message-ref", required=True)

    args = parser.parse_args(argv)

    if args.command == "init":
        record = new_record(run_id=args.run_id, mode=args.mode)
        write(args.path, record)
        print(json.dumps({"revision": record["run"]["revision"],
                          "step": record["run"]["step"], "status": "initialized"}))
        return 0

    record = read(args.path)

    if args.command == "show":
        validate(record)
        print(json.dumps({"record": record,
                          "ticket_digest": record.get("ticket_set_ref", {}).get("digest")},
                         indent=2, ensure_ascii=False))
        return 0

    if args.command == "update":
        patch = canonical.load(args.patch)
        status = apply_update(record, args.expect_revision, patch)
    elif args.command == "approve":
        status = apply_approve(record, args.expect_revision, args.block, args.message_ref)
    else:
        status = apply_advance(record, args.expect_revision)

    write(args.path, record)
    print(json.dumps({"revision": record["run"]["revision"],
                      "step": record["run"]["step"], "status": status}))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr)
        sys.exit(1)
