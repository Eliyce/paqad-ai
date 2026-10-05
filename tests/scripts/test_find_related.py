#!/usr/bin/env python3
"""Unit tests for shared/scripts/find_related.py (FR-6, GRD-2).

Standard library only (Python 3.9+). No network. Writes only under a temporary folder.
Asserts that the ranking is deterministic, that it picks the obviously matching module from a
small registry fixture, and that equal-score ties fall back to registry order.
"""

import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
SHARED_SCRIPTS = os.path.join(REPO_ROOT, "shared", "scripts")
if SHARED_SCRIPTS not in sys.path:
    sys.path.insert(0, SHARED_SCRIPTS)

import find_related  # noqa: E402

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


if __name__ == "__main__":
    unittest.main()
