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

    def test_tkt4_flags_sentence_over_thirty_words(self):
        # TD-20 (TKT-4): a sentence of 31 words is flagged.
        sentence = " ".join("word" for _ in range(31)) + "."
        issues = check_prose.scan([(1, sentence)], "doc.md", DENYLIST, check_code=False)
        self.assertIn("TKT4", self._codes(issues))

    def test_tkt4_allows_thirty_word_sentence(self):
        # TD-20 (TKT-4): a sentence of 30 words passes.
        sentence = " ".join("word" for _ in range(30)) + "."
        issues = check_prose.scan([(1, sentence)], "doc.md", DENYLIST, check_code=False)
        self.assertNotIn("TKT4", self._codes(issues))


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

    def test_external_tracker_dep_is_not_dangling(self):
        # AC-6 / INV-1 (TD-14): an external tracker ref is a valid dependency, not dangling.
        ts = valid_set()
        ts["epics"][0]["tickets"][1]["depends_on"] = ["PROJ-123"]
        ts = seal(ts)
        issues = check_ticket_set.check(ts)
        self.assertNotIn("DANGLING_DEPENDENCY", self._codes(issues))
        self.assertEqual(issues, [])

    def test_over_length_title_flagged(self):
        # AC-8 (TD-14): a title over the schema maximum is reported.
        ts = valid_set()
        ts["epics"][0]["tickets"][0]["title"] = "T" * 81
        ts = seal(ts)
        self.assertIn("TITLE_TOO_LONG", self._codes(check_ticket_set.check(ts)))

    def test_bad_ref_pattern_flagged(self):
        # AC-8 (TD-14): a ref that does not match its schema pattern is reported.
        ts = valid_set()
        ts["epics"][0]["ref"] = "EPIC_ONE"
        ts = seal(ts)
        self.assertIn("BAD_REF", self._codes(check_ticket_set.check(ts)))

    def test_extra_property_flagged(self):
        # AC-8 (TD-14): an unexpected property (closed shape) is reported.
        ts = valid_set()
        ts["epics"][0]["tickets"][0]["unexpected"] = "x"
        ts = seal(ts)
        self.assertIn("EXTRA_PROPERTY", self._codes(check_ticket_set.check(ts)))

    def test_shape_error_short_circuits(self):
        self.assertIn("SCHEMA", self._codes(check_ticket_set.check({"epics": "not a list"})))


def existing_epic_set():
    """The valid set with E2 turned into an epic that already exists in the tracker."""
    ticket_set = valid_set()
    epic = ticket_set["epics"][1]
    epic["existing_key"] = "ABC-7"
    epic["title"] = "Order history"
    epic["body_markdown"] = ""
    epic["labels"] = []
    return seal(ticket_set)


