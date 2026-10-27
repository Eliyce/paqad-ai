#!/usr/bin/env python3
"""Generic mode (v3.0): the plugin answers on any repository at one of three evidence levels.

Covers the file-level, automated acceptance criteria of the generic-mode spec: the new shared
reference evidence-levels.md and its contents, its exact six declarers and byte-identical build copy,
the undeclared-mention build failure, the connect-repository.md and paqad-docs-map.md edits, the
record field, the REQUIREMENTS.md v3.0 edits, and the code-only fixture. The scripts stay byte for
byte unchanged (GM-8, INV-1), so this suite asserts their pinned constants rather than editing them.

Standard library only (Python 3.9+). No network. Reads the source tree; writes only under a
temporary folder.
"""

import os
import re
import shutil
import sys
import tempfile
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SKILLS_ROOT = os.path.join(REPO_ROOT, "skills")
SHARED_ROOT = os.path.join(REPO_ROOT, "shared")
REFERENCES = os.path.join(SHARED_ROOT, "references")
BUILD_DIR = os.path.join(REPO_ROOT, "build")
FIXTURE_CODE_ONLY = os.path.join(REPO_ROOT, "tests", "evals", "fixture-repo-code-only")
for extra_path in (BUILD_DIR, os.path.join(SHARED_ROOT, "scripts")):
    if extra_path not in sys.path:
        sys.path.insert(0, extra_path)

import build  # noqa: E402
import check_onboarded  # noqa: E402

PLUGIN_NAME = "paqad-product-discovery"
EVIDENCE_LEVELS = "references/evidence-levels.md"
DECLARERS = {
    "ask-project", "ground-in-project", "shape-idea", "refine-ticket", "size-work", "get-connected",
}
LEVEL_IDS = ("project-docs", "docs-and-code", "code-only")
SOURCE_LINES = ("paqad, from project docs", "paqad, from docs and code", "paqad, from code only")
VENDOR_PATTERN = re.compile(r"claude|chatgpt|codex|anthropic|openai", re.IGNORECASE)
EM_DASH, EN_DASH = chr(0x2014), chr(0x2013)
MAX_REFERENCE_LINES = 100


def read_text(*parts):
    with open(os.path.join(*parts), "r", encoding="utf-8") as handle:
        return handle.read()


def normalised(text):
    return " ".join(text.split())


def missing(text, phrases):
    flat = normalised(text)
    return [phrase for phrase in phrases if phrase not in flat]


def declared_imports():
    config = build.parse_skills_yml(read_text(BUILD_DIR, "skills.yml"))
    return {skill["name"]: list(skill["imports"]) for skill in config["skills"]}


def published_name_map():
    """Source skill folder name -> published (dist) folder name, from the one build source."""
    config = build.parse_skills_yml(read_text(BUILD_DIR, "skills.yml"))
    return {skill["name"]: build.published_name(skill) for skill in config["skills"]}


class EvidenceLevelsReferenceTest(unittest.TestCase):
    """Spec AC-1 and AC-2, NFR-1: evidence-levels.md owns the levels, source line, nudge and finder,
    stays provider-neutral, under 100 lines and free of em and en dashes."""

    def setUp(self):
        self.path = os.path.join(REFERENCES, "evidence-levels.md")
        self.text = read_text(self.path)

    def test_exists_and_is_within_budget(self):
        self.assertTrue(os.path.isfile(self.path), "evidence-levels.md is missing")
        self.assertLessEqual(len(self.text.splitlines()), MAX_REFERENCE_LINES)
        self.assertIsNone(VENDOR_PATTERN.search(self.text), "vendor name in evidence-levels.md")
        self.assertNotIn(EM_DASH, self.text)
        self.assertNotIn(EN_DASH, self.text)

    def test_names_the_three_levels_and_source_lines(self):
        self.assertEqual(missing(self.text, LEVEL_IDS), [])
        self.assertEqual(missing(self.text, SOURCE_LINES), [])

    def test_states_the_nudge_rules_and_the_code_only_finder_budget(self):
        flat = normalised(self.text)
        for phrase in ("at most once per conversation", "static campaign tag", "never to a purchase",
                       "asks why an answer is thin"):
            self.assertIn(phrase, flat, "nudge rule missing: {0}".format(phrase))
        for phrase in ("names first", "about 15 files per answer", "ask the user to narrow"):
            self.assertIn(phrase, flat, "finder budget missing: {0}".format(phrase))

    def test_install_signal_is_existence_only(self):
        flat = normalised(self.text)
        self.assertIn("tested for existence only and never read", flat)
        self.assertIn("never open it", flat)


