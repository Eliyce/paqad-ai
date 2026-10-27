#!/usr/bin/env python3
"""Automated checks for the v3.2 user-story ticket shape (TKT-6, section 8.2, AC-75).

Standard library only (Python 3.9+). No network. Writes only under a temporary folder.
Covers AC-10 (the shared user-stories reference, declared by exactly write-tickets and check-tickets),
AC-11 (the ticket template label order), AC-12 (the prose check on a user-story ticket set: a
confirmed permission key passes, code words on story lines and in criteria are flagged once),
AC-13 (the structure check passes the new shape and still bounds criteria at 2 to 8) and AC-17
(the built skills carry the reference and the choice-prompt rule).

Line breaks in the fixtures are built explicitly as two trailing spaces and a newline, so the test
never relies on trailing spaces surviving in a source file.
"""

import copy
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
SKILLS_ROOT = os.path.join(REPO_ROOT, "skills")
BUILD_DIR = os.path.join(REPO_ROOT, "build")
SHARED_SCRIPTS = os.path.join(REPO_ROOT, "shared", "scripts")
CHECK_TICKETS_SCRIPTS = os.path.join(SKILLS_ROOT, "check-tickets", "scripts")
for entry in (BUILD_DIR, SHARED_SCRIPTS, CHECK_TICKETS_SCRIPTS):
    if entry not in sys.path:
        sys.path.insert(0, entry)

import build  # noqa: E402
import canonical  # noqa: E402
import check_prose  # noqa: E402
import check_ticket_set  # noqa: E402

SKILLS_YML = os.path.join(BUILD_DIR, "skills.yml")
USER_STORIES = "references/user-stories.md"
USER_STORIES_PATH = os.path.join(REPO_ROOT, "shared", USER_STORIES)
TICKET_TEMPLATE = os.path.join(SKILLS_ROOT, "write-tickets", "assets", "ticket-template.md")
DENYLIST = check_prose.load_denylist(
    os.path.join(REPO_ROOT, "shared", "references", "plain-language.md"))
BREAK = "  \n"
MAX_REFERENCE_LINES = 100
TOO_MANY_CRITERIA = 9

TEMPLATE_LABELS = (
    "**Implementation Target:**", "**Module Name:**", "**As a**", "**I want**", "**So that**",
    "**Acceptance Criteria**", "**Depends on:**", "**What exists today**", "**Not included**",
    "**Sources**",
)
SELF_AUDIT_CONCERNS = (
    "Happy path", "failure path", "Permission-positive", "Permission-negative", "Repeat-safe",
    "Linked records", "Rate limit", "Edge inputs", "Two people on the same record",
    "Empty, loading and error states",
)


def criterion(*lines):
    return BREAK.join(lines)


POSITIVE = criterion("**Given** the member has `can view savings`,", "**When** they open this month,",
                     "**Then** every planned saving is shown by date.")
NEGATIVE = criterion("**Given** the member does not have `can view savings`,",
                     "**When** they open this month,", "**Then** they are told they cannot see it.")
STORY = BREAK.join(["**As a** signed-in member,", "**I want** to see my planned savings by date,",
                    "**So that** I know what I will put aside each week."])


def story_body(story=STORY, today="Members can plan savings but not see them by date."):
    header = BREAK.join(["**Implementation Target:** UI", "**Module Name:** `Savings`",
                         "**Epic:** E1 Plan savings on a calendar"])
    return "\n\n".join([header, story, "**Acceptance Criteria**\n- " + POSITIVE + "\n- " + NEGATIVE,
                        "**Depends on:** none", "**What exists today**\n" + today,
                        "**Not included**\nReminders.", "**Sources**\nDR-20261005-7K2Q / E1-T1"])


def seal(ticket_set):
    ticket_set = copy.deepcopy(ticket_set)
    ticket_set["digest"] = canonical.digest({k: v for k, v in ticket_set.items() if k != "digest"})
    return ticket_set


def story_set(body=None, done_when=None):
    ticket = {"ref": "E1-T1", "title": "Show planned savings on the calendar",
              "body_markdown": story_body() if body is None else body,
              "done_when": [POSITIVE, NEGATIVE] if done_when is None else done_when,
              "depends_on": [], "assignee_hint": None}
    return seal({
        "run_id": "DR-20261005-7K2Q", "revision": 1, "digest": "",
        "tracker": {"kind": "jira", "project_key": "ABC", "epic_type": "Epic", "story_type": "Story"},
        "epics": [{"ref": "E1", "title": "Plan savings on a calendar",
                   "body_markdown": "## Goal\nHelp members plan what they save.",
                   "labels": [], "tickets": [ticket]}],
    })


def read_text(path):
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


