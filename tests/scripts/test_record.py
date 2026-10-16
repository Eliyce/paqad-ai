#!/usr/bin/env python3
"""Unit tests for skills/product-discovery/scripts/record.py.

Standard library only (Python 3.9+). No network. Writes only under a temporary folder.
Covers init; the expected-revision refusal (stale write); a go-back that raises the revision
and marks only the dependent blocks stale while keeping unrelated blocks (AC-7); the
assumptions block being stored (AC-29); advance gated on the required blocks; and a patch to an
undocumented block being rejected.
"""

import contextlib
import io
import json
import os
import runpy
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
SHARED_SCRIPTS = os.path.join(REPO_ROOT, "shared", "scripts")
RECORD_SCRIPTS = os.path.join(REPO_ROOT, "shared", "scripts")
for entry in (SHARED_SCRIPTS, RECORD_SCRIPTS):
    if entry not in sys.path:
        sys.path.insert(0, entry)

import canonical  # noqa: E402
import record  # noqa: E402


class RecordTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(self._cleanup)
        self.path = os.path.join(self.tmp, "record.json")

    def _cleanup(self):
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _init(self):
        rec = record.new_record(run_id="DR-20261005-7K2Q", mode="build")
        record.write(self.path, rec)
        return rec


class InitTest(RecordTestCase):
    def test_init_shape(self):
        rec = self._init()
        self.assertEqual(rec["run"]["revision"], 0)
        self.assertEqual(rec["run"]["step"], 0)
        self.assertEqual(rec["run"]["mode"], "build")
        self.assertEqual(rec["run"]["run_id"], "DR-20261005-7K2Q")
        self.assertEqual(rec["stale"], [])
        self.assertIsNone(rec["approval"])
        # Round-trips through disk.
        self.assertEqual(record.read(self.path), rec)

    def test_minted_run_id_matches_pattern(self):
        import re
        rec = record.new_record()
        self.assertRegex(rec["run"]["run_id"], r"^DR-\d{8}-[A-Z0-9]{4}$")


class ExpectedRevisionTest(RecordTestCase):
    def test_stale_revision_refused(self):
        rec = self._init()
        with self.assertRaises(ValueError) as ctx:
            record.apply_update(rec, 5, {"idea": {"goal": "x"}})
        self.assertIn("Stale revision", str(ctx.exception))

    def test_matching_revision_accepted(self):
        rec = self._init()
        record.apply_update(rec, 0, {"setup": {"tracker_kind": "jira", "can_create": True}})
        self.assertEqual(rec["run"]["revision"], 1)


class GoBackTest(RecordTestCase):
    def _build_full_run(self):
        rec = self._init()
        record.apply_update(rec, 0, {"idea": {"goal": "cut refund time", "success": "faster"}})
        record.apply_update(rec, 1, {"today": [{"area": "returns", "source_path": "x"}]})
        record.apply_update(rec, 2, {"playback": {"recommendation": "ship a smaller first step"}})
        record.apply_update(rec, 3, {"decisions": [{"id": "D1", "choice": "manual review"}]})
        record.apply_update(rec, 4, {"assumptions": [{"id": "A1", "default": "weekly", "why": "no data"}]})
        return rec

    def test_go_back_raises_revision_and_marks_only_dependents_stale(self):
        rec = self._build_full_run()
        before = rec["run"]["revision"]
        # Change the goal (an idea change) after later blocks were filled.
        status = record.apply_update(rec, before, {"idea": {"goal": "cut refund time to one day"}})
        self.assertEqual(rec["run"]["revision"], before + 1)
        self.assertEqual(status, "reverted")
        stale = set(rec["stale"])
        # The whole dependent chain after idea is stale.
        self.assertEqual(stale, {"today", "playback", "decisions", "ticket_set_ref",
                                 "readiness", "posted"})
        # Unrelated blocks are kept and never stale.
        self.assertNotIn("assumptions", stale)
        self.assertNotIn("glossary", stale)
        self.assertNotIn("setup", stale)
        self.assertNotIn("outcome", stale)

    def test_unrelated_decision_survives_a_goal_change(self):
        rec = self._build_full_run()
        kept = rec["assumptions"]
        record.apply_update(rec, rec["run"]["revision"], {"idea": {"goal": "new goal"}})
        self.assertEqual(rec["assumptions"], kept)

    def test_rewriting_a_stale_block_clears_its_staleness(self):
        rec = self._build_full_run()
        record.apply_update(rec, rec["run"]["revision"], {"idea": {"goal": "new goal"}})
        self.assertIn("today", rec["stale"])
        record.apply_update(rec, rec["run"]["revision"], {"today": [{"area": "returns", "source_path": "y"}]})
        self.assertNotIn("today", rec["stale"])
        # Blocks below today stay stale.
        self.assertIn("playback", rec["stale"])

    def test_update_pops_bound_approval(self):
        rec = self._init()
        rec["approval"] = {"digest": "abc", "message_ref": "m"}
        record.apply_update(rec, 0, {"idea": {"goal": "g"}})
        self.assertIsNone(rec["approval"])


