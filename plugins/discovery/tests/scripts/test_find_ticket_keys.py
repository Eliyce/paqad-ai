#!/usr/bin/env python3

import io
import json
import os
import subprocess
import sys
import unittest
from contextlib import redirect_stdout

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
SHARED_SCRIPTS = os.path.join(REPO_ROOT, "shared", "scripts")
if SHARED_SCRIPTS not in sys.path:
    sys.path.insert(0, SHARED_SCRIPTS)

import find_ticket_keys  # noqa: E402

SCRIPT = os.path.join(SHARED_SCRIPTS, "find_ticket_keys.py")


def counts(result):
    return [(entry["prefix"], entry["count"]) for entry in result["jira_prefixes"]]


def shaped(*pairs, github_refs=0):
    prefixes = [{"prefix": prefix, "count": count, "examples": []} for prefix, count in pairs]
    return {"lines_read": 1, "jira_prefixes": prefixes, "github_refs": github_refs}


class ScanTest(unittest.TestCase):
    def test_ac22_mixed_case_branches_are_uppercased(self):
        """@obligation AC-22"""
        result = find_ticket_keys.scan([
            "feature/abc-120-x",
            "fix/Abc-121-y",
            "ABC-120 add the export",
        ])
        self.assertEqual(counts(result), [("ABC", 3)])
        self.assertEqual(result["jira_prefixes"][0]["examples"], ["ABC-120", "ABC-121"])
        self.assertEqual(result["lines_read"], 3)

    def test_ac22_every_ignored_prefix_is_dropped(self):
        """@obligation AC-22"""
        lines = ["bump utf-8 handling", "iso-8601 dates", "sha-256 digest", "http-2 client",
                 "https-443 port", "rfc-7231 parsing", "cve-2024 fix", "v-2 api"]
        result = find_ticket_keys.scan(lines)
        self.assertEqual(result["jira_prefixes"], [])
        self.assertEqual(result["lines_read"], 8)
        for prefix in ("UTF", "ISO", "SHA", "HTTP", "HTTPS", "RFC", "CVE", "V"):
            self.assertIn(prefix, find_ticket_keys.IGNORED_PREFIXES)

    def test_ac26_ties_go_to_the_prefix_on_the_newer_line(self):
        """@obligation AC-22 AC-26"""
        result = find_ticket_keys.scan(["OLD-1 later", "NEW-1 first", "OLD-2", "NEW-2"])
        self.assertEqual(counts(result), [("OLD", 2), ("NEW", 2)])
        result = find_ticket_keys.scan(["NEW-1", "OLD-1", "OLD-2", "NEW-2"])
        self.assertEqual(counts(result), [("NEW", 2), ("OLD", 2)])

    def test_ac22_github_only_refs_are_counted_apart(self):
        """@obligation AC-22"""
        result = find_ticket_keys.scan(["Fix the export (#123)", "Merge pull request #45 from x",
                                        "issue #7 and #8", "colour &#39; entity"])
        self.assertEqual(result["jira_prefixes"], [])
        self.assertEqual(result["github_refs"], 4)
        self.assertEqual(find_ticket_keys.verdict(result), "github")

    def test_ac22_empty_input_reads_no_line(self):
        result = find_ticket_keys.scan(["", "   "])
        self.assertEqual(result, {"lines_read": 0, "jira_prefixes": [], "github_refs": 0})
        self.assertEqual(find_ticket_keys.verdict(result), "ask")

    def test_ac22_examples_are_deduplicated_and_capped(self):
        result = find_ticket_keys.scan(["ABC-1", "ABC-1", "ABC-2", "ABC-3", "ABC-4"])
        self.assertEqual(result["jira_prefixes"][0]["examples"], ["ABC-1", "ABC-2", "ABC-3"])
        self.assertEqual(result["jira_prefixes"][0]["count"], 5)

    def test_ac25_version_words_stay_below_the_floor(self):
        """@obligation AC-25"""
        result = find_ticket_keys.scan(["upgrade to node-18", "react-19 bump", "es-2020 target",
                                        "build for win-32"])
        self.assertTrue(all(entry["count"] < 3 for entry in result["jira_prefixes"]))
        self.assertEqual(find_ticket_keys.verdict(result), "ask")


class VerdictTest(unittest.TestCase):
    def test_ac23_the_clear_prefix_rule(self):
        """@obligation AC-23"""
        self.assertEqual(find_ticket_keys.verdict(shaped(("ABC", 3), ("XYZ", 1))), "clear")
        self.assertEqual(find_ticket_keys.verdict(shaped(("ABC", 2))), "ask")
        self.assertEqual(find_ticket_keys.verdict(shaped(("ABC", 6), ("XYZ", 3))), "clear")
        self.assertEqual(find_ticket_keys.verdict(shaped(("ABC", 5), ("XYZ", 3))), "several")

    def test_ac24_one_prefix_with_one_or_two_hits_is_asked(self):
        """@obligation AC-24"""
        for hits in (1, 2):
            self.assertEqual(find_ticket_keys.verdict(shaped(("ABC", hits))), "ask")
        self.assertEqual(find_ticket_keys.verdict(shaped(("ABC", 3))), "clear")

    def test_ac20_jira_keys_win_over_github_refs(self):
        self.assertEqual(find_ticket_keys.verdict(shaped(("ABC", 4), github_refs=9)), "clear")


class CliTest(unittest.TestCase):
    def test_ac22_main_reads_stdin_and_prints_the_json(self):
        out = io.StringIO()
        with redirect_stdout(out):
            code = find_ticket_keys.main([], io.StringIO("feature/abc-1\nABC-2 x\n#3\n"))
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out.getvalue()), {
            "lines_read": 3,
            "jira_prefixes": [{"prefix": "ABC", "count": 2, "examples": ["ABC-1", "ABC-2"]}],
            "github_refs": 1,
        })

    def test_ac22_the_script_runs_on_its_own_with_no_arguments(self):
        result = subprocess.run([sys.executable, SCRIPT], input="", capture_output=True,
                                text=True, check=False)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout)["lines_read"], 0)

    def test_ac22_the_script_imports_only_the_standard_library(self):
        with open(SCRIPT, "r", encoding="utf-8") as handle:
            text = handle.read()
        imports = sorted(line.split()[1] for line in text.splitlines()
                         if line.startswith("import "))
        self.assertEqual(imports, ["argparse", "json", "re", "sys"])
        for word in ("open(", "urllib", "socket", "subprocess"):
            self.assertNotIn(word, text)


if __name__ == "__main__":
    unittest.main()
