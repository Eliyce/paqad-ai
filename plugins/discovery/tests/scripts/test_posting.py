#!/usr/bin/env python3
"""Unit tests for plan_posting.py, check_readback.py and export_csv.py.

Standard library only (Python 3.9+). No network. Writes nothing outside a temporary folder.

plan_posting proves:
  AC-13  two epics, five tickets and two dependencies build an ordered plan (epics, then tickets
         parented by result reference, then links, then read-back), and a full claim/record run
         creates every issue in order.
  AC-11  a lost reply where the issue was created is marked uncertain, dependent writes stop, and
         reconcile finds it by run label plus item reference and records it created with no
         duplicate.
  AC-12  a lost reply where the search does not find the issue asks the user and performs no
         automatic retry.
  AC-14  a ticket set edited after approval refuses (stale plan, then a voided digest-bound
         approval).
  AC-18  a connector that exposes createJiraIssueLink or createIssueLink resolves the link action
         either way.

check_readback proves the match, partial and mismatch verdicts after normalisation.
export_csv proves the exact PUB-8 columns and epics-before-stories order.
"""

import contextlib
import copy
import csv
import io
import json
import os
import runpy
import shutil
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
SHARED_SCRIPTS = os.path.join(REPO_ROOT, "shared", "scripts")
POST_SCRIPTS = os.path.join(REPO_ROOT, "skills", "post-tickets", "scripts")
for entry in (SHARED_SCRIPTS, POST_SCRIPTS):
    if entry not in sys.path:
        sys.path.insert(0, entry)

import canonical  # noqa: E402
import check_readback  # noqa: E402
import export_csv  # noqa: E402
import plan_posting  # noqa: E402

RUN_LABEL = "dr-20261005-7k2q"


def seal(ticket_set):
    ticket_set = copy.deepcopy(ticket_set)
    ticket_set["digest"] = canonical.digest(
        {k: v for k, v in ticket_set.items() if k != "digest"})
    return ticket_set


def ticket(ref, title, deps=None):
    return {
        "ref": ref, "title": title,
        "body_markdown": "## What they need and why\nMembers want " + title.lower() + ".",
        "done_when": ["A member can " + title.lower(), "It works reliably"],
        "depends_on": deps or [], "assignee_hint": None,
    }


def posting_set():
    """Two epics, five tickets, two dependencies."""
    ts = {
        "run_id": "DR-20261005-7K2Q", "revision": 2, "digest": "",
        "tracker": {"kind": "jira", "project_key": "ABC",
                    "epic_type": "Epic", "story_type": "Story"},
        "epics": [
            {"ref": "E1", "title": "Faster refunds", "labels": ["paqad-discovery"],
             "body_markdown": "## Goal\nHelp members get refunds faster.",
             "tickets": [
                 ticket("E1-T1", "show the refund status"),
                 ticket("E1-T2", "notify on a refund", deps=["E1-T1"]),
                 ticket("E1-T3", "explain a declined refund"),
             ]},
            {"ref": "E2", "title": "Clearer orders", "labels": [],
             "body_markdown": "## Goal\nMake orders easy to find.",
             "tickets": [
                 ticket("E2-T1", "search past orders"),
                 ticket("E2-T2", "export an order", deps=["E2-T1"]),
             ]},
        ],
    }
    return seal(ts)


def fresh_state(connector_actions=("createIssueLink",)):
    ts = posting_set()
    state = {
        "ticket_set": ts,
        "setup": {"run_label": RUN_LABEL},
        "connector": {"actions": list(connector_actions)},
        "approval": None,
        "receipts": {},
        "posted": {"issues": [], "read_back": {}},
    }
    state["plan"] = plan_posting.build_plan(ts, state["setup"], state["connector"])
    digest = plan_posting.current_digest(ts)
    state["approval"] = {"digest": digest, "message_ref": "msg-42: post it"}
    return state


class PlanOrderTest(unittest.TestCase):
    def test_ordered_plan_with_parents_and_links_last(self):
        state = fresh_state()
        ops = state["plan"]["operations"]
        kinds = [op["kind"] for op in ops]
        # Epics first (two), then five tickets, then two links, then read-back last.
        self.assertEqual(kinds[:2], ["epic", "epic"])
        self.assertEqual(kinds[2:7], ["story"] * 5)
        self.assertEqual(kinds[7:9], ["link", "link"])
        self.assertEqual(kinds[-1], "read_back")
        # Every ticket's parent is a result reference to the created epic.
        parent = next(op for op in ops if op["id"] == "create-E1-T1")["arguments"]["parent"]
        self.assertEqual(parent, {"$result": {"operation": "create-E1", "path": ["key"]}})
        # Links come after every create.
        last_create = max(i for i, op in enumerate(ops) if op["kind"] in ("epic", "story"))
        first_link = min(i for i, op in enumerate(ops) if op["kind"] == "link")
        self.assertLess(last_create, first_link)

    def test_full_run_creates_every_issue_in_order(self):
        state = fresh_state()
        order = []
        counter = {"n": 0}

        def run():
            while True:
                try:
                    claimed = plan_posting.claim(state)
                except ValueError:
                    break
                op_id = claimed["id"]
                order.append(op_id)
                if op_id == "read-back":
                    plan_posting.record_receipt(
                        state, op_id, {"status": "not_applied", "evidence": "read-back deferred"})
                    continue
                counter["n"] += 1
                key = "ABC-{0}".format(counter["n"])
                plan_posting.record_receipt(
                    state, op_id, {"status": "created", "evidence": "reply",
                                   "result": {"key": key}})
        run()
        # Epics are created before their stories, and links resolve after the creates.
        self.assertLess(order.index("create-E1"), order.index("create-E1-T1"))
        self.assertLess(order.index("create-E1-T1"), order.index("link-E1-T2-E1-T1"))
        # Every epic and story landed in the posted block with a key.
        posted = {row["ref"]: row for row in state["posted"]["issues"]}
        self.assertEqual(set(posted), {"E1", "E2", "E1-T1", "E1-T2", "E1-T3", "E2-T1", "E2-T2"})
        self.assertTrue(all(row["status"] == "created" and row["issue_key"] for row in posted.values()))