class InvalidationMapTest(RecordTestCase):
    """Lock in the REC-4 invalidation reach (INV-11): a block change stales exactly the chain
    below it. The frozen spec lists ticket_set_ref -> posted and readiness -> posted as separate
    rows; the chain also stales readiness on a ticket_set_ref change (readiness is the review of
    that ticket set), and these assertions guard that intended over-invalidation."""

    OUTSIDE_CHAIN = ("setup", "glossary", "assumptions", "outcome")

    def test_ticket_set_ref_change_stales_exactly_readiness_and_posted(self):
        rec = self._init()
        record.apply_update(rec, 0, {"ticket_set_ref": {"digest": "abc"}})
        stale = set(rec["stale"])
        self.assertEqual(stale, {"readiness", "posted"})
        # Nothing before ticket_set_ref in the chain, nor anything outside it, is touched.
        for block in ("idea", "today", "playback", "decisions") + self.OUTSIDE_CHAIN:
            self.assertNotIn(block, stale)

    def test_readiness_change_stales_only_posted(self):
        rec = self._init()
        record.apply_update(rec, 0, {"readiness": {"verdict": "ready"}})
        stale = set(rec["stale"])
        self.assertEqual(stale, {"posted"})
        for block in ("idea", "today", "playback", "decisions", "ticket_set_ref") + self.OUTSIDE_CHAIN:
            self.assertNotIn(block, stale)


class AssumptionsTest(RecordTestCase):
    def test_assumptions_block_stored(self):
        rec = self._init()
        entry = {"id": "A1", "question": "cadence?", "default": "weekly",
                 "why": "no usage data yet"}
        record.apply_update(rec, 0, {"assumptions": [entry]})
        self.assertEqual(rec["assumptions"], [entry])
        # Storing an assumption marks nothing stale (it is outside the chain).
        self.assertEqual(rec["stale"], [])