class ExistingEpicTicketSetTest(unittest.TestCase):
    """Spec AC-27 (REQUIREMENTS AC-101): the structure check on a set with existing_key."""

    def _codes(self, issues):
        return sorted({i["code"] for i in issues})

    def _with(self, change):
        ticket_set = existing_epic_set()
        change(ticket_set["epics"][1], ticket_set)
        return check_ticket_set.check(seal(ticket_set))

    def test_ac_27_valid_existing_epic_set_passes(self):
        self.assertEqual(check_ticket_set.check(existing_epic_set()), [])

    def test_ac_27_key_that_is_not_a_tracker_key_is_refused(self):
        for bad in ("#123", "abc-7", "", 7, None):
            issues = self._with(lambda epic, _set, bad=bad: epic.update(existing_key=bad))
            self.assertEqual(self._codes(issues), ["BAD_EXISTING_KEY"], bad)

    def test_ac_27_existing_epic_with_zero_tickets_is_refused(self):
        issues = self._with(lambda epic, _set: epic.update(tickets=[]))
        self.assertEqual(self._codes(issues), ["EMPTY_EPIC"])

    def test_ac_27_two_epics_with_the_same_existing_key_are_refused(self):
        def change(_epic, ticket_set):
            first = ticket_set["epics"][0]
            first.update(existing_key="ABC-7", body_markdown="", labels=[])
        issues = self._with(change)
        self.assertEqual(self._codes(issues), ["DUPLICATE_EXISTING_KEY"])
        self.assertEqual(issues[0]["path"], "epics[E2].existing_key")

    def test_ac_27_non_empty_body_is_refused(self):
        issues = self._with(lambda epic, _set: epic.update(body_markdown="## Goal\nRewritten."))
        self.assertEqual(self._codes(issues), ["EXISTING_EPIC_BODY"])

    def test_ac_27_any_label_is_refused(self):
        issues = self._with(lambda epic, _set: epic.update(labels=["paqad-discovery"]))
        self.assertEqual(self._codes(issues), ["EXISTING_EPIC_LABELS"])
        issues = self._with(lambda epic, _set: epic.pop("labels"))
        self.assertEqual(self._codes(issues), ["EXISTING_EPIC_LABELS"])

    def test_ac_27_missing_title_or_bad_ref_is_still_refused(self):
        issues = self._with(lambda epic, _set: epic.update(title="  "))
        self.assertEqual(self._codes(issues), ["SCHEMA"])
        issues = self._with(lambda epic, _set: epic.update(ref=""))
        self.assertEqual(self._codes(issues), ["BAD_REF", "SCHEMA"])

    def test_ac_27_long_live_title_is_accepted(self):
        issues = self._with(lambda epic, _set: epic.update(title="L" * 200))
        self.assertEqual(issues, [])

    def test_ac_27_live_title_equal_to_a_ticket_title_is_accepted(self):
        issues = self._with(lambda epic, _set: epic.update(title="Search past orders"))
        self.assertEqual(issues, [])

    def test_ac_27_new_epic_in_the_same_set_keeps_the_cap_and_the_duplicate_check(self):
        issues = self._with(lambda _epic, ticket_set: ticket_set["epics"][0].update(title="N" * 81))
        self.assertEqual(self._codes(issues), ["TITLE_TOO_LONG"])
        issues = self._with(
            lambda _epic, ticket_set: ticket_set["epics"][0].update(title="Show refund status"))
        self.assertEqual(self._codes(issues), ["DUPLICATE_TITLE"])
        issues = self._with(
            lambda _epic, ticket_set: ticket_set["epics"][0].update(body_markdown=""))
        self.assertEqual(self._codes(issues), ["SCHEMA"])

    def test_ac_46_a_set_without_existing_key_reports_exactly_what_it_did(self):
        # INV-12: the new branches are reached only through existing_key.
        self.assertEqual(check_ticket_set.check(valid_set()), [])
        ticket_set = valid_set()
        ticket_set["epics"][1]["title"] = "Show refund status"
        self.assertEqual(check_ticket_set.check(seal(ticket_set)), [{
            "code": "DUPLICATE_TITLE", "path": "epics[E2]",
            "message": "Title is duplicated across the set: Show refund status."}])