class LostReplyTest(unittest.TestCase):
    def _advance_to_third_create(self, state):
        # Create the two epics, then claim the first ticket.
        for _ in range(2):
            claimed = plan_posting.claim(state)
            plan_posting.record_receipt(
                state, claimed["id"],
                {"status": "created", "evidence": "reply",
                 "result": {"key": claimed["id"].upper()}})
        return plan_posting.claim(state)  # claims create-E1-T1 (in_flight)

    def test_lost_reply_but_created_reconciles_without_duplicate(self):
        # AC-11
        state = fresh_state()
        claimed = self._advance_to_third_create(state)
        self.assertEqual(claimed["id"], "create-E1-T1")
        # The reply is lost: record uncertain.
        plan_posting.record_receipt(state, "create-E1-T1",
                                    {"status": "uncertain", "evidence": "no reply"})
        # Dependent writes stop.
        with self.assertRaises(ValueError) as ctx:
            plan_posting.next_operation(state)
        self.assertIn("Reconcile", str(ctx.exception))
        # The issue was in fact created; the search finds it by run label and item reference.
        found = plan_posting.reconcile(state, "create-E1-T1", tracker_issues=[
            {"key": "ABC-77", "labels": [RUN_LABEL], "item_ref": "E1-T1"}])
        self.assertEqual(found["status"], "created")
        self.assertFalse(found["duplicate_created"])
        self.assertEqual(state["receipts"]["create-E1-T1"]["status"], "created")
        posted = {row["ref"]: row for row in state["posted"]["issues"]}
        self.assertEqual(posted["E1-T1"]["issue_key"], "ABC-77")
        # Posting can now continue past the reconciled item.
        self.assertEqual(plan_posting.next_operation(state)[0]["id"], "create-E1-T2")

    def test_lost_reply_not_found_asks_user_without_retry(self):
        # AC-12
        state = fresh_state()
        self._advance_to_third_create(state)
        plan_posting.record_receipt(state, "create-E1-T1",
                                    {"status": "uncertain", "evidence": "no reply"})
        outcome = plan_posting.reconcile(state, "create-E1-T1", tracker_issues=[])
        self.assertEqual(outcome["status"], "ask_user")
        self.assertFalse(outcome["retried"])
        # The item stays uncertain and dependent writes are still blocked (no auto retry).
        self.assertEqual(state["receipts"]["create-E1-T1"]["status"], "uncertain")
        with self.assertRaises(ValueError):
            plan_posting.next_operation(state)

    def test_created_receipt_never_reset(self):
        state = fresh_state()
        claimed = plan_posting.claim(state)
        plan_posting.record_receipt(state, claimed["id"],
                                    {"status": "created", "evidence": "reply",
                                     "result": {"key": "ABC-1"}})
        with self.assertRaises(ValueError) as ctx:
            plan_posting.record_receipt(state, claimed["id"],
                                        {"status": "created", "evidence": "retry",
                                         "result": {"key": "ABC-9"}})
        self.assertIn("never reset", str(ctx.exception))


class ApprovalBindingTest(unittest.TestCase):
    def test_stale_plan_refuses_after_edit(self):
        # AC-14: editing the set after the plan was built makes the plan stale.
        state = fresh_state()
        state["ticket_set"]["epics"][0]["title"] = "An edited epic title"
        with self.assertRaises(ValueError) as ctx:
            plan_posting.next_operation(state)
        self.assertIn("Stale plan", str(ctx.exception))

    def test_edit_voids_digest_bound_approval(self):
        # AC-14: even with a rebuilt plan, the old approval no longer matches the new digest.
        state = fresh_state()
        state["ticket_set"]["epics"][0]["title"] = "An edited epic title"
        # Rebuild the plan against the edited set so the stale-plan guard passes.
        state["plan"] = plan_posting.build_plan(
            state["ticket_set"], state["setup"], state["connector"])
        with self.assertRaises(ValueError) as ctx:
            plan_posting.next_operation(state)
        self.assertIn("approval", str(ctx.exception).lower())


class LinkActionTest(unittest.TestCase):
    def test_both_link_action_names_resolve(self):
        # AC-18
        for name in ("createIssueLink", "createJiraIssueLink"):
            state = fresh_state(connector_actions=(name,))
            links = [op for op in state["plan"]["operations"] if op["kind"] == "link"]
            self.assertTrue(links)
            self.assertTrue(all(op["action"] == name for op in links))


class LinksByHandTest(unittest.TestCase):
    """AC-2 (U-3): when the connector exposes no link action, the plan sets links_by_hand true and
    renders each dependency as a Depends on text line in the ticket body instead of a link
    operation; when a link action is present the plan is unchanged."""

    def test_no_link_action_renders_depends_on_text(self):
        # A connector that advertises a create action but no link action.
        state = fresh_state(connector_actions=("createIssue",))
        plan = state["plan"]
        self.assertTrue(plan["links_by_hand"])
        # No link operations are emitted.
        self.assertEqual([op for op in plan["operations"] if op["kind"] == "link"], [])
        # Each dependency is rendered as a Depends on text line.
        rendered = {(line["ticket"], line["depends_on"]): line["text"]
                    for line in plan["depends_on_lines"]}
        self.assertEqual(set(rendered), {("E1-T2", "E1-T1"), ("E2-T2", "E2-T1")})
        self.assertEqual(rendered[("E1-T2", "E1-T1")], "Depends on E1-T1")
        # The dependency is written into the ticket body so it is never lost.
        e1t2 = next(op for op in plan["operations"] if op["id"] == "create-E1-T2")
        self.assertIn("Depends on E1-T1", e1t2["arguments"]["description"])

    def test_link_action_present_is_unchanged(self):
        state = fresh_state(connector_actions=("createIssueLink",))
        plan = state["plan"]
        self.assertFalse(plan["links_by_hand"])
        self.assertEqual(plan["depends_on_lines"], [])
        links = [op for op in plan["operations"] if op["kind"] == "link"]
        self.assertEqual(len(links), 2)
        # The ticket body carries no injected Depends on text when links are made with the action.
        e1t2 = next(op for op in plan["operations"] if op["id"] == "create-E1-T2")
        self.assertNotIn("Depends on", e1t2["arguments"]["description"])

    def test_unadvertised_connector_keeps_default_link_path(self):
        # A connector that did not advertise its actions keeps the default link-action path (backward
        # compatible), so links_by_hand stays false and link operations are emitted.
        state = fresh_state(connector_actions=())
        plan = state["plan"]
        self.assertFalse(plan["links_by_hand"])
        self.assertEqual(len([op for op in plan["operations"] if op["kind"] == "link"]), 2)


class ReadbackTest(unittest.TestCase):
    def _created_from(self, ticket_set, labels_ok=True):
        tracker = ticket_set["tracker"]
        issues = []
        for epic in ticket_set["epics"]:
            issues.append({
                "ref": epic["ref"], "title": epic["title"], "type": tracker["epic_type"],
                "parent": "", "labels": list(epic["labels"]) + [RUN_LABEL],
                "links": [], "sources_ref": "{0} / {1}".format(ticket_set["run_id"], epic["ref"]),
                "body": epic["body_markdown"],
            })
            for tk in epic["tickets"]:
                issues.append({
                    "ref": tk["ref"], "title": tk["title"], "type": tracker["story_type"],
                    "parent": epic["ref"], "labels": [RUN_LABEL],
                    "links": [{"target": dep} for dep in tk["depends_on"]],
                    "sources_ref": "{0} / {1}".format(ticket_set["run_id"], tk["ref"]),
                    "body": tk["body_markdown"],
                })
        return issues

    def test_match(self):
        approved = posting_set()
        created = self._created_from(approved)
        status, differences = check_readback.compare(approved, created)
        self.assertEqual(status, "match")
        self.assertEqual(differences, [])

    def test_partial_when_one_issue_missing(self):
        approved = posting_set()
        created = [c for c in self._created_from(approved) if c["ref"] != "E2-T2"]
        status, differences = check_readback.compare(approved, created)
        self.assertEqual(status, "partial")
        self.assertTrue(any(d["code"] == "MISSING" for d in differences))

    def test_partial_when_body_differs(self):
        approved = posting_set()
        created = self._created_from(approved)
        for c in created:
            if c["ref"] == "E1-T1":
                c["title"] = "A completely different title"
        status, _ = check_readback.compare(approved, created)
        self.assertEqual(status, "partial")

    def test_mismatch_when_nothing_created(self):
        approved = posting_set()
        status, differences = check_readback.compare(approved, [])
        self.assertEqual(status, "mismatch")
        self.assertTrue(all(d["code"] == "MISSING" for d in differences))

    def test_whitespace_and_list_markers_normalised(self):
        approved = posting_set()
        created = self._created_from(approved)
        for c in created:
            # Reflow whitespace and add a list marker; normalisation should ignore both.
            c["body"] = "  - " + c["body"].replace("\n", "   \n  ") + "   "
        status, _ = check_readback.compare(approved, created)
        self.assertEqual(status, "match")


