#!/usr/bin/env python3
"""Unit tests for shared/scripts/check_onboarded.py (GRD-1: ready, partly ready, not set up).

Standard library only (Python 3.9+). No network. Writes only under a temporary folder.
Uses the real tests/evals/fixture-repo as a ready tree (RULE-9 real-resource test), builds every
other tree in a temporary folder, and asserts the exact messages, payloads and exit codes.
"""

import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
ONBOARD_SCRIPTS = os.path.join(REPO_ROOT, "shared", "scripts")
if ONBOARD_SCRIPTS not in sys.path:
    sys.path.insert(0, ONBOARD_SCRIPTS)

import check_onboarded  # noqa: E402

FIXTURE_ROOT = os.path.join(REPO_ROOT, "tests", "evals", "fixture-repo")
FIXTURE_AREAS = ["data-export", "members", "orders", "returns", "subscriptions"]
EXPECTED_STOP = ("This repository isn't set up for this yet. Ask your engineering team to "
                 "onboard it with paqad, then come back.")
EXPECTED_PARTLY = ("This project's list of areas is missing, so I'm working from the area "
                   "summaries it has. Areas without a summary are shown as unknown.")
EM_DASH = chr(0x2014)
EN_DASH = chr(0x2013)


def run_cli(root):
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        code = check_onboarded.main(["--root", root])
    return code, buffer.getvalue()


def write(path, content, mode="w"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if "b" in mode:
        with open(path, mode) as handle:
            handle.write(content)
    else:
        with open(path, mode, encoding="utf-8") as handle:
            handle.write(content)


class TempTreeCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def copy_fixture(self):
        dest = os.path.join(self.tmp, "repo")
        shutil.copytree(FIXTURE_ROOT, dest)
        return dest

    def registry(self, repo):
        return os.path.join(repo, "docs", "instructions", "registries", "modules.md")

    def summary(self, repo, area):
        return os.path.join(repo, "docs", "modules", area, "index", "summary.md")


class ReadyFixtureTest(unittest.TestCase):
    def test_real_fixture_is_ready(self):
        state = check_onboarded.onboarded_state(FIXTURE_ROOT)
        self.assertEqual(state["state"], check_onboarded.READY)
        self.assertEqual(state["summarised_areas"], FIXTURE_AREAS)
        self.assertEqual(state["unknown_areas"], [])
        self.assertTrue(check_onboarded.is_onboarded(FIXTURE_ROOT))

    def test_cli_prints_exact_ready_payload(self):
        code, out = run_cli(FIXTURE_ROOT)
        self.assertEqual(code, 0)
        self.assertEqual(out.strip(), '{"ok": true, "state": "ready", "unknown_areas": []}')

    def test_default_root_is_the_working_folder(self):
        cwd = os.getcwd()
        self.addCleanup(os.chdir, cwd)
        os.chdir(FIXTURE_ROOT)
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            code = check_onboarded.main([])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(buffer.getvalue())["state"], "ready")


class ConstantsTest(unittest.TestCase):
    def test_stop_message_is_unchanged(self):
        self.assertEqual(check_onboarded.STOP_MESSAGE, EXPECTED_STOP)

    def test_partly_message_is_exact_and_plain(self):
        message = check_onboarded.PARTLY_MESSAGE
        self.assertEqual(message, EXPECTED_PARTLY)
        self.assertLessEqual(len(message.split()), 40)
        for banned in ("/", ".md", EM_DASH, EN_DASH):
            self.assertNotIn(banned, message)

    def test_state_names(self):
        self.assertEqual(
            (check_onboarded.READY, check_onboarded.PARTLY_READY, check_onboarded.NOT_SET_UP),
            ("ready", "partly-ready", "not-set-up"),
        )


