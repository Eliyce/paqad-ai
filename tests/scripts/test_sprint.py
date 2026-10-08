#!/usr/bin/env python3
"""Unit tests for skills/plan-sprint/scripts/fit_sprint.py.

Standard library only (Python 3.9+). No network. Writes nothing outside a temporary folder.

Proves:
  AC-38  capacity is derived from the last three completed sprints and shown with its numbers, and
         the plan lists goal, chosen (priority order within capacity), stretch, left-out-with-
         reasons, total-versus-capacity and risks.
  AC-39  a candidate with no size and a candidate with an unfinished external dependency are both
         listed not ready, each with what it needs.
  AC-40  apply sets the sprint field on the chosen tickets only and the read-back confirms them.
  AC-41  no future sprint: the tool reports it and creates nothing.
  SPR-6/7  apply refuses on a digest mismatch, and the only operation it emits is a sprint-field set.
  U-14   an unsettable sprint field returns the plan as a by-hand list.
"""

import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
SHARED_SCRIPTS = os.path.join(REPO_ROOT, "shared", "scripts")
SPRINT_SCRIPTS = os.path.join(REPO_ROOT, "skills", "plan-sprint", "scripts")
for entry in (SHARED_SCRIPTS, SPRINT_SCRIPTS):
    if entry not in sys.path:
        sys.path.insert(0, entry)

import canonical  # noqa: E402
import fit_sprint  # noqa: E402

SPRINT_FIELD = "customfield_10020"
FIXTURE_SPRINTS = os.path.join(
    REPO_ROOT, "tests", "evals", "fixture-repo", "tracker", "sprints.json")


def history():
    return {"sprints": [
        {"id": "S2", "delivered": 10},
        {"id": "S3", "delivered": 12},
        {"id": "S4", "delivered": 14},
    ]}


def candidates(settable=True, future=True):
    return {
        "sprints": [
            {"id": "S4", "state": "closed", "settable": settable},
            {"id": "S5", "state": "future", "settable": settable},
        ] if future else [
            {"id": "S4", "state": "closed", "settable": settable},
        ],
        "candidates": [
            {"ref": "C1", "priority": 1, "size": 5, "checks_pass": True, "dependencies": []},
            {"ref": "C2", "priority": 2, "size": 5, "checks_pass": True, "dependencies": []},
            {"ref": "C3", "priority": 3, "size": 3, "checks_pass": True, "dependencies": []},
            {"ref": "C4", "priority": 4, "size": 8, "checks_pass": True, "dependencies": []},
            {"ref": "C5", "priority": 5, "size": None, "checks_pass": True, "dependencies": []},
            {"ref": "C6", "priority": 6, "size": 3, "checks_pass": True,
             "dependencies": [{"ref": "EXT-1", "done": False, "in_sprint": False}]},
        ],
    }


class PlanTest(unittest.TestCase):
    def test_derived_capacity_and_full_plan(self):
        # AC-38
        plan, code = fit_sprint.build_plan(SPRINT_FIELD, candidates(), history())
        self.assertEqual(code, 0)
        self.assertEqual(plan["sprint"], "S5")
        # Capacity is derived from the last three sprints, shown with its numbers.
        self.assertEqual(plan["capacity"]["value"], 12)
        self.assertEqual(
            [row["sprint"] for row in plan["capacity"]["derived_from"]], ["S2", "S3", "S4"])
        self.assertEqual(
            [row["count"] for row in plan["capacity"]["derived_from"]], [10, 12, 14])
        # The chosen list is in priority order and within capacity.
        self.assertEqual(plan["chosen"], ["C1", "C2"])
        self.assertLessEqual(plan["total"], plan["capacity"]["value"])
        # Stretch and left-out-with-reasons are populated and distinct.
        self.assertEqual(plan["stretch"], ["C3"])
        self.assertTrue(any(row["ref"] == "C4" for row in plan["left_out"]))
        self.assertTrue(all("reason" in row for row in plan["left_out"]))
        self.assertTrue(plan["goal"])
        self.assertTrue(plan["risks"])

    def test_readiness_filter_flags_no_size_and_external_dep(self):
        # AC-39
        plan, _ = fit_sprint.build_plan(SPRINT_FIELD, candidates(), history())
        not_ready = {row["ref"]: row["needs"] for row in plan["not_ready"]}
        self.assertIn("C5", not_ready)
        self.assertTrue(any("size" in need for need in not_ready["C5"]))
        self.assertIn("C6", not_ready)
        self.assertTrue(any("EXT-1" in need for need in not_ready["C6"]))

    def test_unsettable_field_returns_by_hand_plan(self):
        # U-14
        plan, code = fit_sprint.build_plan(
            SPRINT_FIELD, candidates(settable=False), history())
        self.assertEqual(code, 0)
        self.assertTrue(plan["by_hand"])
        self.assertTrue(plan["chosen"])  # the plan is still produced as a list