class ReadbackChangeSetTest(unittest.TestCase):
    """check_readback accepts a refine change set, not only a post-tickets ticket set (TD-12).

    Proves the EDT-10 refine read-back: only the changed fields of the edited ticket (plus any new
    children) are checked, replace needs equality while an append only needs the text present,
    labels and links use subset, and an unrelated live issue is never flagged EXTRA.
    """

    def _change_set(self, changes, new_children=None):
        return {
            "ticket_key": "ABC-1",
            "changes": changes,
            "new_children": new_children or [],
            "digest": "ignored-here",
        }

    def _edited(self, **fields):
        issue = {"ref": "ABC-1", "title": "After summary", "body": "After description.",
                 "labels": [], "parent": "", "links": []}
        issue.update(fields)
        return issue

    def test_full_replace_matches(self):
        change_set = self._change_set([
            {"field": "summary", "before": "Old", "after": "New summary", "op": "replace"},
            {"field": "description", "before": "Old body", "after": "New body", "op": "replace"},
            {"field": "labels", "before": [], "after": ["returns"], "op": "replace"},
            {"field": "parent", "before": "", "after": "EPIC-2", "op": "replace"},
            {"field": "links", "before": [], "after": ["ABC-9"], "op": "replace"},
        ])
        live = [self._edited(title="New summary", body="New body",
                             labels=["returns", "run-DR-1"], parent="EPIC-2",
                             links=[{"target": "ABC-9"}])]
        status, differences = check_readback.compare(change_set, live)
        self.assertEqual(status, "match")
        self.assertEqual(differences, [])

    def test_append_section_only_needs_the_text_present(self):
        change_set = self._change_set([
            {"field": "description", "before": "Keep this.",
             "after": "A new acceptance section.", "op": "append_section"},
        ])
        live = [self._edited(body="Keep this.\n\n## Done when\nA new acceptance section.")]
        status, _ = check_readback.compare(change_set, live)
        self.assertEqual(status, "match")

    def test_append_comment_checks_comments(self):
        change_set = self._change_set([
            {"field": "description", "before": "Rich desc with ![img](a.png).",
             "after": "Extra note.", "op": "append_comment"},
        ])
        live = [self._edited(body="Rich desc with ![img](a.png).",
                             comments=["Extra note."])]
        status, _ = check_readback.compare(change_set, live)
        self.assertEqual(status, "match")

    def test_missing_edited_ticket(self):
        change_set = self._change_set([
            {"field": "summary", "before": "Old", "after": "New summary", "op": "replace"},
        ])
        status, differences = check_readback.compare(change_set, [])
        self.assertEqual(status, "mismatch")
        self.assertTrue(any(d["code"] == "MISSING" for d in differences))

    def test_field_that_did_not_land_is_a_diff(self):
        change_set = self._change_set([
            {"field": "summary", "before": "Old", "after": "New summary", "op": "replace"},
        ])
        live = [self._edited(title="A different summary")]
        status, differences = check_readback.compare(change_set, live)
        self.assertEqual(status, "mismatch")
        self.assertTrue(any(d["code"] == "DIFF" and "summary" in d["message"]
                            for d in differences))

    def test_new_child_present_then_absent(self):
        child = {"title": "Split part two", "parent_epic": "EPIC-2", "link_to": "ABC-1"}
        change_set = self._change_set(
            [{"field": "summary", "before": "Old", "after": "New summary", "op": "replace"}],
            new_children=[child])
        base = self._edited(title="New summary")
        present = [base, {"ref": "ABC-2", "title": "Split part two", "parent": "EPIC-2"}]
        status, _ = check_readback.compare(change_set, present)
        self.assertEqual(status, "match")

        status, differences = check_readback.compare(change_set, [base])
        self.assertEqual(status, "partial")
        self.assertTrue(any(d["code"] == "MISSING" for d in differences))

    def test_unrelated_live_issue_is_not_flagged_extra(self):
        change_set = self._change_set([
            {"field": "summary", "before": "Old", "after": "New summary", "op": "replace"},
        ])
        live = [self._edited(title="New summary"),
                {"ref": "ZZZ-9", "title": "Unrelated ticket", "parent": "EPIC-7"}]
        status, differences = check_readback.compare(change_set, live)
        self.assertEqual(status, "match")
        self.assertFalse(any(d["code"] == "EXTRA" for d in differences))

    def test_snapshot_fields_shape_is_accepted(self):
        change_set = self._change_set([
            {"field": "summary", "before": "Old", "after": "New summary", "op": "replace"},
            {"field": "labels", "before": [], "after": ["returns"], "op": "replace"},
        ])
        live = [{"key": "ABC-1",
                 "fields": {"summary": "New summary", "labels": ["returns"]}}]
        status, _ = check_readback.compare(change_set, live)
        self.assertEqual(status, "match")


class ExportCsvTest(unittest.TestCase):
    def _rows(self):
        text = export_csv.to_csv(posting_set())
        return list(csv.reader(io.StringIO(text)))

    def test_exact_columns(self):
        rows = self._rows()
        self.assertEqual(rows[0], ["Work type", "Work item id", "Summary",
                                   "Description", "Labels", "Parent"])

    def test_epics_before_their_stories(self):
        rows = self._rows()
        ids = [r[1] for r in rows[1:]]
        self.assertLess(ids.index("E1"), ids.index("E1-T1"))
        self.assertLess(ids.index("E2"), ids.index("E2-T1"))
        # The first epic and all its stories come before the second epic.
        self.assertLess(ids.index("E1-T3"), ids.index("E2"))

    def test_story_parent_is_epic_id(self):
        rows = self._rows()
        by_id = {r[1]: r for r in rows[1:]}
        self.assertEqual(by_id["E1-T1"][5], "E1")
        self.assertEqual(by_id["E2-T2"][5], "E2")
        self.assertEqual(by_id["E1"][5], "")

    def test_story_rows_carry_labels(self):
        # TD-20 (PUB-4): a story with labels exports them instead of an empty cell.
        ts = posting_set()
        ts["epics"][0]["tickets"][0]["labels"] = ["returns", "priority"]
        ts = seal(ts)
        rows = list(csv.reader(io.StringIO(export_csv.to_csv(ts))))
        by_id = {r[1]: r for r in rows[1:]}
        self.assertEqual(by_id["E1-T1"][4], "returns priority")

    def test_markdown_export_renders_every_epic_and_story(self):
        # TD-20 (PUB-8): the Markdown export renders every epic and story as a table.
        md = export_csv.to_markdown(posting_set())
        self.assertIn("| Work type | Work item id |", md)
        for ref in ("E1", "E2", "E1-T1", "E1-T2", "E1-T3", "E2-T1", "E2-T2"):
            self.assertIn(ref, md)