class PartlyReadyTest(TempTreeCase):
    def test_missing_modules_registry_is_partly_ready(self):
        repo = self.copy_fixture()
        os.remove(self.registry(repo))
        self.assertFalse(check_onboarded.is_onboarded(repo))
        self.assertEqual(check_onboarded.onboarded_state(repo)["state"], check_onboarded.PARTLY_READY)
        code, out = run_cli(repo)
        payload = json.loads(out)
        self.assertEqual(code, 0)
        self.assertEqual(list(payload), ["ok", "state", "message", "unknown_areas"])
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["state"], "partly-ready")
        self.assertEqual(payload["message"], EXPECTED_PARTLY)
        self.assertEqual(payload["unknown_areas"], [])

    def test_whitespace_registry_counts_as_absent(self):
        repo = self.copy_fixture()
        write(self.registry(repo), "  \n\t\n")
        self.assertEqual(check_onboarded.onboarded_state(repo)["state"], check_onboarded.PARTLY_READY)

    def test_registry_that_is_a_folder_counts_as_absent(self):
        repo = self.copy_fixture()
        os.remove(self.registry(repo))
        os.makedirs(self.registry(repo))
        self.assertEqual(check_onboarded.onboarded_state(repo)["state"], check_onboarded.PARTLY_READY)

    def test_partly_ready_unknown_areas_are_sorted(self):
        repo = self.copy_fixture()
        os.remove(self.registry(repo))
        for area in ("zeta-area", "alpha-area"):
            os.makedirs(os.path.join(repo, "docs", "modules", area))
        code, out = run_cli(repo)
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["unknown_areas"], ["alpha-area", "zeta-area"])


class UnknownAreaTest(TempTreeCase):
    def test_area_without_summary_is_unknown_and_state_stays_ready(self):
        repo = self.copy_fixture()
        os.makedirs(os.path.join(repo, "docs", "modules", "billing", "index"))
        os.makedirs(self.summary(repo, "loyalty"))
        state = check_onboarded.onboarded_state(repo)
        self.assertEqual(state["state"], check_onboarded.READY)
        self.assertEqual(state["unknown_areas"], ["billing", "loyalty"])
        self.assertEqual(state["summarised_areas"], FIXTURE_AREAS)

    def test_empty_and_whitespace_summaries_are_unknown(self):
        repo = self.copy_fixture()
        write(self.summary(repo, "orders"), "")
        write(self.summary(repo, "returns"), "   \n\n ")
        state = check_onboarded.onboarded_state(repo)
        self.assertEqual(state["unknown_areas"], ["orders", "returns"])
        self.assertNotIn("orders", state["summarised_areas"])
        self.assertNotIn("returns", state["summarised_areas"])

    def test_summary_that_is_not_utf8_is_unknown(self):
        repo = self.copy_fixture()
        write(self.summary(repo, "members"), b"# Members\n\xff\xfe\xfa bad bytes\n", mode="wb")
        state = check_onboarded.onboarded_state(repo)
        self.assertEqual(state["unknown_areas"], ["members"])
        self.assertEqual(state["state"], check_onboarded.READY)

    def test_area_summaries_reads_stripped_text(self):
        modules = os.path.join(self.tmp, "modules")
        write(os.path.join(modules, "orders", "index", "summary.md"), "\n# Orders\n\n")
        self.assertEqual(check_onboarded.area_summaries(modules), [("orders", "# Orders")])

    def test_area_summaries_on_missing_or_file_path_is_empty(self):
        plain_file = os.path.join(self.tmp, "file.md")
        write(plain_file, "text")
        self.assertEqual(check_onboarded.area_summaries(os.path.join(self.tmp, "nope")), [])
        self.assertEqual(check_onboarded.area_summaries(plain_file), [])


