#!/usr/bin/env python3
"""Unit tests for skills/product-discovery/scripts/check_record.py.

Standard library only (Python 3.9+). No network. Writes only under a temporary folder.
Covers the AC-15 resume signal (a required block missing, present, or present-but-stale), the
missing-run and unknown-step guards, the CLI (--path and exit codes), and a sync guard proving
check_record reuses record.REQUIRED / record.present so the two files can never drift (RULE-11).
"""

import contextlib
import io
import json
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

import check_record  # noqa: E402
import record  # noqa: E402


class CheckRecordTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(self._cleanup)
        self.path = os.path.join(self.tmp, "record.json")

    def _cleanup(self):
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _fresh(self):
        return record.new_record(run_id="DR-20261005-7K2Q", mode="build")

    @staticmethod
    def _codes(issues):
        return [issue["code"] for issue in issues]

    # Non-empty content for each required block, so a step can be made to pass.
    CONTENT = {
        "setup": {"tracker_kind": "jira", "can_create": True},
        "idea": {"goal": "cut refund time"},
        "today": [{"area": "returns", "source_path": "x"}],
        "playback": {"recommendation": "ship a smaller first step"},
        "decisions": [{"id": "D1", "choice": "manual review"}],
        "outcome": {"summary": "agreed"},
        "ticket_set_ref": {"digest": "abc"},
        "readiness": {"verdict": "ready"},
        "posted": {"issues": [{"key": "PROJ-1"}], "read_back": {"PROJ-1": "ok"}},
    }


class ResumeSignalTest(CheckRecordTestCase):
    def test_every_step_starts_missing_then_passes_when_filled(self):
        for step, blocks in record.REQUIRED.items():
            rec = self._fresh()
            # Empty each required block (new_record seeds posted with a non-empty shell), so
            # every one is flagged MISSING.
            for block in blocks:
                rec[block] = {}
            missing = check_record.check(rec, step=step)
            self.assertEqual(
                self._codes(missing), ["MISSING"] * len(blocks),
                "step {0} should flag {1} missing block(s)".format(step, len(blocks)))
            # Fill the step's required blocks: the check then passes with no issues.
            for block in blocks:
                rec[block] = self.CONTENT[block]
            self.assertEqual(check_record.check(rec, step=step), [])

    def test_present_but_stale_block_is_flagged_stale(self):
        # The AC-15 resume signal: a block that holds content but sits in the stale list is not
        # satisfied, so a resumed run knows it still has to be redone.
        step = 2  # requires today
        rec = self._fresh()
        rec["today"] = self.CONTENT["today"]
        self.assertEqual(check_record.check(rec, step=step), [])
        rec["stale"] = ["today"]
        issues = check_record.check(rec, step=step)
        self.assertEqual(self._codes(issues), ["STALE"])
        self.assertIn("today", issues[0]["path"])

    def test_partly_filled_step_flags_only_the_empty_block(self):
        # Step 4 requires both decisions and outcome; fill one, the other stays MISSING.
        rec = self._fresh()
        rec["decisions"] = self.CONTENT["decisions"]
        issues = check_record.check(rec, step=4)
        self.assertEqual(self._codes(issues), ["MISSING"])
        self.assertIn("outcome", issues[0]["path"])


class GuardTest(CheckRecordTestCase):
    def test_missing_run_block_reported(self):
        issues = check_record.check({"setup": {"x": 1}}, step=0)
        self.assertEqual(self._codes(issues), ["RECORD"])
        self.assertIn("run", issues[0]["path"])

    def test_unknown_step_reported(self):
        rec = self._fresh()
        issues = check_record.check(rec, step=99)
        self.assertEqual(self._codes(issues), ["STEP"])
        self.assertIn("99", issues[0]["message"])

    def test_step_defaults_to_run_step(self):
        rec = self._fresh()  # run.step is 0, which requires setup
        issues = check_record.check(rec)
        self.assertEqual(self._codes(issues), ["MISSING"])
        self.assertIn("setup", issues[0]["path"])


class SyncGuardTest(CheckRecordTestCase):
    def test_required_map_is_the_one_in_record(self):
        # The refactor removed check_record's own copies; it must reuse record's canonical ones
        # so the required-blocks map and present() can never silently drift (RULE-11).
        self.assertIs(check_record.REQUIRED, record.REQUIRED)
        self.assertIs(check_record.present, record.present)


class CliTest(CheckRecordTestCase):
    def _run(self, argv):
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            code = check_record.main(argv)
        return code, buffer.getvalue()

    def test_cli_exit_1_and_issue_when_required_block_missing(self):
        record.write(self.path, self._fresh())  # step 0, setup empty
        code, out = self._run(["--path", self.path])
        self.assertEqual(code, 1)
        payload = json.loads(out)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["issues"][0]["code"], "MISSING")

    def test_cli_exit_0_when_required_block_present(self):
        rec = self._fresh()
        rec["setup"] = self.CONTENT["setup"]
        record.write(self.path, rec)
        code, out = self._run(["--path", self.path, "--step", "0"])
        self.assertEqual(code, 0)
        payload = json.loads(out)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["issues"], [])


if __name__ == "__main__":
    unittest.main()