class ExternalDependencyTest(unittest.TestCase):
    """TD-14 / INV-1: an external tracker ref in depends_on is a valid dependency; plan_posting
    links to the existing issue by its literal key rather than silently skipping it."""

    def _plan_with_external_dep(self, connector_actions):
        ts = posting_set()
        ts["epics"][0]["tickets"][2]["depends_on"] = ["PROJ-123"]
        ts = seal(ts)
        return plan_posting.build_plan(ts, {"run_label": RUN_LABEL},
                                       {"actions": list(connector_actions)})

    def test_external_dep_links_to_the_literal_key(self):
        plan = self._plan_with_external_dep(("createIssueLink",))
        outs = [op["arguments"]["outward"]
                for op in plan["operations"] if op["kind"] == "link"]
        self.assertIn("PROJ-123", outs)

    def test_external_dep_rendered_by_hand_without_a_link_action(self):
        plan = self._plan_with_external_dep(("createIssue",))
        rendered = {(line["ticket"], line["depends_on"]) for line in plan["depends_on_lines"]}
        self.assertIn(("E1-T3", "PROJ-123"), rendered)


def _run_script(test, module, argv):
    """Run a script file as __main__; return (exit code, stdout, stderr)."""
    out, err = io.StringIO(), io.StringIO()
    with mock.patch.object(sys, "argv", [module.__file__] + list(argv)), \
            contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        with test.assertRaises(SystemExit) as ctx:
            runpy.run_path(module.__file__, run_name="__main__")
    return ctx.exception.code, out.getvalue(), err.getvalue()


def _run_main(module, argv):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = module.main(argv)
    return code, out.getvalue()


class TempDirTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def _json(self, name, data):
        path = os.path.join(self.tmp, name)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(data, handle)
        return path

    def _load(self, name):
        with open(os.path.join(self.tmp, name), encoding="utf-8") as handle:
            return json.load(handle)


class PostingGuardTest(unittest.TestCase):
    """The PUB-5 guards refuse every out-of-order or malformed write with a named reason."""

    def test_unknown_internal_dependency_is_not_linked(self):
        ts = posting_set()
        ts["epics"][0]["tickets"][2]["depends_on"] = ["E9-T9"]
        ts = seal(ts)
        plan = plan_posting.build_plan(ts, {"run_label": RUN_LABEL},
                                       {"actions": ["createIssueLink"]})
        items = [op["item_ref"] for op in plan["operations"] if op["kind"] == "link"]
        self.assertNotIn("E1-T3->E9-T9", items)
        self.assertEqual(len(items), 2)

    def test_plan_digest_tracks_the_operations(self):
        state = fresh_state()
        first = plan_posting.plan_digest(state["plan"])
        self.assertEqual(first, plan_posting.plan_digest(copy.deepcopy(state["plan"])))
        state["plan"]["operations"].pop()
        self.assertNotEqual(first, plan_posting.plan_digest(state["plan"]))

    def test_resolve_requires_a_verified_receipt(self):
        ref = {"$result": {"operation": "create-E1", "path": ["key"]}}
        with self.assertRaises(ValueError) as ctx:
            plan_posting.resolve(ref, {"create-E1": {"status": "uncertain"}})
        self.assertIn("without a verified success receipt", str(ctx.exception))

    def test_resolve_refuses_a_non_scalar_target(self):
        ref = {"$result": {"operation": "create-E1", "path": ["result"]}}
        receipts = {"create-E1": {"status": "created", "result": {"result": {"key": "ABC-1"}}}}
        with self.assertRaises(ValueError) as ctx:
            plan_posting.resolve(ref, receipts)
        self.assertIn("scalar identifier", str(ctx.exception))

    def test_resolve_walks_nested_lists_and_dicts(self):
        receipts = {"create-E1": {"status": "created", "result": {"key": "ABC-1"}}}
        value = {"keys": [{"$result": {"operation": "create-E1", "path": ["key"]}}, "x"], "n": 3}
        self.assertEqual(plan_posting.resolve(value, receipts), {"keys": ["ABC-1", "x"], "n": 3})

    def test_next_operation_needs_a_plan(self):
        state = fresh_state()
        state["plan"] = None
        with self.assertRaises(ValueError) as ctx:
            plan_posting.next_operation(state)
        self.assertIn("No plan yet", str(ctx.exception))

    def test_unknown_operation_id_refused(self):
        state = fresh_state()
        with self.assertRaises(ValueError) as ctx:
            plan_posting.record_receipt(state, "create-E7", {"status": "created"})
        self.assertIn("Unknown operation id: create-E7", str(ctx.exception))

    def test_receipt_status_must_be_known(self):
        state = fresh_state()
        plan_posting.claim(state)
        with self.assertRaises(ValueError) as ctx:
            plan_posting.record_receipt(state, "create-E1", {"status": "done"})
        self.assertIn("must be created, uncertain or not_applied", str(ctx.exception))

    def test_success_needs_a_prior_claim(self):
        state = fresh_state()
        with self.assertRaises(ValueError) as ctx:
            plan_posting.record_receipt(state, "create-E1",
                                        {"status": "created", "result": {"key": "ABC-1"}})
        self.assertIn("Claim the operation", str(ctx.exception))
        self.assertEqual(state["posted"]["issues"], [])

    def test_reconcile_refuses_a_non_uncertain_operation(self):
        state = fresh_state()
        plan_posting.claim(state)
        with self.assertRaises(ValueError) as ctx:
            plan_posting.reconcile(state, "create-E1", [])
        self.assertIn("only to an uncertain operation", str(ctx.exception))

    def test_reconcile_updates_an_existing_posted_row_in_place(self):
        state = fresh_state()
        state["posted"]["issues"].append({"ref": "E1", "issue_key": None, "status": "uncertain"})
        plan_posting.claim(state)
        plan_posting.record_receipt(state, "create-E1", {"status": "uncertain"})
        plan_posting.reconcile(state, "create-E1", [
            {"key": "ABC-5", "labels": ["other-run"], "item_ref": "E1"},
            {"key": "ABC-6", "labels": [RUN_LABEL], "item_ref": "E1"}])
        self.assertEqual(state["posted"]["issues"],
                         [{"ref": "E1", "issue_key": "ABC-6", "status": "created"}])

    def test_all_operations_completed(self):
        state = fresh_state()
        for op in state["plan"]["operations"]:
            state["receipts"][op["id"]] = {"status": "not_applied"}
        with self.assertRaises(ValueError) as ctx:
            plan_posting.next_operation(state)
        self.assertIn("already completed", str(ctx.exception))