class DeclarersAndBuildTest(unittest.TestCase):
    """Spec AC-3 and AC-4: exactly six skills declare evidence-levels.md and name it, the build
    copies it byte-identical into each, and an undeclared mention fails the build."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        build.build(REPO_ROOT, os.path.join(cls.tmp, "dist"))
        cls.skills_root = os.path.join(cls.tmp, "dist", "plugins", PLUGIN_NAME, "skills")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def read_bytes(self, path):
        with open(path, "rb") as handle:
            return handle.read()

    def test_exact_declarers_name_the_file(self):
        declared = declared_imports()
        declarers = {skill for skill, imports in declared.items() if EVIDENCE_LEVELS in imports}
        self.assertEqual(declarers, DECLARERS)
        for skill in sorted(DECLARERS):
            text = read_text(SKILLS_ROOT, skill, "SKILL.md")
            self.assertIn(EVIDENCE_LEVELS, text, "{0} declares but never names it".format(skill))

    def test_shipped_byte_identical_to_exactly_the_declarers(self):
        source = self.read_bytes(os.path.join(SHARED_ROOT, *EVIDENCE_LEVELS.split("/")))
        name_map = published_name_map()
        published_declarers = {name_map[name] for name in DECLARERS}
        for skill in sorted(os.listdir(self.skills_root)):
            built = os.path.join(self.skills_root, skill, *EVIDENCE_LEVELS.split("/"))
            if skill in published_declarers:
                self.assertEqual(self.read_bytes(built), source, skill)
            else:
                self.assertFalse(os.path.exists(built), skill)

    def test_undeclared_mention_fails_the_build(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        source = os.path.join(tmp, "source")
        for sub in ("skills", "shared", "build", "publish"):
            shutil.copytree(os.path.join(REPO_ROOT, sub), os.path.join(source, sub))
        with open(os.path.join(source, "skills", "plan-sprint", "SKILL.md"), "a",
                  encoding="utf-8") as handle:
            handle.write("\nSee " + EVIDENCE_LEVELS + ".\n")
        with self.assertRaises(build.BuildError) as ctx:
            build.build(source, os.path.join(tmp, "dist"))
        self.assertIn(EVIDENCE_LEVELS, str(ctx.exception))


class ConnectRepositoryLevelsTest(unittest.TestCase):
    """Spec AC-5, FR-18: the marks are the four levels, a code-only repository is recommendable, and
    the not-set-up stop rows are gone, while the pinned messages survive (INV-1)."""

    def setUp(self):
        self.text = read_text(REFERENCES, "connect-repository.md")

    def test_four_level_marks_present(self):
        lowered = self.text.lower()
        for mark in ("from project docs", "from docs and code", "from code only", "not checked"):
            self.assertIn(mark, lowered, "missing level mark {0}".format(mark))

    def test_code_only_is_recommendable_and_only_not_checked_is_not(self):
        flat = normalised(self.text)
        self.assertIn("A code-only repository is recommendable", flat)
        self.assertIn("the only unrecommendable state is not checked", flat)

    def test_stop_rows_are_gone(self):
        flat = normalised(self.text)
        self.assertNotIn("Every reachable repository not set up", flat)
        self.assertNotIn("Draft and answer nothing from it", flat)

    def test_pinned_messages_survive(self):
        self.assertIn(check_onboarded.STOP_MESSAGE, self.text)
        self.assertIn(check_onboarded.PARTLY_MESSAGE, self.text)


class DocsMapInversionTest(unittest.TestCase):
    """Spec AC-6, FR-7 to FR-9: code is the baseline for what exists, the GRD-8 wording is scoped to
    paqad docs present, and disagreement says both."""

    def setUp(self):
        self.text = read_text(REFERENCES, "paqad-docs-map.md")

    def test_code_is_the_baseline(self):
        flat = normalised(self.text)
        self.assertIn("Code is the baseline for what exists", flat)

    def test_not_documented_is_scoped_to_paqad_docs_present(self):
        flat = normalised(self.text)
        self.assertIn("it is used only when paqad docs are present", flat)

    def test_disagreement_says_both(self):
        flat = normalised(self.text)
        self.assertIn("The docs say ..., but the code suggests ...", flat)


class RecordEvidenceLevelTest(unittest.TestCase):
    """Spec AC-7, FR-19: the record template carries setup.evidence_level with the three ids and a
    per-today provenance marker."""

    def setUp(self):
        self.text = read_text(SKILLS_ROOT, "product-discovery", "assets", "record-template.md")

    def test_setup_and_today_carry_the_level(self):
        import json
        record = json.loads(self.text[self.text.index("{"):self.text.rindex("}") + 1])
        self.assertIn("evidence_level", record["setup"])
        self.assertTrue(all("evidence_level" in entry for entry in record["today"]))

    def test_field_notes_document_the_three_ids(self):
        self.assertEqual(missing(self.text, LEVEL_IDS), [])
        self.assertIn("setup.evidence_level", normalised(self.text))


class RequirementsV3Test(unittest.TestCase):
    """Spec AC-8, FR-21: REQUIREMENTS.md is v3.0 with V-27, the GM decisions, the rewritten rules,
    the new acceptance rows and no em or en dash."""

    def setUp(self):
        self.text = read_text(os.path.dirname(os.path.dirname(REPO_ROOT)), "docs", "plugin-discovery", "REQUIREMENTS.md")

    def test_markers_present_and_no_dash(self):
        markers = (["v3.0", "V-27", "OD-19", "U-19"]
                   + ["GM-{0}".format(n) for n in range(1, 10)]
                   + ["GRD-12", "GRD-13", "GRD-14", "GRD-15", "GRD-16"])
        self.assertEqual(missing(self.text, markers), [])
        self.assertNotIn(EM_DASH, self.text)
        self.assertNotIn(EN_DASH, self.text)

    def test_new_acceptance_rows_present(self):
        for ac in ("AC-62", "AC-63", "AC-64", "AC-65", "AC-66", "AC-67"):
            self.assertIn("| {0} |".format(ac), self.text, ac)

    def test_source_line_wordings_recorded(self):
        self.assertEqual(missing(self.text, SOURCE_LINES), [])


class CodeOnlyFixtureTest(unittest.TestCase):
    """Spec AC-9, FR-24: the code-only fixture has real code with meaningful names and no paqad
    docs, so the onboarded check reads it as the code-only level."""

    def test_has_code_with_meaningful_names(self):
        found = {}
        for dirpath, _dirnames, filenames in os.walk(FIXTURE_CODE_ONLY):
            for name in filenames:
                rel = os.path.relpath(os.path.join(dirpath, name), FIXTURE_CODE_ONLY)
                found[rel.replace(os.sep, "/")] = name
        self.assertTrue(found, "code-only fixture is empty")
        joined = " ".join(found)
        for cue in ("Pages", "Actions", "Models", "Routes", "Test"):
            self.assertIn(cue, joined, "fixture missing a {0} name".format(cue))
        self.assertTrue(all(name.endswith(".php") for name in found.values()),
                        "code-only fixture must be non-Python stubs")

    def test_has_no_paqad_docs(self):
        self.assertFalse(os.path.exists(os.path.join(
            FIXTURE_CODE_ONLY, "docs", "instructions", "registries", "modules.md")))
        self.assertFalse(os.path.exists(os.path.join(FIXTURE_CODE_ONLY, "docs", "modules")))

    def test_onboarded_check_reads_it_as_code_only(self):
        state = check_onboarded.onboarded_state(FIXTURE_CODE_ONLY)
        self.assertEqual(state["state"], check_onboarded.NOT_SET_UP)
        self.assertEqual(state["summarised_areas"], [])

    def test_stubs_are_neutral(self):
        for dirpath, _dirnames, filenames in os.walk(FIXTURE_CODE_ONLY):
            for name in filenames:
                text = read_text(dirpath, name)
                self.assertIn("'invented-fixture'", text, name)
                self.assertIsNone(VENDOR_PATTERN.search(text), name)
                self.assertNotIn(EM_DASH, text)
                self.assertNotIn(EN_DASH, text)


class ScriptsUnchangedTest(unittest.TestCase):
    """Spec AC-17, INV-1, GM-8: the scripts are instruction-led only, so the pinned message
    constants and state names are byte for byte unchanged."""

    def test_message_constants(self):
        self.assertEqual(
            check_onboarded.STOP_MESSAGE,
            "This repository isn't set up for this yet. Ask your engineering team to onboard it "
            "with paqad, then come back.")
        self.assertEqual(
            check_onboarded.PARTLY_MESSAGE,
            "This project's list of areas is missing, so I'm working from the area summaries it "
            "has. Areas without a summary are shown as unknown.")

    def test_state_names(self):
        self.assertEqual(
            (check_onboarded.READY, check_onboarded.PARTLY_READY, check_onboarded.NOT_SET_UP),
            ("ready", "partly-ready", "not-set-up"))


if __name__ == "__main__":
    unittest.main()
