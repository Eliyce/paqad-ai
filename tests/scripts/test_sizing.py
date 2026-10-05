#!/usr/bin/env python3
"""Unit tests for skills/size-work/scripts/compare_sizes.py.

Standard library only (Python 3.9+). No network. Writes nothing outside a temporary folder.

Proves:
  AC-35  suggest returns two to five closest comparables with keys and links, drivers, a confidence
         and a size, always labelled "suggested size" and never a date, and writes no field.
  AC-36  template area docs lower the confidence one notch and the reason says so.
  AC-37  set refuses to overwrite a size field that already holds a value unless --replace is asked.
  EST-2/3  fewer than two comparables is reported honestly, with no invented size.
"""

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
SHARED_SCRIPTS = os.path.join(REPO_ROOT, "shared", "scripts")
SIZE_SCRIPTS = os.path.join(REPO_ROOT, "skills", "size-work", "scripts")
for entry in (SHARED_SCRIPTS, SIZE_SCRIPTS):
    if entry not in sys.path:
        sys.path.insert(0, entry)

import compare_sizes  # noqa: E402

SCALE = {"scale": ["XS", "S", "M", "L", "XL"]}


def target():
    return {
        "key": "ABC-10",
        "summary": "Export an order to a CSV file for returns",
        "labels": ["returns", "export"],
    }


def pool(sizes=("M", "M", "M")):
    rows = []
    for index, size in enumerate(sizes, start=1):
        rows.append({
            "key": "DONE-{0}".format(index),
            "link": "https://tracker.example/browse/DONE-{0}".format(index),
            "size": size,
            "summary": "Export an order report to CSV for returns",
            "labels": ["returns", "export"],
        })
    return rows


class SuggestTest(unittest.TestCase):
    def test_returns_comparables_drivers_confidence_label_and_no_write(self):
        # AC-35
        suggestion = compare_sizes.suggest(target(), pool(("M", "M", "M")), SCALE)
        self.assertTrue(2 <= len(suggestion["comparables"]) <= 5)
        for comp in suggestion["comparables"]:
            self.assertIn("key", comp)
            self.assertTrue(comp["link"].startswith("https://"))
            self.assertIn("size", comp)
        self.assertTrue(suggestion["drivers"])
        self.assertIn(suggestion["confidence"], ("low", "medium", "high"))
        self.assertEqual(suggestion["label"], "suggested size")
        self.assertEqual(suggestion["size"], "M")
        # The output is a size label, never a date.
        self.assertIn(suggestion["size"], SCALE["scale"])
        # suggest returns only a suggestion; it has no write channel at all.
        self.assertNotIn("write", suggestion)

    def test_disagreeing_comparables_give_a_range_and_lower_confidence(self):
        suggestion = compare_sizes.suggest(target(), pool(("S", "M", "L")), SCALE)
        self.assertIsNotNone(suggestion["range"])
        self.assertEqual(suggestion["range"], ["S", "L"])
        self.assertIn(suggestion["confidence"], ("low", "medium"))

    def test_high_confidence_when_three_agree(self):
        suggestion = compare_sizes.suggest(target(), pool(("M", "M", "M")), SCALE)
        self.assertEqual(suggestion["confidence"], "high")


class TemplateDocsTest(unittest.TestCase):
    def test_template_area_docs_lower_confidence_with_reason(self):
        # AC-36
        base = compare_sizes.suggest(target(), pool(("M", "M", "M")), SCALE, area_docs_text="Real area notes: the returns area exports orders.")
        templated = compare_sizes.suggest(
            target(), pool(("M", "M", "M")), SCALE,
            area_docs_text="## Overview\nTODO: describe the returns area.")
        order = compare_sizes.CONFIDENCE_ORDER
        self.assertLess(order.index(templated["confidence"]), order.index(base["confidence"]))
        self.assertIn("template", templated["confidence_reason"].lower())

    def test_is_template_docs_detects_empty_and_markers(self):
        self.assertTrue(compare_sizes.is_template_docs(""))
        self.assertTrue(compare_sizes.is_template_docs("Lorem ipsum dolor sit amet"))
        self.assertFalse(compare_sizes.is_template_docs("A real paragraph about refunds."))
        self.assertFalse(compare_sizes.is_template_docs(None))


class FewComparablesTest(unittest.TestCase):
    def test_fewer_than_two_comparables_reports_and_invents_nothing(self):
        # EST-2/3 honesty: only one pool ticket overlaps the target.
        thin_pool = [{
            "key": "DONE-1", "link": "https://tracker.example/browse/DONE-1",
            "size": "M", "summary": "Export an order report for returns",
            "labels": ["returns", "export"],
        }, {
            "key": "DONE-2", "link": "https://tracker.example/browse/DONE-2",
            "size": "S", "summary": "Rotate the database backup credentials",
            "labels": ["infra", "security"],
        }]
        suggestion = compare_sizes.suggest(target(), thin_pool, SCALE)
        self.assertLess(len(suggestion["comparables"]), 2)
        self.assertIsNone(suggestion["size"])
        self.assertIsNone(suggestion["range"])
        self.assertIn("fewer than two", suggestion["confidence_reason"].lower())


class SetGuardTest(unittest.TestCase):
    def test_refuses_overwrite_of_populated_field_without_replace(self):
        # AC-37
        write, reason = compare_sizes.decide_write("M", replace=False)
        self.assertFalse(write)
        self.assertIn("refus", reason.lower())

    def test_allows_overwrite_with_replace(self):
        write, reason = compare_sizes.decide_write("M", replace=True)
        self.assertTrue(write)
        self.assertIn("replace", reason.lower())

    def test_allows_write_on_empty_field(self):
        write, _ = compare_sizes.decide_write("", replace=False)
        self.assertTrue(write)


class CliExitTest(unittest.TestCase):
    def test_set_on_populated_field_exits_one(self):
        code = compare_sizes.main(["set", "--field-value", "M"])
        self.assertEqual(code, 1)

    def test_set_with_replace_exits_zero(self):
        code = compare_sizes.main(["set", "--field-value", "M", "--replace"])
        self.assertEqual(code, 0)


if __name__ == "__main__":
    unittest.main()