class PostingCliTest(TempDirTestCase):
    """plan_posting.py drives the run through its state file: plan, next, claim, record and
    reconcile each print JSON and persist the state; a refusal exits 1 with the reason on stderr."""

    def _state_file(self):
        state = fresh_state()
        state.pop("plan")
        return self._json("state.json", state)

    def test_plan_next_claim_record_round_trip(self):
        path = self._state_file()
        code, out = _run_main(plan_posting, ["plan", "--state", path])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["operations"][0]["id"], "create-E1")
        self.assertEqual(self._load("state.json")["plan"], json.loads(out))

        code, out = _run_main(plan_posting, ["next", "--state", path])
        self.assertEqual((code, json.loads(out)["id"]), (0, "create-E1"))
        self.assertEqual(self._load("state.json")["receipts"], {}, "next must not claim")

        code, out = _run_main(plan_posting, ["claim", "--state", path])
        self.assertEqual(json.loads(out)["id"], "create-E1")
        self.assertEqual(json.loads(out)["action"], "createIssue")
        self.assertEqual(self._load("state.json")["receipts"]["create-E1"]["status"], "in_flight")

        receipt = self._json("receipt.json", {"status": "created", "result": {"key": "ABC-1"}})
        code, out = _run_main(plan_posting, ["record", "--state", path,
                                             "--operation", "create-E1", "--receipt", receipt])
        self.assertEqual((code, json.loads(out)["status"]), (0, "created"))
        posted = self._load("state.json")["posted"]["issues"]
        self.assertEqual(posted, [{"ref": "E1", "issue_key": "ABC-1", "status": "created"}])

    def test_reconcile_with_and_without_tracker_issues(self):
        path = self._state_file()
        _run_main(plan_posting, ["plan", "--state", path])
        _run_main(plan_posting, ["claim", "--state", path])
        receipt = self._json("receipt.json", {"status": "uncertain", "evidence": "timeout"})
        _run_main(plan_posting, ["record", "--state", path,
                                 "--operation", "create-E1", "--receipt", receipt])
        code, out = _run_main(plan_posting, ["reconcile", "--state", path,
                                             "--operation", "create-E1"])
        self.assertEqual((code, json.loads(out)["status"]), (0, "ask_user"))
        issues = self._json("issues.json",
                            [{"key": "ABC-3", "labels": [RUN_LABEL], "item_ref": "E1"}])
        code, out = _run_main(plan_posting, ["reconcile", "--state", path, "--operation",
                                             "create-E1", "--tracker-issues", issues])
        self.assertEqual(json.loads(out)["issue_key"], "ABC-3")
        self.assertTrue(self._load("state.json")["receipts"]["create-E1"]["reconciled"])

    def test_script_refuses_without_a_plan_and_leaves_state(self):
        path = self._state_file()
        before = self._load("state.json")
        code, out, err = _run_script(self, plan_posting, ["claim", "--state", path])
        self.assertEqual((code, out), (1, ""))
        self.assertEqual(json.loads(err),
                         {"ok": False, "error": "No plan yet. Build the plan first."})
        self.assertEqual(self._load("state.json"), before)

    def test_script_next_exits_zero_once_planned(self):
        path = self._state_file()
        _run_main(plan_posting, ["plan", "--state", path])
        code, out, err = _run_script(self, plan_posting, ["next", "--state", path])
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(json.loads(out)["id"], "create-E1")


class ReadbackEdgeTest(TempDirTestCase):
    def _created_from(self, ticket_set):
        return ReadbackTest._created_from(self, ticket_set)

    def test_missing_label_and_link_are_named_diffs(self):
        approved = posting_set()
        created = self._created_from(approved)
        for issue in created:
            if issue["ref"] == "E1":
                issue["labels"] = [RUN_LABEL]
            if issue["ref"] == "E1-T2":
                issue["links"] = []
        status, differences = check_readback.compare(approved, created)
        self.assertEqual(status, "partial")
        by_path = {d["path"]: d for d in differences}
        self.assertEqual(set(by_path), {"E1", "E1-T2"})
        self.assertEqual(by_path["E1"]["code"], "DIFF")
        self.assertTrue(by_path["E1"]["message"].endswith(": labels"))
        self.assertTrue(by_path["E1-T2"]["message"].endswith(": links"))

    def test_extra_created_issue_is_flagged(self):
        approved = posting_set()
        created = self._created_from(approved) + [{"ref": "E3", "title": "stray"}]
        status, differences = check_readback.compare(approved, created)
        self.assertEqual(status, "partial")
        self.assertEqual([d["code"] for d in differences], ["EXTRA"])

    def test_change_set_append_comment_absent_and_unknown_field(self):
        edited = {"ref": "ABC-1", "title": "t", "body": "b", "comments": ["something else"]}
        change_set = {"ticket_key": "ABC-1", "new_children": [], "changes": [
            {"field": "description", "after": "added note", "op": "append_comment"},
            {"field": "description", "after": "added note", "op": "append_section"},
            {"field": "story_points", "after": 3, "op": "replace"}]}
        status, differences = check_readback.compare(change_set, [{"title": "no ref"}, edited])
        self.assertEqual(status, "mismatch")
        self.assertEqual(len(differences), 1)
        self.assertEqual(differences[0]["code"], "DIFF")
        self.assertIn("description, description, story_points", differences[0]["message"])

    def test_cli_exit_codes_follow_the_verdict(self):
        approved = posting_set()
        approved_path = self._json("approved.json", approved)
        created_path = self._json("created.json", self._created_from(approved))
        code, out = _run_main(check_readback, ["--approved", approved_path,
                                               "--created", created_path])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out), {"ok": True, "status": "match", "differences": []})
        empty_path = self._json("empty.json", [])
        code, out, _err = _run_script(self, check_readback, ["--approved", approved_path,
                                                             "--created", empty_path])
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(out)["status"], "mismatch")

    def test_cli_reports_unreadable_input_on_stderr(self):
        missing = os.path.join(self.tmp, "nope.json")
        code, out, err = _run_script(self, check_readback, ["--approved", missing,
                                                            "--created", missing])
        self.assertEqual((code, out), (1, ""))
        self.assertIn("nope.json", json.loads(err)["error"])


class ExportCliTest(TempDirTestCase):
    def test_writes_csv_to_the_out_file(self):
        ts_path = self._json("ts.json", posting_set())
        out_path = os.path.join(self.tmp, "export.csv")
        code, stdout = _run_main(export_csv, ["--ticket-set", ts_path, "--out", out_path])
        self.assertEqual((code, stdout), (0, ""))
        with open(out_path, encoding="utf-8", newline="") as handle:
            self.assertEqual(handle.read(), export_csv.to_csv(posting_set()))

    def test_markdown_to_stdout(self):
        ts_path = self._json("ts.json", posting_set())
        code, stdout = _run_main(export_csv, ["--ticket-set", ts_path, "--format", "markdown"])
        self.assertEqual(code, 0)
        self.assertEqual(stdout, export_csv.to_markdown(posting_set()))

    def test_markdown_cells_escape_pipes_and_newlines(self):
        ts = posting_set()
        ts["epics"][0]["title"] = "Refunds | returns"
        ts["epics"][0]["body_markdown"] = "line one\nline two"
        md = export_csv.render(ts, "markdown")
        self.assertIn("Refunds \\| returns", md)
        self.assertIn("line one line two", md)
        self.assertEqual(export_csv.render(ts, "csv"), export_csv.to_csv(ts))

    def test_script_exits_zero_and_one(self):
        ts_path = self._json("ts.json", posting_set())
        code, out, err = _run_script(self, export_csv, ["--ticket-set", ts_path])
        self.assertEqual((code, err), (0, ""))
        self.assertTrue(out.startswith("Work type,Work item id,Summary"))
        code, out, err = _run_script(self, export_csv, ["--ticket-set",
                                                        os.path.join(self.tmp, "missing.json")])
        self.assertEqual((code, out), (1, ""))
        self.assertIn('"ok": false', err)
        self.assertIn("missing.json", err)


