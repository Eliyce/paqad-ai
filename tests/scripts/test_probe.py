#!/usr/bin/env python3
"""Unit tests for skills/discover-probe/scripts/probe.py.

Standard library only. No network. Writes nothing outside a temporary working folder.
Runs probe.py as a subprocess with python3 and asserts the shape of its report, and asserts the
probe writes nothing outside the current working folder.
"""

import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
PROBE_PATH = os.path.join(
    REPO_ROOT, "skills", "discover-probe", "scripts", "probe.py"
)


class ProbeReportTest(unittest.TestCase):
    def _run_probe(self, cwd):
        result = subprocess.run(
            [sys.executable, PROBE_PATH],
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True,
        )
        return result

    def test_report_contains_expected_lines(self):
        with tempfile.TemporaryDirectory() as work:
            result = self._run_probe(work)
            self.assertEqual(result.returncode, 0, result.stderr)
            out = result.stdout
            self.assertIn("Runtime version:", out)
            self.assertIn("Script executed: yes", out)
            self.assertIn("Working-folder write test:", out)
            self.assertIn("pass", out)
            self.assertIn("Standard library only, no network: yes", out)

    def test_writes_nothing_outside_working_folder(self):
        with tempfile.TemporaryDirectory() as work:
            before = sorted(os.listdir(work))
            result = self._run_probe(work)
            self.assertEqual(result.returncode, 0, result.stderr)
            after = sorted(os.listdir(work))
            # The probe creates a temp file inside the working folder then deletes it, so the
            # folder is unchanged and nothing leaks outside it.
            self.assertEqual(before, after)
            self.assertEqual(after, [])

    def test_probe_script_dir_unchanged(self):
        script_dir = os.path.dirname(PROBE_PATH)
        before = sorted(os.listdir(script_dir))
        with tempfile.TemporaryDirectory() as work:
            self._run_probe(work)
        after = sorted(os.listdir(script_dir))
        self.assertEqual(before, after)


if __name__ == "__main__":
    unittest.main()