class AdvanceTest(RecordTestCase):
    def test_advance_blocked_until_required_block_present(self):
        rec = self._init()
        # Step 0 requires setup; it is empty.
        with self.assertRaises(ValueError) as ctx:
            record.apply_advance(rec, 0)
        self.assertIn("missing", str(ctx.exception))
        self.assertEqual(rec["run"]["step"], 0)

    def test_advance_moves_step_when_required_block_present(self):
        rec = self._init()
        record.apply_update(rec, 0, {"setup": {"tracker_kind": "jira", "can_create": True}})
        status = record.apply_advance(rec, rec["run"]["revision"])
        self.assertEqual(status, "advanced")
        self.assertEqual(rec["run"]["step"], 1)

    def test_advance_blocked_when_required_block_is_stale(self):
        rec = self._init()
        # Walk forward to step 2, which requires the today block.
        record.apply_update(rec, 0, {"setup": {"tracker_kind": "jira", "can_create": True}})
        record.apply_advance(rec, rec["run"]["revision"])  # step 0 -> 1
        record.apply_update(rec, rec["run"]["revision"], {"idea": {"goal": "g"}})
        record.apply_advance(rec, rec["run"]["revision"])  # step 1 -> 2
        record.apply_update(rec, rec["run"]["revision"], {"today": [{"area": "a", "source_path": "p"}]})
        self.assertEqual(rec["run"]["step"], 2)
        # A go-back on idea makes today stale, so step 2 can no longer advance.
        record.apply_update(rec, rec["run"]["revision"], {"idea": {"goal": "changed"}})
        self.assertIn("today", rec["stale"])
        with self.assertRaises(ValueError) as ctx:
            record.apply_advance(rec, rec["run"]["revision"])
        self.assertIn("stale", str(ctx.exception))


class UndocumentedBlockTest(RecordTestCase):
    def test_patch_to_undocumented_block_rejected(self):
        rec = self._init()
        with self.assertRaises(ValueError) as ctx:
            record.apply_update(rec, 0, {"made_up_block": {"x": 1}})
        self.assertIn("undocumented", str(ctx.exception))
        # The record is unchanged on a rejected write.
        self.assertEqual(rec["run"]["revision"], 0)

    def test_run_block_is_not_patchable(self):
        rec = self._init()
        with self.assertRaises(ValueError):
            record.apply_update(rec, 0, {"run": {"revision": 99}})


class PostedPresenceTest(RecordTestCase):
    """INV-2 (TD-18): a fresh record's posted block is empty, so step 6 is not read as satisfied;
    present() tests real posted content, not an empty container shell."""

    def test_fresh_record_posted_is_empty_and_not_present(self):
        rec = self._init()
        self.assertEqual(rec["posted"], {})
        self.assertFalse(record.present(rec["posted"]))
        # Step 6 requires posted; on a fresh record it cannot advance.
        self.assertIn("posted", record.required_for(rec, 6))

    def test_posted_with_real_issues_is_present(self):
        rec = self._init()
        rec["posted"] = {"issues": [{"ref": "E1", "issue_key": "ABC-1", "status": "created"}],
                         "read_back": {}}
        self.assertTrue(record.present(rec["posted"]))


class BuildModeUnchangedTest(RecordTestCase):
    """INV-1: the four S1b blocks are additive and mode-gated. The build-mode CHAIN and REQUIRED
    maps are untouched and build-mode advance ignores the new blocks entirely."""

    NEW_BLOCKS = ("existing", "changes", "sizing", "sprint_plan")

    def test_new_blocks_exist_but_sit_outside_the_build_chain_and_required_map(self):
        for block in self.NEW_BLOCKS:
            self.assertIn(block, record.BLOCKS)
            self.assertNotIn(block, record.CHAIN)
        required_blocks = {b for blocks in record.REQUIRED.values() for b in blocks}
        self.assertTrue(required_blocks.isdisjoint(self.NEW_BLOCKS))

    def test_new_record_seeds_empty_new_blocks(self):
        rec = self._init()
        self.assertEqual(rec["existing"], [])
        self.assertEqual(rec["changes"], {})
        self.assertEqual(rec["sizing"], {})
        self.assertEqual(rec["sprint_plan"], {})

    def test_build_mode_write_to_new_block_stales_nothing(self):
        rec = self._init()
        record.apply_update(rec, 0, {"sizing": {"suggestion": {"size": "M"}}})
        # In build mode the new blocks are inert: no staleness, no chain reach.
        self.assertEqual(rec["stale"], [])