EXISTING_KEY = "ABC-7"
LIVE_TITLE = "Clearer orders"
GOOD_READ = {"status": "read", "result": {
    "key": EXISTING_KEY, "issuetype": "Epic", "project": "ABC", "summary": LIVE_TITLE,
    "status": "In Progress", "done": False}}


def mixed_set():
    """posting_set with E1 a new epic and E2 an epic that already exists in the tracker."""
    ts = posting_set()
    epic = ts["epics"][1]
    epic.update(existing_key=EXISTING_KEY, title=LIVE_TITLE, body_markdown="", labels=[])
    return seal(ts)


def existing_state(ticket_set=None, approved=True):
    ts = ticket_set or mixed_set()
    state = {
        "ticket_set": ts, "setup": {"run_label": RUN_LABEL},
        "connector": {"actions": ["createIssueLink"]}, "approval": None,
        "receipts": {}, "posted": {"issues": [], "read_back": {}},
    }
    state["plan"] = plan_posting.build_plan(ts, state["setup"], state["connector"])
    if approved:
        state["approval"] = {"digest": plan_posting.current_digest(ts),
                             "message_ref": "msg-42: post it"}
    return state


def read_with(**changes):
    receipt = copy.deepcopy(GOOD_READ)
    receipt["result"].update(changes)
    return receipt


def _sha(text):
    import hashlib
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class UnchangedOutputTest(unittest.TestCase):
    """Spec AC-46, INV-12: for a set without existing_key the plan, both exports and the read-back
    are byte for byte what they were before existing epics were supported. The hashes were taken
    from the scripts as they stood before the change."""

    def test_ac_46_plan_exports_and_read_back_are_byte_identical_for_new_epics(self):
        ts = posting_set()
        plan = plan_posting.build_plan(ts, {"run_label": RUN_LABEL}, {"actions": ["createIssueLink"]})
        self.assertEqual(_sha(json.dumps(plan, indent=2, ensure_ascii=False)),
                         "897d72080236367bc66ea21061710afd8e0e51f572de9ae98ea3132f622744f0")
        self.assertEqual(_sha(export_csv.to_csv(ts)),
                         "4485841c80c226dae31aa0650b4469394d57d9b20116d2fd3b547d04d2e157b2")
        self.assertEqual(_sha(export_csv.to_markdown(ts)),
                         "83f2420848764b0c3a601091156dd783d16cf1b19b1d87642a7bc21185ab3c74")
        self.assertEqual(_sha(json.dumps(check_readback.compare(ts, []), sort_keys=True)),
                         "db3fcd37947596dd87372fd7f977f9ba6616c96ebd680973d214fb4758cca83a")
        self.assertEqual(export_csv.export_note(ts), "")


class ExistingEpicPlanTest(unittest.TestCase):
    """Spec AC-29 (REQUIREMENTS AC-83): no create for the existing epic, verify first, the literal
    key as parent. FR-57, NFR-2: the only operation on the existing key is the read."""

    def setUp(self):
        self.plan = plan_posting.build_plan(mixed_set(), {"run_label": RUN_LABEL},
                                            {"actions": ["createIssueLink"]})
        self.ops = self.plan["operations"]
        self.ids = [op["id"] for op in self.ops]

    def test_ac_29_verify_comes_first_and_the_epic_is_never_created(self):
        self.assertEqual(self.ids[0], "verify-E2")
        self.assertNotIn("create-E2", self.ids)
        self.assertIn("create-E1", self.ids)
        verify = self.ops[0]
        self.assertEqual((verify["action"], verify["kind"], verify["item_ref"]),
                         ("readIssue", "verify", "E2"))
        self.assertEqual(verify["arguments"], {"key": EXISTING_KEY})
        self.assertEqual(verify["expect"], {"project": "ABC", "issuetype": "Epic"})

    def test_ac_29_tickets_carry_the_literal_key_as_parent_and_the_run_label(self):
        by_id = {op["id"]: op for op in self.ops}
        for ref in ("E2-T1", "E2-T2"):
            arguments = by_id["create-" + ref]["arguments"]
            self.assertEqual(arguments["parent"], EXISTING_KEY)
            self.assertEqual(arguments["labels"], ["paqad-discovery", RUN_LABEL])
        self.assertEqual(by_id["create-E1-T1"]["arguments"]["parent"],
                         {"$result": {"operation": "create-E1", "path": ["key"]}})

    def test_ac_29_read_back_keys_leave_the_existing_epic_out(self):
        keys = self.ops[-1]["arguments"]["keys"]
        operations = [key["$result"]["operation"] for key in keys]
        self.assertEqual(operations, ["create-E1", "create-E1-T1", "create-E1-T2", "create-E1-T3",
                                      "create-E2-T1", "create-E2-T2"])

    def test_no_write_operation_ever_targets_the_existing_key(self):
        on_key = [op for op in self.ops if op["arguments"].get("key") == EXISTING_KEY]
        self.assertEqual([op["id"] for op in on_key], ["verify-E2"])
        for op in self.ops:
            if op["kind"] == "verify":
                continue
            self.assertNotIn(op["action"], ("readIssue",))
            arguments = dict(op["arguments"])
            if op["kind"] == "story":
                arguments.pop("parent")
            self.assertNotIn(EXISTING_KEY, json.dumps([arguments, op["id"], op["item_ref"]]), op["id"])
            self.assertNotEqual(op["arguments"].get("summary"), LIVE_TITLE, op["id"])

    def test_a_dependency_on_the_existing_epic_is_refused_not_linked(self):
        ts = mixed_set()
        ts["epics"][0]["tickets"][0]["depends_on"] = [EXISTING_KEY]
        with self.assertRaises(ValueError) as ctx:
            plan_posting.build_plan(seal(ts), {"run_label": RUN_LABEL}, {"actions": []})
        self.assertIn("An existing epic is never linked", str(ctx.exception))

    def test_every_verify_runs_before_the_first_create_in_a_mixed_run(self):
        ts = mixed_set()
        ts["epics"].insert(0, {"ref": "E3", "title": "Returns", "existing_key": "ABC-9",
                               "body_markdown": "", "labels": [],
                               "tickets": [ticket("E3-T1", "start a return")]})
        plan = plan_posting.build_plan(seal(ts), {"run_label": RUN_LABEL}, {})
        kinds = [op["kind"] for op in plan["operations"]]
        self.assertEqual(kinds[:2], ["verify", "verify"])
        self.assertNotIn("verify", kinds[2:])


