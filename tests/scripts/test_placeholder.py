#!/usr/bin/env python3
"""Unit tests for shared/scripts/detect_placeholder.py (FR-7, GRD-4).

Standard library only (Python 3.9+). No network. Writes only under a temporary folder.
Uses the real shared/references/template-markers.md and the real fixture business.md (RULE-9
real-resource test) to prove that a document with a real section and a template section reports
both correctly.
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

import detect_placeholder  # noqa: E402

MARKERS = os.path.join(REPO_ROOT, "shared", "references", "template-markers.md")
BUSINESS_MD = os.path.join(
    REPO_ROOT, "tests", "evals", "fixture-repo", "docs", "modules",
    "returns", "features", "request-return", "business.md")


def statuses(path, markers=MARKERS):
    with open(path, "r", encoding="utf-8") as handle:
        document = handle.read()
    sections = detect_placeholder.classify(
        detect_placeholder.split_sections(document),
        detect_placeholder.load_markers(markers))
    return {s["heading"]: s for s in sections}


class RealMarkersTest(unittest.TestCase):
    def test_markers_file_loads(self):
        markers = detect_placeholder.load_markers(MARKERS)
        self.assertIn("Describe the business purpose of the", markers)
        self.assertIn("Capture the main journeys for", markers)
        # Headings in the markers file are ignored.
        self.assertFalse(any(m.startswith("#") for m in markers))


class FixtureDocTest(unittest.TestCase):
    def test_reports_both_real_and_template_sections(self):
        by_heading = statuses(BUSINESS_MD)
        self.assertEqual(by_heading["Business rules"]["status"], "real")
        self.assertEqual(by_heading["Roles"]["status"], "real")
        self.assertEqual(
            by_heading["Capture the main user journeys for"]["status"], "template")
        self.assertEqual(
            by_heading["Document the personas that interact with"]["status"], "template")
        # The document holds at least one of each.
        all_status = {s["status"] for s in by_heading.values()}
        self.assertEqual(all_status, {"real", "template"})

    def test_template_sections_report_the_markers_they_hit(self):
        by_heading = statuses(BUSINESS_MD)
        hit = by_heading["Capture the main user journeys for"]["markers_hit"]
        self.assertTrue(hit)
        for marker in hit:
            self.assertIn(marker, detect_placeholder.load_markers(MARKERS))

    def test_real_sections_hit_no_markers(self):
        by_heading = statuses(BUSINESS_MD)
        self.assertEqual(by_heading["Business rules"]["markers_hit"], [])


class IntroProseNotMarkersTest(unittest.TestCase):
    """TD-13: only '- ' bulleted lines are markers; intro prose never loads as a false marker and
    so never flags a real document section."""

    def test_only_bulleted_markers_load(self):
        markers = detect_placeholder.load_markers(MARKERS)
        # Exactly the ten bulleted phrases (seven current generation, three earlier) load.
        self.assertEqual(len(markers), 10)
        self.assertTrue(all("onboarding template phrases" not in m for m in markers))

    def test_intro_prose_does_not_flag_a_real_section(self):
        markers = detect_placeholder.load_markers(MARKERS)
        intro = "These are the onboarding template phrases from both paqad template generations"
        # The intro sentence is not a marker, so a real section that repeats it stays real.
        self.assertTrue(all(intro not in m for m in markers))
        doc = "## Overview\n{0} in this project.\n".format(intro)
        sections = detect_placeholder.classify(
            detect_placeholder.split_sections(doc), markers)
        by_heading = {s["heading"]: s for s in sections}
        self.assertEqual(by_heading["Overview"]["status"], "real")


class SplitTest(unittest.TestCase):
    def test_sections_split_on_headings(self):
        doc = "# Top\nintro\n## A\nreal body\n## B\nDescribe the business purpose of the thing\n"
        sections = detect_placeholder.split_sections(doc)
        headings = [h for h, _ in sections]
        self.assertEqual(headings, ["Top", "A", "B"])

    def test_cli_emits_sections(self):
        import io
        import json
        from contextlib import redirect_stdout
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "doc.md")
            with open(path, "w", encoding="utf-8") as handle:
                handle.write("## Real\nA grounded fact.\n## Gap\nList the rules and invariants that must hold here.\n")
            buffer = io.StringIO()
            with redirect_stdout(buffer):
                code = detect_placeholder.main(["--path", path, "--markers", MARKERS])
            payload = json.loads(buffer.getvalue())
        self.assertEqual(code, 0)
        by_heading = {s["heading"]: s["status"] for s in payload["sections"]}
        self.assertEqual(by_heading["Real"], "real")
        self.assertEqual(by_heading["Gap"], "template")


if __name__ == "__main__":
    unittest.main()
