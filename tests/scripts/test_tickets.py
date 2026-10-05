#!/usr/bin/env python3
"""Unit tests for check_prose.py and check_ticket_set.py.

Standard library only (Python 3.9+). No network. Writes only under a temporary folder.

check_prose proves AC-8: a draft with an em dash and a function name is blocked, fixes are
proposed, and the corrected set passes; quoted, code and URL content is never rewritten; and a
deny-list jargon term is flagged with its plain replacement (TKT-3).

check_ticket_set proves the structure checks (8.5): a valid set passes, and every failure mode
is caught: a stale digest, an empty epic, a ticket under two epics, a done_when out of range,
duplicate titles, a dangling depends_on, and a dependency cycle.
"""

import copy
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
SHARED_SCRIPTS = os.path.join(REPO_ROOT, "shared", "scripts")
CHECK_TICKETS_SCRIPTS = os.path.join(REPO_ROOT, "skills", "check-tickets", "scripts")
for entry in (SHARED_SCRIPTS, CHECK_TICKETS_SCRIPTS):
    if entry not in sys.path:
        sys.path.insert(0, entry)

import canonical  # noqa: E402
import check_prose  # noqa: E402
import check_ticket_set  # noqa: E402

DENYLIST_PATH = os.path.join(REPO_ROOT, "shared", "references", "plain-language.md")
DENYLIST = check_prose.load_denylist(DENYLIST_PATH)


def seal(ticket_set):
    """Recompute and store the digest so the set is internally consistent."""
    ticket_set = copy.deepcopy(ticket_set)
    ticket_set["digest"] = canonical.digest(
        {k: v for k, v in ticket_set.items() if k != "digest"})
    return ticket_set


def valid_set():
    ticket_set = {
        "run_id": "DR-20261005-7K2Q",
        "revision": 1,
        "digest": "",
        "tracker": {"kind": "jira", "project_key": "ABC",
                    "epic_type": "Epic", "story_type": "Story"},
        "epics": [
            {
                "ref": "E1",
                "title": "Faster refunds for members",
                "body_markdown": "## Goal\nHelp members get their refunds faster.",
                "labels": ["paqad-discovery"],
                "tickets": [
                    {
                        "ref": "E1-T1",
                        "title": "Show refund status",
                        "body_markdown": "## What they need and why\nMembers want to see where their refund is.",
                        "done_when": ["A member can see the refund status",
                                      "The status updates within a day"],
                        "depends_on": [],
                        "assignee_hint": None,
                    },
                    {
                        "ref": "E1-T2",
                        "title": "Notify a member when a refund is sent",
                        "body_markdown": "## What they need and why\nMembers want to be told.",
                        "done_when": ["A member is told when the refund is sent",
                                      "The message is in plain words"],
                        "depends_on": ["E1-T1"],
                        "assignee_hint": None,
                    },
                ],
            },
            {
                "ref": "E2",
                "title": "Clearer order history",
                "body_markdown": "## Goal\nMake past orders easy to find.",
                "labels": [],
                "tickets": [
                    {
                        "ref": "E2-T1",
                        "title": "Search past orders",
                        "body_markdown": "## What they need and why\nMembers want to find an old order.",
                        "done_when": ["A member can search their orders",
                                      "Results come back quickly"],
                        "depends_on": [],
                        "assignee_hint": None,
                    },
                ],
            },
        ],
    }
    return seal(ticket_set)