class ExistingEpicRunTest(unittest.TestCase):
    """Spec AC-30, AC-31, AC-32 (REQUIREMENTS AC-103 to AC-105): the verify gate."""

    def creates(self, state):
        return [op_id for op_id, receipt in state["receipts"].items()
                if op_id.startswith("create-") and receipt.get("status") == "created"]

    def test_ac_29_full_run_posts_under_the_existing_epic_and_shows_it_not_changed(self):
        state = existing_state()
        op, _arguments = plan_posting.next_operation(state)
        self.assertEqual(op["id"], "verify-E2")
        stored = plan_posting.record_receipt(state, "verify-E2", GOOD_READ)
        self.assertEqual(stored["status"], "verified")
        order, number = [], 0
        while True:
            try:
                claimed = plan_posting.claim(state)
            except ValueError:
                break
            order.append(claimed["id"])
            if claimed["id"] == "read-back":
                plan_posting.record_receipt(state, "read-back", {"status": "not_applied"})
                continue
            if claimed["id"].startswith("create-E2-"):
                self.assertEqual(claimed["arguments"]["parent"], EXISTING_KEY)
            number += 1
            plan_posting.record_receipt(state, claimed["id"], {
                "status": "created", "result": {"key": "ABC-{0}".format(100 + number)}})
        self.assertNotIn("verify-E2", order)
        posted = {row["ref"]: row for row in state["posted"]["issues"]}
        self.assertEqual(posted["E2"], {"ref": "E2", "issue_key": EXISTING_KEY,
                                        "status": "not changed"})
        created = [ref for ref, row in posted.items() if row["status"] == "created"]
        self.assertEqual(sorted(created), ["E1", "E1-T1", "E1-T2", "E1-T3", "E2-T1", "E2-T2"])

    def test_ac_30_each_failed_check_blocks_every_create_and_leaves_posted_empty(self):
        cases = (
            ({"status": "not_found"}, "exists", "the issue was not found"),
            (read_with(issuetype="Story"), "epic_type", "not of the epic type Epic"),
            (read_with(project="XYZ", key="XYZ-7"), "project_key", "not in project ABC"),
        )
        for receipt, check, words in cases:
            state = existing_state()
            stored = plan_posting.record_receipt(state, "verify-E2", receipt)
            self.assertEqual((stored["status"], stored["failed_check"]), ("verify_failed", check))
            with self.assertRaises(ValueError) as ctx:
                plan_posting.claim(state)
            self.assertIn(words, str(ctx.exception))
            self.assertIn("Pick another epic or a new epic, or leave by export", str(ctx.exception))
            self.assertEqual(self.creates(state), [], check)
            self.assertEqual(state["posted"]["issues"], [], check)

    def test_a_failed_read_is_could_not_check_and_never_a_missing_epic(self):
        for receipt in ({"status": "read_failed", "reason": "timed out"},
                        {"status": "read_failed", "reason": "permission refused"},
                        {"status": "read"}, {"status": "read", "result": "garbled"}, {}):
            state = existing_state()
            stored = plan_posting.record_receipt(state, "verify-E2", receipt)
            self.assertEqual((stored["status"], stored["failed_check"]), ("verify_failed", "read"))
            self.assertIn("Could not check the epic ABC-7: the read itself failed",
                          stored["message"])
            self.assertNotIn("not found", stored["message"])
            with self.assertRaises(ValueError):
                plan_posting.next_operation(state)
            self.assertEqual(state["posted"]["issues"], [])

    def test_a_failed_verify_can_be_read_again_and_then_passes(self):
        state = existing_state()
        plan_posting.record_receipt(state, "verify-E2", {"status": "read_failed"})
        stored = plan_posting.record_receipt(state, "verify-E2", GOOD_READ)
        self.assertEqual(stored["status"], "verified")
        self.assertEqual(plan_posting.next_operation(state)[0]["id"], "create-E1")

    def test_a_verify_is_a_read_and_needs_no_approval_or_claim(self):
        state = existing_state(approved=False)
        self.assertEqual(plan_posting.record_receipt(state, "verify-E2", GOOD_READ)["status"],
                         "verified")
        with self.assertRaises(ValueError) as ctx:
            plan_posting.next_operation(state)
        self.assertIn("No approval", str(ctx.exception))

    def test_a_claimed_verify_is_in_flight_until_its_read_is_recorded(self):
        state = existing_state()
        self.assertEqual(plan_posting.claim(state)["id"], "verify-E2")
        with self.assertRaises(ValueError) as ctx:
            plan_posting.next_operation(state)
        self.assertIn("Reconcile the pending operation", str(ctx.exception))
        plan_posting.record_receipt(state, "verify-E2", GOOD_READ)
        self.assertEqual(plan_posting.next_operation(state)[0]["id"], "create-E1")

    def test_ac_31_done_epic_asks_first_and_a_no_creates_nothing(self):
        state = existing_state()
        stored = plan_posting.record_receipt(state, "verify-E2", read_with(done=True, status="Done"))
        self.assertEqual(stored["status"], "needs_confirmation")
        with self.assertRaises(ValueError) as ctx:
            plan_posting.claim(state)
        self.assertIn("Ask before posting under it", str(ctx.exception))
        declined = read_with(done=True)
        declined["done_confirmed"] = False
        stored = plan_posting.record_receipt(state, "verify-E2", declined)
        self.assertEqual(stored["status"], "declined")
        with self.assertRaises(ValueError) as ctx:
            plan_posting.claim(state)
        self.assertIn("Go back to where the tickets should go", str(ctx.exception))
        self.assertEqual(self.creates(state), [])
        self.assertEqual(state["posted"]["issues"], [])

    def test_ac_31_a_yes_is_recorded_so_a_retry_does_not_ask_again(self):
        state = existing_state()
        confirmed = read_with(done=True)
        confirmed["done_confirmed"] = True
        self.assertEqual(plan_posting.record_receipt(state, "verify-E2", confirmed)["status"],
                         "verified")
        self.assertEqual(state["confirmed_done"], [EXISTING_KEY])
        again = plan_posting.record_receipt(state, "verify-E2", read_with(done=True))
        self.assertEqual((again["status"], again["done_confirmed"]), ("verified", True))
        self.assertEqual(state["confirmed_done"], [EXISTING_KEY])
        self.assertEqual(plan_posting.next_operation(state)[0]["id"], "create-E1")

    def test_ac_32_a_changed_title_is_reported_and_is_not_a_failed_check(self):
        state = existing_state()
        stored = plan_posting.record_receipt(state, "verify-E2", read_with(summary="Order history"))
        self.assertEqual(stored["status"], "verified")
        self.assertEqual(stored["title_changed"], {"from": LIVE_TITLE, "to": "Order history"})
        same = plan_posting.record_receipt(state, "verify-E2", GOOD_READ)
        self.assertNotIn("title_changed", same)

    def test_a_refused_first_create_under_the_existing_epic_stops_the_run(self):
        state = existing_state()
        plan_posting.record_receipt(state, "verify-E2", GOOD_READ)
        for op in state["plan"]["operations"]:
            if op["id"].startswith("create-E1"):
                state["receipts"][op["id"]] = {"status": "created", "result": {"key": "ABC-50"}}
        self.assertEqual(plan_posting.claim(state)["id"], "create-E2-T1")
        plan_posting.record_receipt(state, "create-E2-T1", {"status": "not_applied"})
        with self.assertRaises(ValueError) as ctx:
            plan_posting.claim(state)
        self.assertIn("could not be created under ABC-7", str(ctx.exception))
        self.assertNotIn("create-E2-T2", state["receipts"])

    def test_a_lost_reply_under_the_existing_epic_reconciles_without_a_second_copy(self):
        state = existing_state()
        plan_posting.record_receipt(state, "verify-E2", GOOD_READ)
        for op in state["plan"]["operations"]:
            if op["id"].startswith("create-E1"):
                state["receipts"][op["id"]] = {"status": "created", "result": {"key": "ABC-50"}}
        plan_posting.claim(state)
        plan_posting.record_receipt(state, "create-E2-T1", {"status": "uncertain"})
        plan_posting.record_receipt(state, "verify-E2", GOOD_READ)
        found = [{"key": "ABC-61", "labels": [RUN_LABEL], "item_ref": "E2-T1", "parent": EXISTING_KEY}]
        out = plan_posting.reconcile(state, "create-E2-T1", found)
        self.assertEqual((out["status"], out["duplicate_created"]), ("created", False))
        rows = {row["ref"]: row["status"] for row in state["posted"]["issues"]}
        self.assertEqual(rows, {"E2": "not changed", "E2-T1": "created"})


