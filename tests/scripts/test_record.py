#!/usr/bin/env python3
"""Unit tests for skills/product-discovery/scripts/record.py.

Standard library only (Python 3.9+). No network. Writes only under a temporary folder.
Covers init; the expected-revision refusal (stale write); a go-back that raises the revision
and marks only the dependent blocks stale while keeping unrelated blocks (AC-7); the
assumptions block being stored (AC-29); advance gated on the required blocks; and a patch to an
undocumented block being rejected.
"""

import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
SHARED_SCRIPTS = os.path.join(REPO_ROOT, "shared", "scripts")
RECORD_SCRIPTS = os.path.join(REPO_ROOT, "skills", "product-discovery", "scripts")
for entry in (SHARED_SCRIPTS, RECORD_SCRIPTS):
    if entry not in sys.path:
        sys.path.insert(0, entry)

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


if __name__ == "__main__":
    unittest.main()