class RefineModeTest(RecordTestCase):
    def _refine(self):
        rec = record.new_record(run_id="DR-20261005-RFNE", mode="refine")
        record.write(self.path, rec)
        return rec

    def test_write_existing_then_changes(self):
        rec = self._refine()
        record.apply_update(rec, 0, {"existing": [{"key": "PROJ-1", "last_updated": "2026-10-05T00:00:00Z"}]})
        record.apply_update(rec, 1, {"changes": {"ticket_key": "PROJ-1", "changes": [], "new_children": []}})
        self.assertEqual(rec["changes"]["ticket_key"], "PROJ-1")
        self.assertEqual(rec["stale"], [])

    def test_mode_required_gates_advance(self):
        rec = self._refine()
        # Step 0 requires existing.
        with self.assertRaises(ValueError) as ctx:
            record.apply_advance(rec, rec["run"]["revision"])
        self.assertIn("missing existing", str(ctx.exception))
        record.apply_update(rec, rec["run"]["revision"], {"existing": [{"key": "PROJ-1"}]})
        record.apply_advance(rec, rec["run"]["revision"])
        self.assertEqual(rec["run"]["step"], 1)
        # Step 1 requires changes.
        with self.assertRaises(ValueError) as ctx:
            record.apply_advance(rec, rec["run"]["revision"])
        self.assertIn("missing changes", str(ctx.exception))
        record.apply_update(rec, rec["run"]["revision"], {"changes": {"ticket_key": "PROJ-1"}})
        record.apply_advance(rec, rec["run"]["revision"])
        self.assertEqual(rec["run"]["step"], 2)
        # Past the mode sequence there is nothing further to advance to.
        with self.assertRaises(ValueError) as ctx:
            record.apply_advance(rec, rec["run"]["revision"])
        self.assertIn("final step", str(ctx.exception))

    def test_rewriting_existing_stales_changes(self):
        rec = self._refine()
        record.apply_update(rec, 0, {"existing": [{"key": "PROJ-1"}]})
        record.apply_update(rec, 1, {"changes": {"ticket_key": "PROJ-1"}})
        self.assertNotIn("changes", rec["stale"])
        # Re-snapshotting existing invalidates the change set that was built from it.
        record.apply_update(rec, rec["run"]["revision"], {"existing": [{"key": "PROJ-1", "v": 2}]})
        self.assertIn("changes", rec["stale"])

    def test_staleness_is_mode_local_and_never_touches_the_build_chain(self):
        rec = self._refine()
        record.apply_update(rec, 0, {"existing": [{"key": "PROJ-1"}]})
        for block in record.CHAIN:
            self.assertNotIn(block, rec["stale"])


class SizeAndPlanModeTest(RecordTestCase):
    def test_size_mode_requires_sizing(self):
        rec = record.new_record(mode="size")
        with self.assertRaises(ValueError) as ctx:
            record.apply_advance(rec, rec["run"]["revision"])
        self.assertIn("missing sizing", str(ctx.exception))
        record.apply_update(rec, rec["run"]["revision"], {"sizing": {"suggestion": {"size": "M"}}})
        record.apply_advance(rec, rec["run"]["revision"])
        self.assertEqual(rec["run"]["step"], 1)

    def test_plan_mode_requires_sprint_plan(self):
        rec = record.new_record(mode="plan")
        with self.assertRaises(ValueError) as ctx:
            record.apply_advance(rec, rec["run"]["revision"])
        self.assertIn("missing sprint_plan", str(ctx.exception))
        record.apply_update(rec, rec["run"]["revision"], {"sprint_plan": {"sprint": "S-12", "goal": "ship"}})
        record.apply_advance(rec, rec["run"]["revision"])
        self.assertEqual(rec["run"]["step"], 1)