class ExistingEpicReadbackTest(unittest.TestCase):
    """Spec AC-33 (REQUIREMENTS AC-106): one set with a new epic E1 and an existing epic E2."""

    def created(self, ticket_set):
        tracker = ticket_set["tracker"]
        issues = []
        for epic in ticket_set["epics"]:
            existing = epic.get("existing_key")
            if not existing:
                issues.append({
                    "ref": epic["ref"], "title": epic["title"], "type": tracker["epic_type"],
                    "parent": "", "labels": list(epic["labels"]) + [RUN_LABEL], "links": [],
                    "sources_ref": "{0} / {1}".format(ticket_set["run_id"], epic["ref"]),
                    "body": epic["body_markdown"]})
            for tk in epic["tickets"]:
                issues.append({
                    "ref": tk["ref"], "title": tk["title"], "type": tracker["story_type"],
                    "parent": existing or epic["ref"], "labels": [RUN_LABEL],
                    "links": [{"target": dep} for dep in tk["depends_on"]],
                    "sources_ref": "{0} / {1}".format(ticket_set["run_id"], tk["ref"]),
                    "body": tk["body_markdown"]})
        return issues

    def test_ac_33_new_epic_expected_existing_epic_neither_missing_nor_extra(self):
        approved = mixed_set()
        expected = check_readback.expected_items(approved)
        self.assertIn("E1", expected)
        self.assertNotIn("E2", expected)
        self.assertEqual(expected["E2-T1"]["parent"], "abc-7")
        self.assertEqual(expected["E1-T1"]["parent"], "e1")
        self.assertEqual(check_readback.compare(approved, self.created(approved)), ("match", []))

    def test_ac_33_existing_epic_in_the_read_back_is_never_extra(self):
        approved = mixed_set()
        for ref in ("E2", EXISTING_KEY):
            created = self.created(approved) + [{"ref": ref, "title": "Someone renamed it",
                                                 "type": "Epic", "labels": ["other"]}]
            self.assertEqual(check_readback.compare(approved, created), ("match", []), ref)

    def test_ac_33_a_ticket_with_a_different_parent_is_flagged(self):
        approved = mixed_set()
        created = self.created(approved)
        for issue in created:
            if issue["ref"] == "E2-T1":
                issue["parent"] = "ABC-8"
        status, differences = check_readback.compare(approved, created)
        self.assertEqual(status, "partial")
        self.assertEqual([(d["code"], d["path"]) for d in differences], [("DIFF", "E2-T1")])
        self.assertIn("parent", differences[0]["message"])

    def test_ac_32_read_back_accepts_the_key_the_tracker_returns_for_the_same_epic(self):
        approved = mixed_set()
        created = self.created(approved)
        for issue in created:
            if issue["parent"] == EXISTING_KEY:
                issue["parent"] = " abc-7 "
        self.assertEqual(check_readback.compare(approved, created), ("match", []))

    def test_a_missing_new_epic_is_still_missing_and_an_unknown_issue_still_extra(self):
        approved = mixed_set()
        created = [issue for issue in self.created(approved) if issue["ref"] != "E1"]
        created.append({"ref": "ZZ-1", "title": "Stray"})
        codes = sorted((d["code"], d["path"]) for d in check_readback.compare(approved, created)[1])
        self.assertEqual(codes, [("EXTRA", "ZZ-1"), ("MISSING", "E1")])


class ExistingEpicExportTest(TempDirTestCase):
    """Spec AC-29 and AC-33: CSV and Markdown share rows(), with no row for the existing epic."""

    def test_ac_33_csv_has_an_e1_row_no_e2_row_and_the_real_key_as_parent(self):
        rows = list(csv.DictReader(io.StringIO(export_csv.to_csv(mixed_set()))))
        ids = [row["Work item id"] for row in rows]
        self.assertEqual(ids, ["E1", "E1-T1", "E1-T2", "E1-T3", "E2-T1", "E2-T2"])
        parents = {row["Work item id"]: row["Parent"] for row in rows}
        self.assertEqual(parents["E1-T1"], "E1")
        self.assertEqual((parents["E2-T1"], parents["E2-T2"]), (EXISTING_KEY, EXISTING_KEY))
        for row in rows:
            self.assertFalse(any(str(cell).startswith(LIVE_TITLE) for cell in row.values()))

    def test_ac_33_markdown_has_the_same_rows(self):
        table = export_csv.to_markdown(mixed_set()).splitlines()[2:]
        self.assertEqual([line.split(" | ")[1] for line in table],
                         ["E1", "E1-T1", "E1-T2", "E1-T3", "E2-T1", "E2-T2"])
        self.assertTrue(table[-1].endswith("| ABC-7 |"))

    def test_ac_29_export_note_names_the_key_and_the_rows_that_hold_it(self):
        note = export_csv.export_note(mixed_set())
        self.assertEqual(
            note,
            "Parent holds the existing epic key ABC-7. If your importer does not accept it, set "
            "the parent with a bulk edit after the import. Rows with this key: E2-T1, E2-T2.\n")

    def test_cli_prints_the_note_and_nothing_for_a_set_of_new_epics(self):
        path = self._json("mixed.json", mixed_set())
        code, out = _run_main(export_csv, ["--ticket-set", path, "--note"])
        self.assertEqual(code, 0)
        self.assertIn("Parent holds the existing epic key ABC-7.", out)
        path = self._json("new.json", posting_set())
        self.assertEqual(_run_main(export_csv, ["--ticket-set", path, "--note"]), (0, ""))


class ExistingEpicCliTest(TempDirTestCase):
    """The host records its read of the existing epic as JSON through the record command."""

    def test_plan_then_record_the_read_then_the_first_create(self):
        state = existing_state()
        state.pop("plan")
        path = self._json("state.json", state)
        code, out = _run_main(plan_posting, ["plan", "--state", path])
        self.assertEqual(json.loads(out)["operations"][0]["id"], "verify-E2")
        code, out = _run_main(plan_posting, ["next", "--state", path])
        self.assertEqual(json.loads(out), {"id": "verify-E2", "action": "readIssue",
                                           "arguments": {"key": EXISTING_KEY}})
        receipt = self._json("read.json", GOOD_READ)
        code, out = _run_main(plan_posting, ["record", "--state", path,
                                             "--operation", "verify-E2", "--receipt", receipt])
        self.assertEqual((code, json.loads(out)["status"]), (0, "verified"))
        self.assertEqual(self._load("state.json")["posted"]["issues"],
                         [{"ref": "E2", "issue_key": EXISTING_KEY, "status": "not changed"}])
        code, out = _run_main(plan_posting, ["next", "--state", path])
        self.assertEqual(json.loads(out)["id"], "create-E1")


if __name__ == "__main__":
    unittest.main()
