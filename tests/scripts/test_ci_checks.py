#!/usr/bin/env python3
"""Unit tests for the four CI check scripts under tests/ci/.

Standard library only (Python 3.9+). No network. Writes nothing outside temporary folders.

Proves each gate has teeth (pass-on-clean, fail-on-planted), mirroring test_parity.py / test_build.py:
  - check_forbidden passes on the clean built dist and fails when a forbidden path is planted;
  - check_budget passes on the real dist and fails when a unit is forced over budget;
  - check_secrets passes on the real source and fails on a planted private-key header;
  - check_scenarios passes on the committed scenarios and fails when a required scenario is removed.

Also proves INV-2: a freshly built dist contains none of the CI tooling (tests/ci or bump_version.py).
"""

import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
CI_DIR = os.path.join(REPO_ROOT, "tests", "ci")
BUILD_DIR = os.path.join(REPO_ROOT, "build")
for entry in (CI_DIR, BUILD_DIR):
    if entry not in sys.path:
        sys.path.insert(0, entry)

import build
import check_budget
import check_forbidden
import check_host_verdicts
import check_scenarios
import check_secrets

PLUGIN_NAME = "paqad-product-discovery"
PRIVATE_KEY_HEADER = "-----BEGIN RSA PRIVATE " + "KEY-----"


class ForbiddenCheckTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.dist = os.path.join(self.tmp, "dist")
        build.build(REPO_ROOT, self.dist)

    def test_passes_on_the_clean_dist(self):
        self.assertEqual(check_forbidden.scan(self.dist), [])

    def test_fails_on_a_planted_forbidden_directory(self):
        planted = os.path.join(self.dist, "plugins", PLUGIN_NAME, "bin")
        os.makedirs(planted)
        with open(os.path.join(planted, "tool.sh"), "w", encoding="utf-8") as handle:
            handle.write("echo hi\n")
        findings = check_forbidden.scan(self.dist)
        self.assertTrue(any("bin" in f for f in findings), findings)

    def test_fails_on_a_planted_forbidden_file(self):
        planted = os.path.join(self.dist, "plugins", PLUGIN_NAME, ".mcp.json")
        with open(planted, "w", encoding="utf-8") as handle:
            handle.write("{}\n")
        findings = check_forbidden.scan(self.dist)
        self.assertTrue(any(".mcp.json" in f for f in findings), findings)


class BudgetCheckTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.dist = os.path.join(self.tmp, "dist")
        build.build(REPO_ROOT, self.dist)

    def test_passes_on_the_real_dist_per_unit(self):
        findings, report = check_budget.check(self.dist)
        self.assertEqual(findings, [], report)
        self.assertTrue(report["units"], "no installable unit measured")
        for unit in report["units"]:
            self.assertLessEqual(unit["files"], check_budget.MAX_FILES)
            self.assertLessEqual(unit["bytes"], check_budget.MAX_BYTES)
        self.assertEqual(report["total_files"], sum(1 for _ in _iter_files(self.dist)))

    def test_fails_when_a_unit_is_over_the_file_budget(self):
        findings, _report = check_budget.check(self.dist, max_files=1)
        self.assertTrue(any("file budget" in f for f in findings), findings)

    def test_fails_when_a_unit_is_over_the_size_budget(self):
        findings, _report = check_budget.check(self.dist, max_bytes=1)
        self.assertTrue(any("size budget" in f for f in findings), findings)

    def test_reports_no_unit_when_dist_has_no_plugin(self):
        empty = os.path.join(self.tmp, "empty")
        os.makedirs(empty)
        findings, _report = check_budget.check(empty)
        self.assertTrue(any("no installable plugin unit" in f for f in findings), findings)


