#!/usr/bin/env python3
"""Unit tests for skills/refine-ticket/scripts/diff_ticket.py.

Standard library only (Python 3.9+). No network. Writes nothing outside a temporary folder.

Proves:
  AC-31  a live ticket updated after the snapshot is flagged as a conflict and the whole change set
         is withheld (diff_ticket conflict detection).
  AC-32  a description holding rich content (an image and a panel) never gets a Markdown replace;
         the op is append_section or append_comment and the op reports which (rich-content guard).
  AC-33  a split carries new linked children under the same epic and keeps the original ticket.
  AC-34  editing the approved change set changes its digest, voiding a digest-bound approval, and
         the embedded digest is canonical.digest over the set with digest excluded.
  EDT-4  a proposed change to a field outside the allowed five is refused (field-limit guard).
  EDT-9  the change set never emits a delete or a close; every op is one of the three allowed ops.
"""

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
SHARED_SCRIPTS = os.path.join(REPO_ROOT, "shared", "scripts")
REFINE_SCRIPTS = os.path.join(REPO_ROOT, "skills", "refine-ticket", "scripts")
for entry in (SHARED_SCRIPTS, REFINE_SCRIPTS):
    if entry not in sys.path:
        sys.path.insert(0, entry)

import canonical  # noqa: E402
import diff_ticket  # noqa: E402


def snapshot(description="Plain text description.", last_updated="2026-10-05T10:00:00+00:00"):
    return {
        "key": "ABC-1",
        "fields": {
            "summary": "Old summary",
            "description": description,
            "labels": ["returns"],
            "parent": "EPIC-9",
            "links": ["ABC-2"],
        },
        "last_updated": last_updated,
    }


def proposed(**fields):
    base = {"ticket_key": "ABC-1", "fields": fields}
    return base


class ConflictTest(unittest.TestCase):
    def test_live_newer_than_snapshot_flags_conflict_and_withholds(self):
        # AC-31
        snap = snapshot(last_updated="2026-10-05T10:00:00+00:00")
        live = {"last_updated": "2026-10-05T12:30:00+00:00"}
        result, code = diff_ticket.run(snap, proposed(summary="New summary"), live)
        self.assertEqual(code, 1)
        self.assertTrue(result["conflict"])
        self.assertIsNone(result["change_set"])
        self.assertTrue(any(i["code"] == "CONFLICT" for i in result["issues"]))

    def test_live_not_newer_is_clean(self):
        snap = snapshot(last_updated="2026-10-05T10:00:00+00:00")
        live = {"last_updated": "2026-10-05T10:00:00+00:00"}
        result, code = diff_ticket.run(snap, proposed(summary="New summary"), live)
        self.assertEqual(code, 0)
        self.assertFalse(result["conflict"])
        self.assertIsNotNone(result["change_set"])


class RichContentGuardTest(unittest.TestCase):
    def test_image_and_panel_force_append_not_replace(self):
        # AC-32: current description holds an image and a panel.
        rich = "Intro\n![diagram](media.png)\n{panel}Watch out{panel}\nMore text"
        self.assertEqual(
            set(diff_ticket.rich_markers(rich)) & {"image", "panel"}, {"image", "panel"})
        snap = snapshot(description=rich)
        result, code = diff_ticket.run(
            snap, proposed(description="A clean rewritten description."))
        self.assertEqual(code, 0)
        change = next(c for c in result["change_set"]["changes"] if c["field"] == "description")
        self.assertNotEqual(change["op"], "replace")
        self.assertIn(change["op"], ("append_section", "append_comment"))
        # The op itself reports which was used, and an issue documents the guard.
        self.assertTrue(any(i["code"] == "RICH_CONTENT_GUARD" for i in result["issues"]))

    def test_comment_mode_selects_append_comment(self):
        rich = "See [~accountid:123] and the table colspan=2 here."
        snap = snapshot(description=rich)
        proposed_doc = proposed(description="Rewrite")
        proposed_doc["description_mode"] = "comment"
        result, _ = diff_ticket.run(snap, proposed_doc)
        change = next(c for c in result["change_set"]["changes"] if c["field"] == "description")
        self.assertEqual(change["op"], "append_comment")

    def test_plain_description_replaces_normally(self):
        snap = snapshot(description="Just plain prose, nothing rich.")
        result, _ = diff_ticket.run(snap, proposed(description="New prose."))
        change = next(c for c in result["change_set"]["changes"] if c["field"] == "description")
        self.assertEqual(change["op"], "replace")


class SplitStructureTest(unittest.TestCase):
    def test_split_adds_linked_children_under_same_epic_and_keeps_original(self):
        # AC-33
        snap = snapshot()
        proposed_doc = proposed(summary="Narrowed parent story")
        proposed_doc["new_children"] = [
            {"title": "Piece one", "parent_epic": "EPIC-9", "link_to": "ABC-1"},
            {"title": "Piece two", "parent_epic": "EPIC-9", "link_to": "ABC-1"},
            {"title": "Piece three", "parent_epic": "EPIC-9", "link_to": "ABC-1"},
        ]
        result, code = diff_ticket.run(snap, proposed_doc)
        self.assertEqual(code, 0)
        children = result["change_set"]["new_children"]
        self.assertEqual(len(children), 3)
        self.assertTrue(all(c["parent_epic"] == "EPIC-9" for c in children))
        self.assertTrue(all(c["link_to"] == "ABC-1" for c in children))
        # The original ticket is kept: no change entry removes or closes it.
        ops = [c["op"] for c in result["change_set"]["changes"]]
        self.assertNotIn("delete", ops)
        self.assertNotIn("close", ops)


class DigestTest(unittest.TestCase):
    def test_edit_changes_digest_voiding_approval(self):
        # AC-34
        snap = snapshot()
        result_a, _ = diff_ticket.run(snap, proposed(summary="Summary A"))
        result_b, _ = diff_ticket.run(snap, proposed(summary="Summary B"))
        self.assertNotEqual(
            result_a["change_set"]["digest"], result_b["change_set"]["digest"])

    def test_digest_is_canonical_over_set_minus_digest(self):
        snap = snapshot()
        result, _ = diff_ticket.run(snap, proposed(summary="A new summary"))
        change_set = result["change_set"]
        recomputed = canonical.digest(
            {k: v for k, v in change_set.items() if k != "digest"})
        self.assertEqual(change_set["digest"], recomputed)


class FieldLimitTest(unittest.TestCase):
    def test_field_outside_the_allowed_five_is_refused(self):
        # EDT-4
        snap = snapshot()
        bad = proposed(summary="ok")
        bad["fields"]["status"] = "Done"  # not an allowed field
        result, code = diff_ticket.run(snap, bad)
        self.assertEqual(code, 1)
        self.assertIsNone(result["change_set"])
        self.assertTrue(any(i["code"] == "FIELD_NOT_ALLOWED" for i in result["issues"]))


class NoDeleteOrCloseTest(unittest.TestCase):
    def test_every_emitted_op_is_an_allowed_op(self):
        # EDT-9
        snap = snapshot(description="![img](a.png) {panel}p{panel}")
        proposed_doc = proposed(
            summary="New", description="rewrite", labels=["a", "b"], parent="EPIC-2",
            links=["ABC-5"])
        result, _ = diff_ticket.run(snap, proposed_doc)
        for change in result["change_set"]["changes"]:
            self.assertIn(change["op"], diff_ticket.ALLOWED_OPS)


if __name__ == "__main__":
    unittest.main()