class NotSetUpTest(TempTreeCase):
    def assert_not_set_up(self, root):
        self.assertEqual(check_onboarded.onboarded_state(root)["state"], check_onboarded.NOT_SET_UP)
        self.assertFalse(check_onboarded.is_onboarded(root))
        code, out = run_cli(root)
        self.assertEqual(code, 1)
        self.assertEqual(
            json.loads(out), {"ok": False, "state": "not-set-up", "message": EXPECTED_STOP}
        )
        self.assertEqual(list(json.loads(out)), ["ok", "state", "message"])

    def test_registry_with_every_summary_emptied(self):
        repo = self.copy_fixture()
        for area in FIXTURE_AREAS:
            write(self.summary(repo, area), "\n")
        self.assert_not_set_up(repo)
        self.assertEqual(check_onboarded.onboarded_state(repo)["unknown_areas"], FIXTURE_AREAS)

    def test_docs_modules_removed(self):
        repo = self.copy_fixture()
        shutil.rmtree(os.path.join(repo, "docs", "modules"))
        self.assert_not_set_up(repo)

    def test_registry_with_area_folders_but_no_summaries(self):
        repo = self.copy_fixture()
        for area in FIXTURE_AREAS:
            os.remove(self.summary(repo, area))
        self.assert_not_set_up(repo)

    def test_docs_instructions_only(self):
        repo = os.path.join(self.tmp, "repo")
        shutil.copytree(
            os.path.join(FIXTURE_ROOT, "docs", "instructions"),
            os.path.join(repo, "docs", "instructions"),
        )
        self.assertTrue(os.path.isfile(self.registry(repo)))
        self.assertEqual(os.listdir(os.path.join(repo, "docs")), ["instructions"])
        self.assert_not_set_up(repo)

    def test_empty_tree(self):
        self.assert_not_set_up(self.tmp)

    def test_root_that_does_not_exist(self):
        self.assert_not_set_up(os.path.join(self.tmp, "missing-root"))


class DeterministicOrderTest(TempTreeCase):
    def test_areas_sorted_and_hidden_entries_ignored(self):
        modules = os.path.join(self.tmp, "docs", "modules")
        for area in ("zulu", "mike", "alpha"):
            write(os.path.join(modules, area, "index", "summary.md"), "# " + area)
        os.makedirs(os.path.join(modules, "kilo"))
        os.makedirs(os.path.join(modules, "bravo"))
        write(os.path.join(modules, ".git", "index", "summary.md"), "# hidden")
        write(os.path.join(modules, "notes.md"), "a plain file")
        first = check_onboarded.onboarded_state(self.tmp)
        second = check_onboarded.onboarded_state(self.tmp)
        self.assertEqual(first, second)
        self.assertEqual(first["summarised_areas"], ["alpha", "mike", "zulu"])
        self.assertEqual(first["unknown_areas"], ["bravo", "kilo"])
        self.assertEqual(first["state"], check_onboarded.PARTLY_READY)


class UnreadableTest(TempTreeCase):
    def test_unlistable_modules_folder_counts_as_no_areas(self):
        repo = self.copy_fixture()
        with mock.patch.object(Path, "iterdir", side_effect=PermissionError("denied")):
            self.assertEqual(check_onboarded.area_summaries(os.path.join(repo, "docs", "modules")), [])
            code, out = run_cli(repo)
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(out)["state"], "not-set-up")

    def test_unstattable_file_counts_as_missing(self):
        repo = self.copy_fixture()
        with mock.patch.object(Path, "is_file", side_effect=PermissionError("denied")):
            state = check_onboarded.onboarded_state(repo)
            code, out = run_cli(repo)
        self.assertEqual(state["state"], check_onboarded.NOT_SET_UP)
        self.assertEqual(state["unknown_areas"], FIXTURE_AREAS)
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(out)["message"], EXPECTED_STOP)

    def test_unreadable_summary_is_unknown(self):
        repo = self.copy_fixture()
        with mock.patch.object(Path, "read_text", side_effect=PermissionError("denied")):
            state = check_onboarded.onboarded_state(repo)
        self.assertEqual(state["state"], check_onboarded.NOT_SET_UP)
        self.assertEqual(state["summarised_areas"], [])


class UsageTest(unittest.TestCase):
    def test_unknown_argument_is_a_usage_error(self):
        with redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                check_onboarded.main(["--bogus"])
        self.assertEqual(ctx.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