class NoFutureSprintTest(unittest.TestCase):
    def test_no_future_sprint_reports_and_creates_nothing(self):
        # AC-41
        plan, code = fit_sprint.build_plan(
            SPRINT_FIELD, candidates(future=False), history())
        self.assertEqual(code, 1)
        self.assertFalse(plan["ok"])
        self.assertEqual(plan["created"], [])
        self.assertIn("created by the team", plan["reason"].lower())


class ApplyTest(unittest.TestCase):
    def _plan(self):
        plan, _ = fit_sprint.build_plan(SPRINT_FIELD, candidates(), history())
        return plan

    def test_apply_sets_only_chosen_with_readback(self):
        # AC-40
        plan = self._plan()
        # The tracker state after the host set the field on the two chosen tickets only.
        tracker_state = {"C1": "S5", "C2": "S5"}
        result, code = fit_sprint.apply_plan(plan, plan["digest"], tracker_state)
        self.assertEqual(code, 0)
        self.assertEqual(result["applied"], ["C1", "C2"])
        self.assertEqual(result["read_back"]["status"], "match")
        self.assertEqual(result["read_back"]["confirmed"], ["C1", "C2"])
        self.assertEqual(result["read_back"]["missing"], [])

    def test_apply_only_sets_sprint_field_never_other_ops(self):
        # SPR-7: the only operation emitted is a sprint-field set on a chosen ticket.
        plan = self._plan()
        result, _ = fit_sprint.apply_plan(plan, plan["digest"], {"C1": "S5", "C2": "S5"})
        self.assertTrue(result["operations"])
        self.assertTrue(all(op["op"] == "set_sprint_field" for op in result["operations"]))
        self.assertEqual({op["ref"] for op in result["operations"]}, {"C1", "C2"})

    def test_digest_mismatch_refuses(self):
        # SPR-6
        plan = self._plan()
        result, code = fit_sprint.apply_plan(plan, "not-the-right-digest", {"C1": "S5"})
        self.assertEqual(code, 1)
        self.assertFalse(result["ok"])
        self.assertEqual(result["applied"], [])

    def test_edit_after_approval_voids_digest(self):
        # An edit to the approved plan changes its digest, so the bound apply refuses.
        plan = self._plan()
        approved_digest = plan["digest"]
        plan["goal"] = "An edited goal that changes the plan."
        result, code = fit_sprint.apply_plan(plan, approved_digest, {"C1": "S5", "C2": "S5"})
        self.assertEqual(code, 1)
        self.assertFalse(result["ok"])

    def test_read_back_without_tracker_state_is_a_clean_skip(self):
        # AC-10 / INV-3 (TD-16): with no tracker-state the apply succeeds and read-back is skipped,
        # never a spurious mismatch, and the chosen list is under the key 'chosen'.
        plan = self._plan()
        self.assertIn("chosen", plan)
        result, code = fit_sprint.apply_plan(plan, plan["digest"])
        self.assertEqual(code, 0)
        self.assertTrue(result["ok"])
        self.assertEqual(result["applied"], plan["chosen"])
        self.assertEqual(result["read_back"]["status"], "skipped")

    def test_plan_digest_excludes_only_the_digest_key(self):
        # INV-4 (TD-16): plan_digest excludes exactly 'digest', matching record.block_digest.
        plan = self._plan()
        expected = canonical.digest({k: v for k, v in plan.items() if k != "digest"})
        self.assertEqual(fit_sprint.plan_digest(plan), expected)


class FixturePlanTest(unittest.TestCase):
    """TD-17: the eval fixture tracker/sprints.json loads straight into fit_sprint and plans."""

    def test_fixture_drives_a_plan(self):
        with open(FIXTURE_SPRINTS, "r", encoding="utf-8") as handle:
            fixture = json.load(handle)
        plan, code = fit_sprint.build_plan(
            SPRINT_FIELD, fixture["candidates_doc"], fixture["history"])
        self.assertEqual(code, 0)
        self.assertEqual(plan["sprint"], "Sprint 24")
        self.assertTrue(plan["chosen"])
        not_ready = {row["ref"] for row in plan["not_ready"]}
        self.assertIn("DEX-30", not_ready)
        self.assertIn("DEX-31", not_ready)


if __name__ == "__main__":
    unittest.main()