class ApprovalTest(RecordTestCase):
    def test_block_digest_excludes_its_own_digest_field(self):
        # INV-8: the digest is canonical.digest over the block minus its digest field.
        block = {"ticket_key": "PROJ-1", "changes": [{"field": "summary", "before": "a", "after": "b", "op": "replace"}],
                 "new_children": [], "digest": "stale-placeholder"}
        expected = canonical.digest({k: v for k, v in block.items() if k != "digest"})
        self.assertEqual(record.block_digest(block), expected)
        # The placeholder digest field does not change the result.
        block_no_digest = {k: v for k, v in block.items() if k != "digest"}
        self.assertEqual(record.block_digest(block_no_digest), expected)

    def test_approve_binds_the_block_digest(self):
        rec = record.new_record(mode="refine")
        record.apply_update(rec, 0, {"existing": [{"key": "PROJ-1"}]})
        record.apply_update(rec, 1, {"changes": {"ticket_key": "PROJ-1", "changes": [], "new_children": []}})
        rev = rec["run"]["revision"]
        status = record.apply_approve(rec, rev, "changes", "msg-9: apply it")
        self.assertEqual(status, "approved")
        self.assertEqual(rec["approval"]["block"], "changes")
        self.assertEqual(rec["approval"]["digest"], record.block_digest(rec["changes"]))
        self.assertEqual(rec["approval"]["message_ref"], "msg-9: apply it")
        self.assertEqual(rec["run"]["revision"], rev + 1)

    def test_edit_after_approval_voids_it(self):
        # AC-34: a change set edited after approval voids the approval.
        rec = record.new_record(mode="refine")
        record.apply_update(rec, 0, {"existing": [{"key": "PROJ-1"}]})
        record.apply_update(rec, 1, {"changes": {"ticket_key": "PROJ-1", "changes": [], "new_children": []}})
        record.apply_approve(rec, rec["run"]["revision"], "changes", "msg-9: apply it")
        self.assertIsNotNone(rec["approval"])
        record.apply_update(rec, rec["run"]["revision"],
                            {"changes": {"ticket_key": "PROJ-1", "changes": [{"field": "summary", "before": "a", "after": "b", "op": "replace"}], "new_children": []}})
        self.assertIsNone(rec["approval"])

    def test_sprint_plan_approval_digest(self):
        # INV-8 for the plan-mode block.
        rec = record.new_record(mode="plan")
        record.apply_update(rec, 0, {"sprint_plan": {"sprint": "S-12", "goal": "ship", "chosen": ["PROJ-1"]}})
        record.apply_approve(rec, rec["run"]["revision"], "sprint_plan", "msg-4: apply it")
        self.assertEqual(rec["approval"]["digest"], record.block_digest(rec["sprint_plan"]))

    def test_approve_refuses_unknown_block_and_stale_revision(self):
        rec = record.new_record(mode="refine")
        record.apply_update(rec, 0, {"existing": [{"key": "PROJ-1"}]})
        record.apply_update(rec, 1, {"changes": {"ticket_key": "PROJ-1"}})
        # A block that is not approvable is refused.
        with self.assertRaises(ValueError) as ctx:
            record.apply_approve(rec, rec["run"]["revision"], "existing", "msg: apply it")
        self.assertIn("may be approved", str(ctx.exception))
        # The expected-revision refusal applies in refine mode too.
        with self.assertRaises(ValueError) as ctx:
            record.apply_approve(rec, 0, "changes", "msg: apply it")
        self.assertIn("Stale revision", str(ctx.exception))

    def test_approve_refuses_empty_block(self):
        rec = record.new_record(mode="refine")
        with self.assertRaises(ValueError) as ctx:
            record.apply_approve(rec, rec["run"]["revision"], "changes", "msg: apply it")
        self.assertIn("empty changes", str(ctx.exception))