class CheckProseTest(unittest.TestCase):
    def _codes(self, issues):
        return sorted({i["code"] for i in issues})

    def test_em_dash_and_function_name_blocked_with_fixes(self):
        # AC-8: a draft with an em dash and a function name is blocked and fixes are proposed.
        bad = {
            "epics": [{
                "ref": "E1", "title": "Refunds", "body_markdown": "## Goal\nHelp members.",
                "tickets": [{
                    "ref": "E1-T1",
                    "title": "Export orders via exportOrders() right now \u2014 fast",
                    "body_markdown": "## What they need and why\nMembers want their orders.",
                    "done_when": ["A member can export their orders",
                                  "The file downloads"],
                    "depends_on": [], "assignee_hint": None,
                }],
            }],
        }
        issues = check_prose.lint_ticket_set(bad, DENYLIST)
        self.assertTrue(issues, "A draft with a dash and a function name must be blocked.")
        self.assertIn("TKT1", self._codes(issues))  # the em dash
        self.assertIn("TKT2", self._codes(issues))  # the function name
        # Every finding proposes a fix.
        self.assertTrue(all(i.get("suggestion") for i in issues))
        # The findings point at the offending field.
        self.assertTrue(any("E1-T1" in i["path"] for i in issues))

    def test_fixed_set_passes(self):
        # The same ticket, rewritten in plain words with a hyphen, passes cleanly.
        fixed = {
            "epics": [{
                "ref": "E1", "title": "Refunds", "body_markdown": "## Goal\nHelp members.",
                "tickets": [{
                    "ref": "E1-T1",
                    "title": "Let members download their orders",
                    "body_markdown": "## What they need and why\nMembers want their orders.",
                    "done_when": ["A member can download their orders",
                                  "The file downloads to their device"],
                    "depends_on": [], "assignee_hint": None,
                }],
            }],
        }
        self.assertEqual(check_prose.lint_ticket_set(fixed, DENYLIST), [])

    def test_quoted_code_and_url_content_not_rewritten(self):
        # TKT-1 and TKT-3 skip blockquotes, fenced code and URLs so evidence is never rewritten.
        quoted = {
            "epics": [{
                "ref": "E1", "title": "Refunds", "body_markdown": "## Goal\nHelp members.",
                "tickets": [{
                    "ref": "E1-T1",
                    "title": "Let members download their orders",
                    "body_markdown": (
                        "## What they need and why\n"
                        "> The old ticket said leverage the synergy \u2014 verbatim.\n"
                        "```\nleverage \u2014 synergy\n```\n"
                        "See https://example.com/a\u2014b-leverage for the source.\n"),
                    "done_when": ["A member can download their orders",
                                  "The file downloads to their device"],
                    "depends_on": [], "assignee_hint": None,
                }],
            }],
        }
        self.assertEqual(check_prose.lint_ticket_set(quoted, DENYLIST), [])

    def test_jargon_flagged_with_plain_replacement(self):
        # TKT-3: a deny-list term in plain body prose is flagged with its replacement.
        jargon = {
            "epics": [{
                "ref": "E1", "title": "Refunds", "body_markdown": "## Goal\nHelp members.",
                "tickets": [{
                    "ref": "E1-T1",
                    "title": "Let members download their orders",
                    "body_markdown": "## What they need and why\nWe will leverage the new flow.",
                    "done_when": ["A member can download their orders",
                                  "The file downloads"],
                    "depends_on": [], "assignee_hint": None,
                }],
            }],
        }
        issues = check_prose.lint_ticket_set(jargon, DENYLIST)
        tkt3 = [i for i in issues if i["code"] == "TKT3"]
        self.assertTrue(tkt3, "The jargon term must be flagged.")
        self.assertTrue(any("leverage" in i["message"] for i in tkt3))
        self.assertTrue(any("use" in i["suggestion"] for i in tkt3))

    def test_single_document_scan(self):
        # The --path document mode scans for TKT-1 and TKT-3 over the whole text.
        issues = check_prose.scan(
            list(enumerate("A line with leverage and a dash \u2014 here.".splitlines(), 1)),
            "doc.md", DENYLIST, check_code=False)
        codes = sorted({i["code"] for i in issues})
        self.assertIn("TKT1", codes)
        self.assertIn("TKT3", codes)


class CheckTicketSetTest(unittest.TestCase):
    def _codes(self, issues):
        return sorted({i["code"] for i in issues})

    def test_valid_set_passes(self):
        self.assertEqual(check_ticket_set.check(valid_set()), [])

    def test_stale_digest(self):
        ts = valid_set()
        # Edit a title without re-sealing the digest.
        ts["epics"][0]["title"] = "A changed title"
        self.assertIn("STALE_DIGEST", self._codes(check_ticket_set.check(ts)))

    def test_empty_epic(self):
        ts = valid_set()
        ts["epics"][1]["tickets"] = []
        ts = seal(ts)
        self.assertIn("EMPTY_EPIC", self._codes(check_ticket_set.check(ts)))

    def test_ticket_under_two_epics(self):
        ts = valid_set()
        ts["epics"][1]["tickets"].append({
            "ref": "E1-T1", "title": "A ref reused under E2",
            "body_markdown": "body", "done_when": ["one", "two"],
            "depends_on": [], "assignee_hint": None})
        ts = seal(ts)
        self.assertIn("TWO_EPICS", self._codes(check_ticket_set.check(ts)))

    def test_done_when_out_of_range(self):
        ts = valid_set()
        ts["epics"][0]["tickets"][0]["done_when"] = ["only one statement"]
        ts = seal(ts)
        self.assertIn("DONE_WHEN", self._codes(check_ticket_set.check(ts)))

    def test_duplicate_titles(self):
        ts = valid_set()
        ts["epics"][1]["tickets"][0]["title"] = "Show refund status"
        ts = seal(ts)
        self.assertIn("DUPLICATE_TITLE", self._codes(check_ticket_set.check(ts)))

    def test_dangling_dependency(self):
        ts = valid_set()
        ts["epics"][0]["tickets"][1]["depends_on"] = ["E9-T9"]
        ts = seal(ts)
        self.assertIn("DANGLING_DEPENDENCY", self._codes(check_ticket_set.check(ts)))

    def test_dependency_cycle(self):
        ts = valid_set()
        ts["epics"][0]["tickets"][0]["depends_on"] = ["E1-T2"]
        ts["epics"][0]["tickets"][1]["depends_on"] = ["E1-T1"]
        ts = seal(ts)
        self.assertIn("DEPENDENCY_CYCLE", self._codes(check_ticket_set.check(ts)))

    def test_shape_error_short_circuits(self):
        self.assertIn("SCHEMA", self._codes(check_ticket_set.check({"epics": "not a list"})))


if __name__ == "__main__":
    unittest.main()
