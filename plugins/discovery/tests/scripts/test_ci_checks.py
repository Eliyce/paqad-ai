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

import contextlib
import io
import json
import os
import runpy
import shutil
import sys
import tempfile
import unittest
from unittest import mock

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
        self.requirements = check_scenarios.DEFAULT_REQUIREMENTS

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


def _run_main(module, argv):
    """Run a check's main(argv) in-process; return (exit code, parsed stdout JSON)."""
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = module.main(argv)
    return code, json.loads(out.getvalue())


def _run_as_script(module, argv):
    """Run a check file as __main__ (its CLI guard); return (exit code, stdout, stderr)."""
    out, err = io.StringIO(), io.StringIO()
    with mock.patch.object(sys, "argv", [module.__file__] + list(argv)), \
            contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        with unittest.TestCase().assertRaises(SystemExit) as ctx:
            runpy.run_path(module.__file__, run_name="__main__")
    return ctx.exception.code, out.getvalue(), err.getvalue()


def _write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)


class CheckCliTest(unittest.TestCase):
    """The CLI contract of every CI check: JSON on stdout, exit 0 clean, exit 1 on a finding, and
    an {"ok": false, "error"} line on stderr with exit 1 when the input cannot be read."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.dist = os.path.join(cls.tmp, "dist")
        build.build(REPO_ROOT, cls.dist)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def _scratch(self):
        path = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, path, ignore_errors=True)
        return path

    # check_forbidden

    def test_forbidden_main_clean_dist_exits_zero(self):
        code, payload = _run_main(check_forbidden, ["--dist", self.dist])
        self.assertEqual(code, 0)
        self.assertEqual(payload, {"ok": True, "findings": []})

    def test_forbidden_main_builds_an_absent_dist_before_scanning(self):
        dist = os.path.join(self._scratch(), "fresh-dist")
        code, payload = _run_main(check_forbidden, ["--dist", dist, "--source", REPO_ROOT])
        self.assertEqual(code, 0, payload)
        self.assertTrue(os.path.isdir(os.path.join(dist, "plugins")), "dist was not built")

    def test_forbidden_main_exits_one_on_a_planted_path(self):
        dist = os.path.join(self._scratch(), "dist")
        shutil.copytree(self.dist, dist)
        os.makedirs(os.path.join(dist, "plugins", PLUGIN_NAME, "hooks"))
        _write(os.path.join(dist, "plugins", PLUGIN_NAME, "mcp.json"), "{}\n")
        code, payload = _run_main(check_forbidden, ["--dist", dist])
        self.assertEqual(code, 1)
        self.assertFalse(payload["ok"])
        self.assertIn(
            "forbidden directory 'hooks' in dist: plugins/{0}/hooks".format(PLUGIN_NAME),
            payload["findings"])
        self.assertIn(
            "forbidden file 'mcp.json' in dist: plugins/{0}/mcp.json".format(PLUGIN_NAME),
            payload["findings"])

    def test_forbidden_script_reports_an_unreadable_source_on_stderr(self):
        scratch = self._scratch()
        code, out, err = _run_as_script(check_forbidden, [
            "--dist", os.path.join(scratch, "dist"),
            "--source", os.path.join(scratch, "no-such-source")])
        self.assertEqual(code, 1)
        self.assertEqual(out, "")
        payload = json.loads(err)
        self.assertFalse(payload["ok"])
        self.assertIn("no-such-source", payload["error"])

    # check_budget

    def test_budget_main_reports_units_and_exits_zero(self):
        code, payload = _run_main(check_budget, ["--dist", self.dist])
        self.assertEqual(code, 0, payload)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["max_files"], check_budget.MAX_FILES)
        self.assertEqual(payload["max_bytes"], check_budget.MAX_BYTES)
        for unit in payload["units"]:
            self.assertEqual(unit["files_headroom"], check_budget.MAX_FILES - unit["files"])
            self.assertEqual(unit["bytes_headroom"], check_budget.MAX_BYTES - unit["bytes"])

    def test_budget_main_exits_one_when_limits_are_lowered(self):
        code, payload = _run_main(
            check_budget, ["--dist", self.dist, "--max-files", "1", "--max-bytes", "1"])
        self.assertEqual(code, 1)
        self.assertFalse(payload["ok"])
        self.assertTrue(any("file budget" in f for f in payload["findings"]))
        self.assertTrue(any("size budget" in f for f in payload["findings"]))
        self.assertTrue(all(u["files_headroom"] < 0 for u in payload["units"]))

    def test_budget_measure_skips_compiled_python(self):
        root = self._scratch()
        _write(os.path.join(root, "a.py"), "x = 1\n")
        _write(os.path.join(root, "a.pyc"), "compiled bytes\n")
        _write(os.path.join(root, "__pycache__", "a.cpython-39.pyc"), "compiled\n")
        self.assertEqual(check_budget.measure(root), (len("x = 1\n"), 1))

    def test_budget_units_include_host_plugins_and_skip_a_host_without_plugins(self):
        root = self._scratch()
        _write(os.path.join(root, "plugins", "alpha", "SKILL.md"), "a\n")
        _write(os.path.join(root, "plugins", "stray.txt"), "not a unit\n")
        _write(os.path.join(root, "hosts", "claude", "plugins", "beta", "SKILL.md"), "b\n")
        _write(os.path.join(root, "hosts", "claude", "plugins", "loose.txt"), "not a unit\n")
        _write(os.path.join(root, "hosts", "codex", "README.md"), "no plugins dir\n")
        units = [os.path.relpath(u, root).replace(os.sep, "/")
                 for u in check_budget.installable_units(root)]
        self.assertEqual(units, ["plugins/alpha", "hosts/claude/plugins/beta"])

    def test_budget_script_reports_an_unreadable_source_on_stderr(self):
        scratch = self._scratch()
        code, _out, err = _run_as_script(check_budget, [
            "--dist", os.path.join(scratch, "dist"),
            "--source", os.path.join(scratch, "missing")])
        self.assertEqual(code, 1)
        self.assertFalse(json.loads(err)["ok"])

    # check_secrets

    def test_secrets_main_clean_tree_exits_zero(self):
        root = self._scratch()
        _write(os.path.join(root, "notes.md"), "nothing secret here\n")
        code, payload = _run_main(check_secrets, ["--root", root])
        self.assertEqual(code, 0)
        self.assertEqual(payload, {"ok": True, "findings": []})

    def test_secrets_script_exits_one_on_a_planted_key(self):
        root = self._scratch()
        _write(os.path.join(root, "src", "leak.txt"), PRIVATE_KEY_HEADER + "\n")
        code, out, err = _run_as_script(check_secrets, ["--root", root])
        self.assertEqual(code, 1)
        self.assertEqual(err, "")
        payload = json.loads(out)
        self.assertEqual(payload["findings"], ["src/leak.txt:1: private key header"])

    def test_secrets_every_rule_names_file_line_and_rule_never_the_bytes(self):
        aws = "AKIA" + "ABCDEFGHIJKLMNOP"
        github = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"
        slack = "xoxb-" + "1234567890-abcdef"
        google = "AIza" + "SyA1234567890abcdefghijklmnopqrstuv"
        conn = "postgres://" + "admin:hunter2pass@db.internal/app"
        assign = "api_key" + ' = "' + "q8Zr-41xLm-90Tk" + '"'
        text = "\n".join(["ok line", aws, github, slack, google, conn, assign]) + "\n"
        findings = check_secrets.scan_text(text, "f.txt")
        self.assertEqual(findings, [
            "f.txt:2: cloud access key id",
            "f.txt:3: provider access token",
            "f.txt:4: provider access token",
            "f.txt:5: cloud api key",
            "f.txt:6: connection string with embedded password",
            "f.txt:7: secret-named assignment with a real value",
        ])
        for secret in (aws, github, slack, google, "hunter2pass", "q8Zr-41xLm-90Tk"):
            self.assertFalse(any(secret in f for f in findings))

    def test_secrets_assignment_values_that_do_not_look_real_are_ignored(self):
        not_real = [
            "${" + "API_KEY_FROM_ENV}",      # template reference
            "{{" + " vault_lookup_x1 }}",    # templating
            "<" + "fill-me-in-123>",         # angle placeholder
            "$" + "HOME_DIR_VALUE_1",        # shell reference
            "aaaaaaaaaaaaaaaa",              # too few distinct characters
            "abcdefghijklmnop",              # letters only
            "1234567890123456",              # digits only
            "q8Zr-41xL",                     # mixed but shorter than 12
        ]
        for value in not_real:
            self.assertFalse(check_secrets._looks_real(value), value)
            line = "client_secret" + ': "' + value + '"'
            self.assertEqual(check_secrets.scan_text(line, "c.yml"), [], value)
        self.assertTrue(check_secrets._looks_real("q8Zr-41xLm-90Tk"))

    def test_secrets_scan_tree_skips_excluded_dirs_binaries_and_unreadable_files(self):
        root = self._scratch()
        for excluded in ("dist", ".git", ".paqad", "node_modules", "__pycache__"):
            _write(os.path.join(root, excluded, "leak.txt"), PRIVATE_KEY_HEADER + "\n")
        _write(os.path.join(root, "logo.png"), PRIVATE_KEY_HEADER + "\n")
        os.symlink(os.path.join(root, "gone.txt"), os.path.join(root, "dangling.txt"))
        _write(os.path.join(root, "kept", "leak.md"), "x\n" + PRIVATE_KEY_HEADER + "\n")
        self.assertEqual(check_secrets.scan_tree(root), ["kept/leak.md:2: private key header"])

    # check_scenarios

    def test_scenarios_main_on_the_committed_scenarios_exits_zero(self):
        code, payload = _run_main(check_scenarios, [])
        self.assertEqual(code, 0, payload)
        self.assertEqual(payload, {"ok": True, "findings": []})

    def test_scenarios_script_reports_a_missing_requirements_file_on_stderr(self):
        missing = os.path.join(self._scratch(), "REQUIREMENTS.md")
        code, out, err = _run_as_script(check_scenarios, ["--requirements", missing])
        self.assertEqual(code, 1)
        self.assertEqual(out, "")
        self.assertIn("REQUIREMENTS.md", json.loads(err)["error"])

    def test_scenarios_extract_acs_expands_ranges(self):
        self.assertEqual(check_scenarios.extract_acs("AC-3 to AC-5 and AC-9"), {3, 4, 5, 9})
        self.assertEqual(check_scenarios.extract_acs("no criteria here"), set())

    def test_scenarios_check_flags_every_kind_of_gap(self):
        root = self._scratch()
        requirements = os.path.join(root, "REQUIREMENTS.md")
        _write(requirements, "\n".join([
            "# Requirements", "## 12. Before", "| AC-99 | ignored, outside section 13 |",
            "## 13. Acceptance", "| AC-1 | covered |", "| AC-2 | declared only |",
            "| AC-3 | unaccounted |", "## 14. After", "| AC-98 | ignored |", ""]))
        scenarios = os.path.join(root, "scenarios")
        _write(os.path.join(scenarios, "README.md"),
               "AC-2 is a conversation-shape scenario. AC-4 is script-proven.\n")
        _write(os.path.join(scenarios, "a.yml"), "\n".join([
            "# header comment only",
            "scenarios:",
            "  - id: one",
            "    acceptance: AC-1",
            "  - id: two",
            "    acceptance: AC-7",
            "  - id: three",
            ""]))
        findings = check_scenarios.check(scenarios, requirements)
        self.assertEqual(findings, [
            "AC-2 is a declared conversation-shape acceptance scenario but no scenario "
            "exercises it",
            "AC-3 is in REQUIREMENTS section 13 but is neither scenario-covered nor "
            "declared script-proven",
            "a scenario targets AC-7, which is not a section-13 acceptance scenario",
        ])

    def test_scenarios_check_fails_loudly_when_section13_is_empty(self):
        root = self._scratch()
        requirements = os.path.join(root, "REQUIREMENTS.md")
        _write(requirements, "# Requirements\n\nNo section thirteen.\n")
        os.makedirs(os.path.join(root, "scenarios"))
        self.assertEqual(
            check_scenarios.check(os.path.join(root, "scenarios"), requirements),
            ["no section-13 acceptance scenarios were parsed from REQUIREMENTS.md"])

    # check_host_verdicts

    def test_host_verdicts_main_on_the_committed_files_exits_zero(self):
        code, payload = _run_main(check_host_verdicts, [])
        self.assertEqual(code, 0, payload)
        self.assertTrue(payload["ok"])

    def test_host_verdicts_script_exits_one_on_a_bad_file(self):
        missing = os.path.join(self._scratch(), "nope.md")
        code, out, _err = _run_as_script(check_host_verdicts, ["--host-file", missing])
        self.assertEqual(code, 1)
        payload = json.loads(out)
        self.assertFalse(payload["ok"])
        self.assertIn("<missing>", payload["findings"][0])

    def test_host_verdicts_skips_short_rows_and_resets_after_a_table(self):
        path = os.path.join(self._scratch(), "host.md")
        _write(path, "\n".join([
            "| Unknown | Verdict | Evidence |",
            "| --- | --- | --- |",
            "| U-1 | pending |",
            "| U-2 | installed | log line |",
            "",
            "| Not a verdict table | still not |",
            "| U-3 | shipped |",
            ""]))
        rows = check_host_verdicts.parse_rows([path])
        self.assertEqual([r["label"] for r in rows], ["U-2"])
        self.assertEqual(check_host_verdicts.check([path]), [])


if __name__ == "__main__":
    unittest.main()