class ValidateTest(RecordTestCase):
    """validate refuses every malformed REC-1 shape with a message naming what is wrong."""

    def _assert_invalid(self, rec, fragment):
        with self.assertRaises(ValueError) as ctx:
            record.validate(rec)
        self.assertIn(fragment, str(ctx.exception))

    def test_non_object_refused(self):
        self._assert_invalid([], "must be a JSON object")

    def test_missing_run_block_refused(self):
        rec = record.new_record()
        del rec["run"]
        self._assert_invalid(rec, "missing its run block")

    def test_bad_revision_refused(self):
        for bad in (-1, "0", None):
            rec = record.new_record()
            rec["run"]["revision"] = bad
            self._assert_invalid(rec, "run.revision")

    def test_bad_step_refused(self):
        for bad in (-1, 7, "1"):
            rec = record.new_record()
            rec["run"]["step"] = bad
            self._assert_invalid(rec, "run.step")

    def test_missing_content_block_refused(self):
        rec = record.new_record()
        del rec["glossary"]
        self._assert_invalid(rec, "missing the glossary block")

    def test_malformed_stale_list_refused(self):
        rec = record.new_record()
        rec["stale"] = "idea"
        self._assert_invalid(rec, "stale list is malformed")

    def test_fresh_record_is_valid(self):
        record.validate(record.new_record(mode="plan"))


class EdgeRefusalTest(RecordTestCase):
    def test_present_treats_whitespace_string_as_empty(self):
        self.assertFalse(record.present("   "))
        self.assertTrue(record.present(" x "))
        self.assertFalse(record.present({}))

    def test_empty_patch_refused(self):
        rec = self._init()
        for patch in ({}, ["idea"]):
            with self.assertRaises(ValueError) as ctx:
                record.apply_update(rec, 0, patch)
            self.assertIn("at least one documented block", str(ctx.exception))
        self.assertEqual(rec["run"]["revision"], 0)

    def test_advance_refuses_stale_revision(self):
        rec = self._init()
        record.apply_update(rec, 0, {"setup": {"tracker_kind": "jira"}})
        with self.assertRaises(ValueError) as ctx:
            record.apply_advance(rec, 0)
        self.assertIn("Stale revision: expected 0, current 1", str(ctx.exception))
        self.assertEqual(rec["run"]["step"], 0)

    def test_advance_refuses_past_the_final_mode_step(self):
        rec = record.new_record(mode="size")
        record.apply_update(rec, 0, {"sizing": {"PROJ-1": "M"}})
        record.apply_advance(rec, 1)
        self.assertEqual(rec["run"]["step"], 1)
        # Past the size-mode sequence nothing is required, but the final step stops the walk.
        with self.assertRaises(ValueError) as ctx:
            record.apply_advance(rec, 2)
        self.assertIn("final step", str(ctx.exception))

    def test_required_for_reads_the_step_from_the_record(self):
        rec = record.new_record(mode="refine")
        self.assertEqual(record.required_for(rec), ("existing",))
        rec["run"]["step"] = 1
        self.assertEqual(record.required_for(rec), ("changes",))
        rec["run"]["step"] = 5
        self.assertEqual(record.required_for(rec), ())
        self.assertEqual(record.required_for(record.new_record()), ("setup",))

    def test_approve_refuses_a_blank_message_ref(self):
        rec = record.new_record(mode="plan")
        record.apply_update(rec, 0, {"sprint_plan": {"sprint": "S-1"}})
        for ref in ("", "   ", None):
            with self.assertRaises(ValueError) as ctx:
                record.apply_approve(rec, 1, "sprint_plan", ref)
            self.assertIn("message reference", str(ctx.exception))
        self.assertIsNone(rec["approval"])

    def test_approve_refuses_a_stale_block(self):
        rec = record.new_record(mode="refine")
        record.apply_update(rec, 0, {"existing": [{"key": "PROJ-1"}]})
        record.apply_update(rec, 1, {"changes": {"ticket_key": "PROJ-1"}})
        # Re-snapshotting existing stales its dependent changes block (MODE_CHAIN).
        record.apply_update(rec, 2, {"existing": [{"key": "PROJ-1", "summary": "new"}]})
        self.assertIn("changes", rec["stale"])
        with self.assertRaises(ValueError) as ctx:
            record.apply_approve(rec, 3, "changes", "msg-1: apply it")
        self.assertIn("stale changes", str(ctx.exception))


