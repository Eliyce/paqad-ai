#!/usr/bin/env python3
"""Unit tests for shared/scripts/find_related.py (FR-6, GRD-2).

Standard library only (Python 3.9+). No network. Writes only under a temporary folder.
Asserts that the ranking is deterministic, that it picks the obviously matching module from a
small registry fixture, and that equal-score ties fall back to registry order.
"""

import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
SHARED_SCRIPTS = os.path.join(REPO_ROOT, "shared", "scripts")
if SHARED_SCRIPTS not in sys.path:
    sys.path.insert(0, SHARED_SCRIPTS)

import find_related  # noqa: E402

FIXTURE_MODULES = os.path.join(REPO_ROOT, "tests", "evals", "fixture-repo", "docs", "modules")
FIXTURE_PLAIN_NAMES = [
    ("data-export", "Data export"),
    ("members", "Member accounts"),
    ("orders", "Orders"),
    ("returns", "Returns and refunds"),
    ("subscriptions", "Subscriptions"),
]
OUTPUT_KEYS = {"module", "plain_name", "score", "matched_terms"}


def write(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(content)


def run_main(argv):
    out = io.StringIO()
    err = io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = find_related.main(argv)
    return code, out.getvalue(), err.getvalue()

REGISTRY = """# Module registry

| Module | Plain name | Layer | Features |
|---|---|---|---|
| returns | Returns and refunds | domain | request-return, inspect-return |
| loyalty | Loyalty points | domain | earn-points |
| billing | Billing and invoices | domain | issue-invoice |
"""

# A registry where two modules share a term, to prove tie-breaking by registry order.
TIE_REGISTRY = """# Module registry

| Module | Plain name | Layer | Features |
|---|---|---|---|
| alpha | Orders alpha | domain | place-order |
| bravo | Orders bravo | domain | place-order |
"""


class ParseTest(unittest.TestCase):
    def test_parser_skips_header_and_separator(self):
        rows = find_related.parse_registry(REGISTRY)
        self.assertEqual([r["module"] for r in rows], ["returns", "loyalty", "billing"])

    def test_parser_skips_rows_with_too_few_cells(self):
        rows = find_related.parse_registry(REGISTRY + "| short | row |\n")
        self.assertEqual([r["module"] for r in rows], ["returns", "loyalty", "billing"])

    def test_repeated_query_terms_count_once(self):
        rows = find_related.parse_registry(REGISTRY)
        ranked = find_related.rank(rows, "refund refund refund")
        self.assertEqual(ranked[0]["matched_terms"], ["refund"])
        self.assertEqual(ranked[0]["score"], 1)


class RankTest(unittest.TestCase):
    def test_picks_the_obvious_module(self):
        rows = find_related.parse_registry(REGISTRY)
        ranked = find_related.rank(rows, "let shoppers request a refund on a return")
        self.assertTrue(ranked)
        self.assertEqual(ranked[0]["module"], "returns")
        self.assertGreater(ranked[0]["score"], 0)
        self.assertIn("plain_name", ranked[0])
        self.assertIn("matched_terms", ranked[0])

    def test_ranking_is_deterministic(self):
        rows = find_related.parse_registry(REGISTRY)
        query = "refund a return and keep loyalty points"
        first = find_related.rank(rows, query)
        second = find_related.rank(rows, query)
        self.assertEqual(first, second)

    def test_no_match_returns_empty(self):
        rows = find_related.parse_registry(REGISTRY)
        self.assertEqual(find_related.rank(rows, "quantum teleportation widget"), [])

    def test_ties_fall_back_to_registry_order(self):
        rows = find_related.parse_registry(TIE_REGISTRY)
        ranked = find_related.rank(rows, "place an order")
        self.assertEqual([r["module"] for r in ranked], ["alpha", "bravo"])
        self.assertEqual(ranked[0]["score"], ranked[1]["score"])

    def test_output_fields(self):
        rows = find_related.parse_registry(REGISTRY)
        ranked = find_related.rank(rows, "refund on a return")
        for item in ranked:
            self.assertEqual(set(item), {"module", "plain_name", "score", "matched_terms"})


class CliTest(unittest.TestCase):
    def test_missing_registry_exits_one(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = os.path.join(tmp, "nope.md")
            code = find_related.main(["--registry", missing, "--query", "x"])
            self.assertEqual(code, 1)

    def test_cli_runs_on_a_written_registry(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "modules.md")
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(REGISTRY)
            code = find_related.main(["--registry", path, "--query", "refund"])
            self.assertEqual(code, 0)



class ModulesDirRowsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def summary(self, area):
        return os.path.join(self.tmp, area, "index", "summary.md")

    def test_real_fixture_rows_match_registry_row_shape(self):
        rows = find_related.rows_from_modules_dir(FIXTURE_MODULES)
        registry_keys = set(find_related.parse_registry(REGISTRY)[0])
        self.assertEqual([(r["module"], r["plain_name"]) for r in rows], FIXTURE_PLAIN_NAMES)
        for row in rows:
            self.assertEqual(set(row), registry_keys)
            self.assertEqual((row["layer"], row["features"]), ("", ""))
            self.assertTrue(row["terms"])

    def test_skips_missing_and_empty_summaries_and_falls_back_to_folder_name(self):
        os.makedirs(os.path.join(self.tmp, "alpha", "index"))
        write(self.summary("bravo"), "  \n")
        write(self.summary("charlie-area"), "No heading here, just the refund text.")
        rows = find_related.rows_from_modules_dir(self.tmp)
        self.assertEqual([r["module"] for r in rows], ["charlie-area"])
        self.assertEqual(rows[0]["plain_name"], "charlie-area")
        self.assertEqual(rows[0]["terms"], {"charlie", "area", "heading", "here", "just", "the",
                                            "refund", "text"})

    def test_plain_name_is_first_heading_line_even_when_not_first(self):
        write(self.summary("orders"), "Intro line\n#Not a heading\n#  Order handling  \n# Later")
        rows = find_related.rows_from_modules_dir(self.tmp)
        self.assertEqual(rows[0]["plain_name"], "Order handling")

    def test_missing_folder_gives_no_rows(self):
        self.assertEqual(find_related.rows_from_modules_dir(os.path.join(self.tmp, "nope")), [])

    def test_rank_on_folder_rows_is_deterministic_with_sorted_ties(self):
        write(self.summary("zeta"), "# Invoices\nBilling and invoices for orders.")
        write(self.summary("alpha"), "# Loyalty\nPoints for orders.")
        write(self.summary("mike"), "# Returns\nRefunds for a returned parcel.")
        rows = find_related.rows_from_modules_dir(self.tmp)
        first = find_related.rank(rows, "refunds for a returned parcel")
        self.assertEqual(first[0]["module"], "mike")
        self.assertEqual(first, find_related.rank(rows, "refunds for a returned parcel"))
        ties = find_related.rank(rows, "orders")
        self.assertEqual([r["module"] for r in ties], ["alpha", "zeta"])
        self.assertEqual(ties[0]["score"], ties[1]["score"])


class ModulesDirCliTest(unittest.TestCase):
    def test_fixture_cli_prints_ranked_list(self):
        code, out, err = run_main(["--modules-dir", FIXTURE_MODULES, "--query", "refund a return"])
        self.assertEqual(code, 0)
        self.assertEqual(err, "")
        ranked = json.loads(out)
        self.assertEqual(ranked[0]["module"], "returns")
        for item in ranked:
            self.assertEqual(set(item), OUTPUT_KEYS)

    def test_no_match_is_an_empty_list_with_exit_zero(self):
        code, out, _ = run_main(["--modules-dir", FIXTURE_MODULES, "--query", "xylophone quasar"])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out), [])

    def test_missing_modules_dir_exits_one_with_error_on_stderr(self):
        with tempfile.TemporaryDirectory() as tmp:
            code, out, err = run_main(["--modules-dir", os.path.join(tmp, "nope"), "--query", "x"])
        self.assertEqual(code, 1)
        self.assertEqual(out, "")
        payload = json.loads(err)
        self.assertFalse(payload["ok"])
        self.assertIn("nope", payload["error"])

    def test_modules_dir_that_is_a_file_exits_one(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "modules.md")
            write(path, REGISTRY)
            code, out, err = run_main(["--modules-dir", path, "--query", "x"])
        self.assertEqual(code, 1)
        self.assertEqual(out, "")
        self.assertFalse(json.loads(err)["ok"])

    def test_folder_without_summaries_exits_one_never_empty_list(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.makedirs(os.path.join(tmp, "orders", "index"))
            write(os.path.join(tmp, "returns", "index", "summary.md"), "\n")
            code, out, err = run_main(["--modules-dir", tmp, "--query", "orders"])
        self.assertEqual(code, 1)
        self.assertEqual(out, "")
        self.assertIn("no module summaries were found", json.loads(err)["error"])

    def test_registry_and_modules_dir_together_is_a_usage_error(self):
        self.assert_usage_error(["--registry", "a.md", "--modules-dir", "docs", "--query", "x"])

    def test_neither_source_is_a_usage_error(self):
        self.assert_usage_error(["--query", "x"])

    def test_missing_query_is_a_usage_error(self):
        self.assert_usage_error(["--modules-dir", FIXTURE_MODULES])

    def assert_usage_error(self, argv):
        with redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                find_related.main(argv)
        self.assertEqual(ctx.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
