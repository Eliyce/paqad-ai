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

import copy
import csv
import io
import os
import sys
import unittest

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


if __name__ == "__main__":
    unittest.main()