class RecordCliTest(RecordTestCase):
    """The record.py CLI: each subcommand prints one JSON status line and persists the record;
    a refused write exits 1 with an {"ok": false, "error"} line on stderr and leaves the file."""

    def _main(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = record.main(list(argv))
        return code, json.loads(out.getvalue())

    def _script(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.object(sys, "argv", [record.__file__] + list(argv)), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            with self.assertRaises(SystemExit) as ctx:
                runpy.run_path(record.__file__, run_name="__main__")
        return ctx.exception.code, out.getvalue(), err.getvalue()

    def _patch_file(self, patch):
        path = os.path.join(self.tmp, "patch.json")
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(patch, handle)
        return path

    def test_init_writes_a_fresh_record(self):
        code, payload = self._main("init", "--path", self.path, "--run-id", "DR-20261005-AAAA",
                                   "--mode", "refine")
        self.assertEqual(code, 0)
        self.assertEqual(payload, {"revision": 0, "step": 0, "status": "initialized"})
        rec = record.read(self.path)
        self.assertEqual(rec["run"]["run_id"], "DR-20261005-AAAA")
        self.assertEqual(rec["run"]["mode"], "refine")

    def test_show_prints_the_record_and_ticket_digest(self):
        rec = self._init()
        rec["ticket_set_ref"] = {"path": "t.json", "digest": "abc123"}
        record.write(self.path, rec)
        code, payload = self._main("show", "--path", self.path)
        self.assertEqual(code, 0)
        self.assertEqual(payload["ticket_digest"], "abc123")
        self.assertEqual(payload["record"], rec)

    def test_update_advance_and_approve_round_trip_through_disk(self):
        self._main("init", "--path", self.path, "--mode", "plan")
        patch = self._patch_file({"sprint_plan": {"sprint": "S-3", "chosen": ["PROJ-2"]}})
        code, payload = self._main("update", "--path", self.path, "--expect-revision", "0",
                                   "--patch", patch)
        self.assertEqual((code, payload["status"], payload["revision"]), (0, "updated", 1))
        code, payload = self._main("approve", "--path", self.path, "--expect-revision", "1",
                                   "--block", "sprint_plan", "--message-ref", "msg-2: apply it")
        self.assertEqual((code, payload["status"], payload["revision"]), (0, "approved", 2))
        code, payload = self._main("advance", "--path", self.path, "--expect-revision", "2")
        self.assertEqual(payload, {"revision": 3, "step": 1, "status": "advanced"})
        rec = record.read(self.path)
        self.assertEqual(rec["approval"]["message_ref"], "msg-2: apply it")
        self.assertEqual(rec["run"]["step"], 1)

    def test_script_refuses_a_stale_update_and_keeps_the_file(self):
        self._init()
        before = record.read(self.path)
        patch = self._patch_file({"idea": {"goal": "x"}})
        code, out, err = self._script("update", "--path", self.path, "--expect-revision", "4",
                                      "--patch", patch)
        self.assertEqual(code, 1)
        self.assertEqual(out, "")
        self.assertEqual(json.loads(err),
                         {"ok": False, "error": "Stale revision: expected 4, current 0."})
        self.assertEqual(record.read(self.path), before)

    def test_script_reports_a_missing_record_file(self):
        missing = os.path.join(self.tmp, "absent.json")
        code, _out, err = self._script("show", "--path", missing)
        self.assertEqual(code, 1)
        payload = json.loads(err)
        self.assertFalse(payload["ok"])
        self.assertIn("absent.json", payload["error"])

    def test_script_init_exits_zero(self):
        code, out, err = self._script("init", "--path", self.path)
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(json.loads(out)["status"], "initialized")


if __name__ == "__main__":
    unittest.main()