class UserStoriesReferenceTest(unittest.TestCase):
    """AC-10: the one shared reference, declared and named by exactly the two ticket skills."""

    def test_declared_by_exactly_the_ticket_skills(self):
        config = build.load_config(SKILLS_YML)
        declarers = {skill["name"] for skill in config["skills"]
                     if USER_STORIES in skill.get("imports", [])}
        self.assertEqual(declarers, {"write-tickets", "check-tickets"})
        for skill in sorted(declarers):
            self.assertIn(USER_STORIES, read_text(os.path.join(SKILLS_ROOT, skill, "SKILL.md")))

    def test_reference_carries_the_rules(self):
        text = " ".join(read_text(USER_STORIES_PATH).split())
        for phrase in ("As a", "I want", "So that", "Given", "When", "Then", "two trailing spaces",
                       "Implementation Target", "Module Name", "Depends on: none", "API", "UI",
                       "is not a story", "the host's choice prompt") + SELF_AUDIT_CONCERNS:
            self.assertIn(phrase, text, "user-stories.md is missing: {0}".format(phrase))

    def test_reference_is_short_or_has_contents(self):
        text = read_text(USER_STORIES_PATH)
        self.assertTrue(len(text.splitlines()) < MAX_REFERENCE_LINES or "## Contents" in text)


class TicketTemplateTest(unittest.TestCase):
    """AC-11: the template lists its labels in order and drops the old who-it-is-for heading."""

    def test_labels_in_order(self):
        text = read_text(TICKET_TEMPLATE)
        positions = [text.index(label) for label in TEMPLATE_LABELS]
        self.assertEqual(positions, sorted(positions))
        self.assertNotIn("Who it's for", text)


class StoryProseTest(unittest.TestCase):
    """AC-12: the prose check on a user-story ticket set."""

    def tkt2(self, ticket_set):
        return [i for i in check_prose.lint_ticket_set(ticket_set, DENYLIST) if i["code"] == "TKT2"]

    def test_clean_story_set_passes(self):
        self.assertEqual(check_prose.lint_ticket_set(story_set(), DENYLIST), [])

    def test_code_in_a_criterion_is_flagged(self):
        bad = criterion("**Given** a member,", "**When** they call `exportOrders`,", "**Then** it runs.")
        issues = self.tkt2(story_set(done_when=[POSITIVE, bad]))
        self.assertEqual([i["path"] for i in issues], ["tickets[E1-T1]:done_when[1]:2"])

    def test_other_code_beside_a_permission_key_is_flagged(self):
        bad = criterion("**Given** the member has `can view savings` and `rawTable`,", "**Then** ok.")
        self.assertEqual(len(self.tkt2(story_set(done_when=[POSITIVE, bad]))), 1)

    def test_code_on_an_i_want_line_is_flagged_at_that_line(self):
        story = STORY.replace("to see my planned savings by date", "to call saveDraft()")
        body = story_body(story=story)
        line = 1 + [i for i, text in enumerate(body.splitlines()) if text.startswith("**I want**")][0]
        issues = self.tkt2(story_set(body=body))
        self.assertEqual([i["path"] for i in issues], ["tickets[E1-T1]:body:{0}".format(line)])

    def test_code_under_what_exists_today_is_not_tkt2(self):
        body = story_body(today="The saveDraft step keeps a plan today.")
        self.assertEqual(self.tkt2(story_set(body=body)), [])

    def test_story_under_a_scoped_heading_is_flagged_once(self):
        body = "## What they need and why\n**I want** to call saveDraft()" + BREAK + "**So that** it works."
        self.assertEqual(len(self.tkt2(story_set(body=body))), 1)


class StoryStructureTest(unittest.TestCase):
    """AC-13: the structure check passes the new shape and still bounds the criteria."""

    def test_story_set_passes(self):
        self.assertEqual(check_ticket_set.check(story_set()), [])

    def test_nine_criteria_fail(self):
        ticket_set = story_set(done_when=[POSITIVE] * TOO_MANY_CRITERIA)
        codes = {issue["code"] for issue in check_ticket_set.check(ticket_set)}
        self.assertIn("DONE_WHEN", codes)


class BuiltSkillsTest(unittest.TestCase):
    """AC-17: a fresh build ships the reference and the choice-prompt rule (RL-6d7a)."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.dist = os.path.join(cls.tmp, "dist")
        build.build(REPO_ROOT, cls.dist)
        name = build.load_config(SKILLS_YML)["name"]
        cls.skills_root = os.path.join(build.plugin_dir_path(cls.dist, name), "skills")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_ticket_skills_carry_the_reference(self):
        for skill in ("write-tickets", "check-tickets"):
            path = os.path.join(self.skills_root, skill, USER_STORIES)
            self.assertTrue(os.path.isfile(path), "{0} lacks {1}".format(skill, USER_STORIES))
            self.assertIn("Given", read_text(path))

    def test_built_voice_carries_the_choice_prompt_rule(self):
        voice = os.path.join(self.skills_root, "discover", "references", "voice.md")
        self.assertIn("the host's choice prompt", " ".join(read_text(voice).split()))


if __name__ == "__main__":
    unittest.main()
