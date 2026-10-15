"""Skill wording the directory security scan reads as a credential hand-off.

The scan held the plugin (MCP_FORWARDS_CREDENTIAL_ENV) because a skill said "pass" before a code span
and named a script subcommand on its own, which it read as passing the installer's credential to a
command assembled at run time. Skills name every script call as a full literal command instead.
"""

import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
PASS_BEFORE_CODE = re.compile(r"\bpass\s+(`|it\b)", re.IGNORECASE)
PLAN_POSTING_SUBCOMMANDS = ("plan", "next", "claim", "record", "reconcile")


def authored_markdown():
    for top in ("skills", "shared"):
        for dirpath, _, names in os.walk(os.path.join(REPO_ROOT, top)):
            for name in names:
                if name.endswith(".md"):
                    yield os.path.join(dirpath, name)


class ScanWordingTest(unittest.TestCase):

    def test_no_skill_says_pass_before_a_code_span(self):
        offenders = []
        for path in authored_markdown():
            with open(path, encoding="utf-8") as handle:
                for number, line in enumerate(handle, 1):
                    if PASS_BEFORE_CODE.search(line):
                        offenders.append("{0}:{1}".format(os.path.relpath(path, REPO_ROOT), number))
        self.assertEqual(offenders, [])

    def test_post_tickets_names_each_plan_posting_call_in_full(self):
        path = os.path.join(REPO_ROOT, "skills", "post-tickets", "SKILL.md")
        with open(path, encoding="utf-8") as handle:
            text = handle.read()
        for sub in PLAN_POSTING_SUBCOMMANDS:
            self.assertIn("`scripts/plan_posting.py {0} --state <state.json>".format(sub), text)


if __name__ == "__main__":
    unittest.main()