class EpicChoiceMatchTest(unittest.TestCase):
    """FR-54, spec AC-23: a redraft cannot silently drop or change the chosen epic."""

    CHOICE = [{"mode": "new"}, {"mode": "existing", "key": "ABC-7", "title": "Order history"}]

    def record(self, choice, as_object=False):
        if as_object:
            return {"decisions": {"epic_choice": choice}}
        return {"decisions": [{"id": "D1", "question": "", "choice": "", "by": "", "why": ""},
                              {"id": "epic-choice", "epic_choice": choice}]}

    def _codes(self, issues):
        return sorted({i["code"] for i in issues})

    def test_ac_23_set_that_matches_the_recorded_choice_passes(self):
        for as_object in (False, True):
            record = self.record(self.CHOICE, as_object)
            self.assertEqual(check_ticket_set.check(existing_epic_set(), record), [])

    def test_ac_23_redraft_that_drops_the_chosen_epic_is_refused(self):
        issues = check_ticket_set.check(valid_set(), self.record(self.CHOICE))
        self.assertEqual(self._codes(issues), ["EPIC_CHOICE_MISMATCH"])
        self.assertEqual(issues[0]["path"], "epics[1].existing_key")
        self.assertIn("expected ABC-7, found a new epic", issues[0]["message"])

    def test_ac_23_redraft_that_changes_the_key_is_refused(self):
        choice = [{"mode": "new"}, {"mode": "existing", "key": "ABC-9", "title": "Other"}]
        issues = check_ticket_set.check(existing_epic_set(), self.record(choice))
        self.assertEqual(self._codes(issues), ["EPIC_CHOICE_MISMATCH"])

    def test_existing_key_with_no_recorded_choice_is_refused(self):
        for record in ({}, {"decisions": []}, {"decisions": [{"id": "D1"}]}, {"decisions": None}):
            issues = check_ticket_set.check(existing_epic_set(), record)
            self.assertEqual(self._codes(issues), ["EPIC_CHOICE_MISMATCH"], record)

    def test_a_choice_for_an_epic_the_set_no_longer_holds_is_refused(self):
        choice = self.CHOICE + [{"mode": "existing", "key": "ABC-8", "title": "Third"}, "junk"]
        issues = check_ticket_set.check(existing_epic_set(), self.record(choice))
        self.assertEqual([i["path"] for i in issues], ["epics[2].existing_key"])

    def test_new_only_set_with_new_only_choice_passes_and_no_record_skips_the_check(self):
        record = self.record([{"mode": "new"}])
        self.assertEqual(check_ticket_set.check(valid_set(), record), [])
        self.assertEqual(check_ticket_set.check(existing_epic_set()), [])

    def test_cli_reads_the_record(self):
        import contextlib
        import io
        import json
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            set_path = os.path.join(folder, "ticket-set.json")
            record_path = os.path.join(folder, "record.json")
            with open(set_path, "w", encoding="utf-8") as handle:
                json.dump(valid_set(), handle)
            with open(record_path, "w", encoding="utf-8") as handle:
                json.dump(self.record(self.CHOICE), handle)
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = check_ticket_set.main(["--ticket-set", set_path, "--record", record_path])
            self.assertEqual(code, 1)
            self.assertEqual(json.loads(out.getvalue())["issues"][0]["code"], "EPIC_CHOICE_MISMATCH")
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = check_ticket_set.main(["--ticket-set", set_path])
            self.assertEqual(code, 0)


class ExistingEpicProseTest(unittest.TestCase):
    """FR-53: the prose check skips the title and body of an existing epic and lints its tickets."""

    def test_existing_epic_text_is_skipped(self):
        ticket_set = existing_epic_set()
        ticket_set["epics"][1]["title"] = "Leverage the getOrders() flow \u2014 phase 2"
        issues = check_prose.lint_ticket_set(ticket_set, DENYLIST)
        self.assertEqual([i for i in issues if i["path"].startswith("epics[E2]")], [])

    def test_the_same_title_on_a_new_epic_is_still_flagged(self):
        ticket_set = valid_set()
        ticket_set["epics"][1]["title"] = "Leverage the getOrders() flow \u2014 phase 2"
        issues = check_prose.lint_ticket_set(ticket_set, DENYLIST)
        self.assertTrue([i for i in issues if i["path"].startswith("epics[E2]")])

    def test_tickets_under_an_existing_epic_are_still_linted(self):
        ticket_set = existing_epic_set()
        ticket_set["epics"][1]["tickets"][0]["title"] = "Search orders \u2014 fast"
        issues = check_prose.lint_ticket_set(ticket_set, DENYLIST)
        self.assertTrue([i for i in issues if i["path"].startswith("tickets[E2-T1]")])

    def test_ac_46_a_set_without_existing_key_lints_exactly_as_before(self):
        self.assertEqual(check_prose.lint_ticket_set(valid_set(), DENYLIST), [])


if __name__ == "__main__":
    unittest.main()
