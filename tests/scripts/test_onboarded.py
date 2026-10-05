#!/usr/bin/env python3
"""Unit tests for skills/get-connected/scripts/check_onboarded.py (GRD-1, AC-1).

Standard library only (Python 3.9+). No network. Writes only under a temporary folder.
Uses the real tests/evals/fixture-repo as an onboarded tree (RULE-9 real-resource test) and
asserts the exact stop message when a required path is missing.
"""

import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
ONBOARD_SCRIPTS = os.path.join(REPO_ROOT, "skills", "get-connected", "scripts")
if ONBOARD_SCRIPTS not in sys.path:
    sys.path.insert(0, ONBOARD_SCRIPTS)

import check_onboarded  # noqa: E402

FIXTURE_ROOT = os.path.join(REPO_ROOT, "tests", "evals", "fixture-repo")
EXPECTED_STOP = ("This repository isn't set up for this yet. Ask your engineering team to "
                 "onboard it with paqad, then come back.")


class OnboardedTest(unittest.TestCase):
    def test_real_fixture_is_onboarded(self):
        self.assertTrue(check_onboarded.is_onboarded(FIXTURE_ROOT))

    def test_cli_passes_on_fixture(self):
        code = check_onboarded.main(["--root", FIXTURE_ROOT])
        self.assertEqual(code, 0)

    def test_message_constant_is_exact(self):
        self.assertEqual(check_onboarded.STOP_MESSAGE, EXPECTED_STOP)


class NotOnboardedTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def _copy_fixture(self):
        dest = os.path.join(self.tmp, "repo")
        shutil.copytree(FIXTURE_ROOT, dest)
        return dest

    def test_missing_modules_registry_fails(self):
        repo = self._copy_fixture()
        os.remove(os.path.join(repo, "docs", "instructions", "registries", "modules.md"))
        self.assertFalse(check_onboarded.is_onboarded(repo))
        self.assertEqual(check_onboarded.main(["--root", repo]), 1)

    def test_missing_module_summary_fails(self):
        repo = self._copy_fixture()
        shutil.rmtree(os.path.join(repo, "docs", "modules"))
        self.assertFalse(check_onboarded.is_onboarded(repo))

    def test_empty_tree_fails(self):
        self.assertFalse(check_onboarded.is_onboarded(self.tmp))

    def test_cli_fail_payload_carries_exact_message(self):
        import io
        import json
        from contextlib import redirect_stdout
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            code = check_onboarded.main(["--root", self.tmp])
        payload = json.loads(buffer.getvalue())
        self.assertEqual(code, 1)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["message"], EXPECTED_STOP)


if __name__ == "__main__":
    unittest.main()