class SecretsCheckTest(unittest.TestCase):
    def test_passes_on_the_real_source_tree(self):
        self.assertEqual(check_secrets.scan_tree(REPO_ROOT), [])

    def test_fails_on_a_planted_private_key_header(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        with open(os.path.join(tmp, "leak.txt"), "w", encoding="utf-8") as handle:
            handle.write("intro line\n" + PRIVATE_KEY_HEADER + "\nMIIabc\n")
        findings = check_secrets.scan_tree(tmp)
        self.assertTrue(any("private key header" in f for f in findings), findings)

    def test_does_not_flag_placeholder_assignment(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        with open(os.path.join(tmp, "config.py"), "w", encoding="utf-8") as handle:
            handle.write('password = "your-password-here"\n')
            handle.write('token = os.environ["TOKEN"]\n')
        self.assertEqual(check_secrets.scan_tree(tmp), [])


class ScenarioCoverageCheckTest(unittest.TestCase):
    def setUp(self):
        self.scenarios_dir = os.path.join(REPO_ROOT, "tests", "evals", "scenarios")
        self.requirements = os.path.join(REPO_ROOT, "REQUIREMENTS.md")

    def test_passes_on_the_committed_scenarios(self):
        self.assertEqual(
            check_scenarios.check(self.scenarios_dir, self.requirements), []
        )

    def test_every_section13_ac_is_accounted_for(self):
        section13 = check_scenarios.parse_section13(self.requirements)
        covered = check_scenarios.scenario_covered(self.scenarios_dir)
        conv, script = check_scenarios.parse_declarations(self.scenarios_dir)
        self.assertTrue(section13, "no section-13 ACs parsed")
        self.assertEqual(section13 - (covered | conv | script), set())

    def test_repo_selection_acceptance_is_accounted_for(self):
        conv, script = check_scenarios.parse_declarations(self.scenarios_dir)
        only_repo_selection = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, only_repo_selection, ignore_errors=True)
        shutil.copy(os.path.join(self.scenarios_dir, "repo-selection.yml"), only_repo_selection)
        covered = check_scenarios.scenario_covered(only_repo_selection)
        self.assertEqual(covered, set(range(49, 56)))
        self.assertLessEqual(set(range(49, 56)), conv)
        # Generic mode (GM-1): not-set-up is reinterpreted as the code-only level, so AC-56 is now a
        # conversation-shape scenario covered in generic-mode.yml, not a script-proven stop.
        self.assertIn(56, conv)
        self.assertNotIn(56, script)

    def test_fails_when_a_required_scenario_is_removed(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        copy = os.path.join(tmp, "scenarios")
        shutil.copytree(self.scenarios_dir, copy)
        os.remove(os.path.join(copy, "s1b.yml"))
        findings = check_scenarios.check(copy, self.requirements)
        self.assertTrue(any("AC-33" in f for f in findings), findings)


class CiToolingNotShippedTest(unittest.TestCase):
    """INV-2 (PLG-9, PLG-10): the built dist carries none of the CI tooling."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.dist = os.path.join(self.tmp, "dist")
        build.build(REPO_ROOT, self.dist)

    def test_no_ci_tooling_in_dist(self):
        banned_names = {
            "check_forbidden.py",
            "check_secrets.py",
            "check_budget.py",
            "check_scenarios.py",
            "bump_version.py",
        }
        for rel in _iter_relpaths(self.dist):
            parts = rel.split("/")
            self.assertNotIn(
                "ci", parts, "a ci directory reached the dist: {0}".format(rel)
            )
            self.assertNotIn(
                os.path.basename(rel),
                banned_names,
                "CI tooling reached the dist: {0}".format(rel),
            )


def _iter_files(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d != "__pycache__"]
        for name in filenames:
            if name.endswith(".pyc"):
                continue
            yield os.path.join(dirpath, name)


def _iter_relpaths(root):
    for full in _iter_files(root):
        yield os.path.relpath(full, root).replace(os.sep, "/")


class ReleaseReadinessTest(unittest.TestCase):
    """S4 part 2 (CI-16): release.yml carries the guarded public-directory publish, distinct from the
    private org-sync push, and a directory submission zip artifact, all off unless explicitly enabled."""

    def setUp(self):
        with open(os.path.join(REPO_ROOT, ".github", "workflows", "release.yml"), encoding="utf-8") as handle:
            self.release = handle.read()

    def test_public_publish_is_guarded(self):
        self.assertIn("PUBLIC_DISTRIBUTION_REPO", self.release)
        self.assertIn("ENABLE_PUBLIC_RELEASE", self.release)
        self.assertIn(
            "vars.ENABLE_PUBLIC_RELEASE == 'true' && vars.PUBLIC_DISTRIBUTION_REPO != ''",
            self.release,
            "public push must require both the enable flag and a configured public repo",
        )

    def test_directory_submission_zip_artifact_exists(self):
        self.assertIn("directory-submission-zip", self.release)
        self.assertIn("upload-artifact", self.release)

    def test_public_push_is_distinct_from_private(self):
        self.assertIn("vars.DISTRIBUTION_REPO", self.release)
        self.assertIn("PUBLIC_DISTRIBUTION_TOKEN", self.release)
        self.assertNotEqual(
            self.release.count("push origin HEAD"),
            1,
            "a separate public push step must exist alongside the private one",
        )


class HostVerdictCheckTest(unittest.TestCase):
    """S4 part 3 (CI-19): the host-verdict integrity check parses the real verdict tables, passes on
    the all-pending repo, and fails on a bad token or a supported verdict with no evidence."""

    HEADER = "| Unknown | What to check | How to check | Verdict | Evidence | If it fails |"
    SEP = "| --- | --- | --- | --- | --- | --- |"

    def _write_host(self, verdict, evidence):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        path = os.path.join(self.tmp, "host.md")
        row = "| U-1 | does it run | install it | {0} | {1} | fallback |".format(verdict, evidence)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("\n".join(["# Host", "", self.HEADER, self.SEP, row, ""]))
        return path

    def test_parses_the_real_host_files_nonempty(self):
        rows = check_host_verdicts.parse_rows()
        self.assertTrue(rows, "no verdict rows parsed; the parser or the host paths are wrong")
        self.assertTrue(all(r["verdict"].lower() == "pending" for r in rows))

    def test_passes_on_the_committed_host_files(self):
        self.assertEqual(check_host_verdicts.check(), [])

    def test_fails_on_an_unknown_verdict_token(self):
        path = self._write_host("shipped", "")
        self.assertTrue(check_host_verdicts.check([path]))

    def test_fails_on_verified_without_evidence(self):
        path = self._write_host("verified", "")
        findings = check_host_verdicts.check([path])
        self.assertTrue(any("no evidence" in f for f in findings))

    def test_passes_on_verified_with_evidence(self):
        path = self._write_host("verified", "installed 2026-10-08, screenshot in run log")
        self.assertEqual(check_host_verdicts.check([path]), [])

    def test_fails_on_a_missing_host_file(self):
        self.assertTrue(check_host_verdicts.check([os.path.join(REPO_ROOT, "hosts", "nope.md")]))


if __name__ == "__main__":
    unittest.main()
