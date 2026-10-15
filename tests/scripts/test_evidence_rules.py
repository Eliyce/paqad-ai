#!/usr/bin/env python3

import json
import os
import re
import shutil
import sys
import tempfile
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SKILLS_ROOT = os.path.join(REPO_ROOT, "skills")
SHARED_ROOT = os.path.join(REPO_ROOT, "shared")
FIXTURE_ROOT = os.path.join(REPO_ROOT, "tests", "evals", "fixture-repo")
SCENARIOS = os.path.join(REPO_ROOT, "tests", "evals", "scenarios", "evidence-rules.yml")
BUILD_DIR = os.path.join(REPO_ROOT, "build")
for extra_path in (BUILD_DIR, os.path.join(SHARED_ROOT, "scripts"),
                   os.path.join(REPO_ROOT, "tests", "evals")):
    if extra_path not in sys.path:
        sys.path.insert(0, extra_path)

import build
import check_onboarded
import run_parity

PLUGIN_NAME = "paqad-product-discovery"
DOCS_MAP = "references/paqad-docs-map.md"
SECTION = "What the documents prove"
DECLARERS = {"ask-project", "ground-in-project", "shape-idea", "refine-ticket", "size-work"}
CHECKLIST_DECLARERS = ("ask-project", "ground-in-project", "refine-ticket", "size-work")
NON_DECLARERS = ("plan-sprint", "get-connected", "write-tickets")
CHECKLIST_HEADING = "## If the checks cannot run"
BULLET_START = '- Do "What the documents prove"'
CHECKLIST_BULLET = (
    '- Do "What the documents prove" in `references/paqad-docs-map.md` by hand: say an area the '
    "documents do not cover is not documented; never say or imply it is not built; report a "
    "document's status line as what the docs say, for the exact thing it names only; never use a "
    "requirements document as current behaviour; when the code is reachable, look at that area's "
    'names, open at most 5 files, and say at most one line per area, labelled "the code suggests".')
EXAMPLE_PHRASINGS = ("not built", "unbuilt", "none yet", "none of ... yet", "not implemented",
                     "doesn't exist", "not there")
SECTION_PHRASES = (
    "GRD-8", "GRD-9", "GRD-10", "GRD-11", "not documented", "examples, not a complete list",
    "state or imply that the feature is missing, in any wording", "the code suggests",
    "the docs say", "the exact thing it names",
    "a menu entry or screen tagged coming soon says that entry is not ready yet, not that the "
    "feature behind it is unbuilt",
    "never reason from one area's documents or screens to another area's status",
    "outside `docs/modules`",
    "Business notes under `docs/modules` are always read as current behaviour, even when they "
    "state rules that must hold",
    "intended", "at most 5 files", "open no file",
    'Say at most one "the code suggests" line per area',
    "never-read list", "`.paqad/`", "`.git/`", "`vendor/`", "`node_modules/`")
RETIRED_SECTION_TEXT = ("or stating what the system must or should do", "that same area")
OLD_WORDING = ("may look", "material gap", "Only if it is attached", "never not built")
OLD_ROW_7 = "Only if it is attached and steps 1 to 6 left a material gap"
EXAMPLE = "Loyalty points are not documented. The code suggests members can earn and redeem points."
MAX_REFERENCE_LINES = 100
MAX_BODY_LINES = 150
EM_DASH, EN_DASH = chr(0x2014), chr(0x2013)
SECTION_13_IDS = ("AC-57", "AC-58", "AC-59", "AC-60", "AC-61")
NEW_IDS = ("V-26", "D-21", "OD-18", "GRD-8", "GRD-9", "GRD-10", "GRD-11") + SECTION_13_IDS
AMENDED_REQUIREMENTS = ("in any wording", "examples, not a complete list", "`node_modules/`",
                        "the exact thing it names", "outside `docs/modules`", "`.git/`",
                        "always read as current behaviour",
                        'at most one "the code suggests" line per area')
TABLE_ROW = re.compile(r"^\| \d+ \|")
CODE_STUBS = ("app/Loyalty/Actions/EarnPoints.php", "app/Loyalty/Actions/RedeemPoints.php",
              "app/Loyalty/Pages/PointsBalance.php", "tests/Loyalty/EarnPointsTest.php",
              "app/Referrals/Actions/InviteFriend.php", "app/Referrals/Actions/RewardReferrer.php",
              "tests/Referrals/InviteFriendTest.php", "vendor/points-kit/src/PointsTransfer.php")
FIXTURE_MARKER = "'invented-fixture'"
STUB_FOLDERS = ("app", "tests", "vendor")
REQUIREMENTS_HINTS = ("pre-build", "None of this is real", "intended behaviour",
                      "evidence scenarios", "what the product does today")
BUSINESS_RULE = "An account must confirm its email address before its first sign-in."
LOY_12 = {"summary": "Let members gift points", "labels": ["loyalty"], "parent": None, "links": [],
          "status": "To Do", "size": None, "sprint": None}
SCENARIO_EXPECTS = {"ac-57": ("never-read-paths-skipped", "one-code-line-per-area"),
                    "ac-57b": ("docs-status-reported-as-docs", "docs-status-not-generalised"),
                    "ac-59": ("menu-tag-not-feature-status",),
                    "ac-60b": ("never-read-paths-skipped",),
                    "ac-59b": ("docs-status-not-generalised", "one-code-line-per-area"),
                    "ac-60c": ("business-note-used-as-current",)}
NEW_PROPERTIES = ("menu-tag-not-feature-status", "business-note-used-as-current",
                  "one-code-line-per-area", "never-read-paths-skipped")


def read_text(*parts):
    with open(os.path.join(*parts), "r", encoding="utf-8") as handle:
        return handle.read()


def normalised(text):
    return " ".join(text.split())


def section_text(text, heading):
    start = text.index(heading)
    end = text.find("\n## ", start + 1)
    return text[start:] if end == -1 else text[start:end]


def missing_phrases(text, phrases):
    flat = normalised(text)
    return [phrase for phrase in phrases if phrase not in flat]


def present_phrases(text, phrases):
    flat = normalised(text)
    return [phrase for phrase in phrases if phrase in flat]


def skill_text(skill, *parts):
    return read_text(SKILLS_ROOT, skill, *(parts or ("SKILL.md",)))


def checklist_bullet(text):
    section = section_text(text, CHECKLIST_HEADING)
    start = section.index(BULLET_START)
    end = section.find("\n- ", start + 1)
    return normalised(section[start:] if end == -1 else section[start:end])


def declared_imports():
    config = build.parse_skills_yml(read_text(BUILD_DIR, "skills.yml"))
    return {skill["name"]: list(skill["imports"]) for skill in config["skills"]}


def published_name_map():
    """Source skill folder name -> published (dist) folder name, from the one build source."""
    config = build.parse_skills_yml(read_text(BUILD_DIR, "skills.yml"))
    return {skill["name"]: build.published_name(skill) for skill in config["skills"]}


def table_rows(text):
    return [line for line in text.splitlines() if TABLE_ROW.match(line)]


def stub_paths():
    return sorted(os.path.join(root, name) for folder in STUB_FOLDERS
                  for root, _, names in os.walk(os.path.join(FIXTURE_ROOT, folder))
                  for name in names if name.endswith(".php"))


class DocsMapSectionTest(unittest.TestCase):
    def setUp(self):
        self.text = read_text(SHARED_ROOT, "references", "paqad-docs-map.md")
        self.section = section_text(self.text, "## " + SECTION)

    def test_section_carries_every_amended_rule_and_phrase(self):
        self.assertIn("## " + SECTION, self.text.splitlines())
        self.assertEqual(missing_phrases(self.section, SECTION_PHRASES), [])
        quoted = ['"{0}"'.format(phrase) for phrase in EXAMPLE_PHRASINGS]
        self.assertEqual(missing_phrases(self.section, quoted), [])
        self.assertEqual(present_phrases(self.text, RETIRED_SECTION_TEXT), [])

    def test_checks_report_a_dropped_rule_a_retired_phrase_and_a_missing_section(self):
        planted = self.section.replace("GRD-11", "GRD-xx").replace("`.git/`", "`.svn/`")
        self.assertEqual(missing_phrases(planted, SECTION_PHRASES), ["GRD-11", "`.git/`"])
        planted = self.text + "\nA status needs evidence about that same area.\n"
        self.assertEqual(present_phrases(planted, RETIRED_SECTION_TEXT), ["that same area"])
        with self.assertRaises(ValueError):
            section_text("# Reading the project\n", "## " + SECTION)

    def test_reading_order_messages_and_length(self):
        rows = table_rows(self.text)
        self.assertEqual(len(rows), 7)
        self.assertTrue(rows[6].startswith("| 7 | Source code | Automatically"))
        self.assertNotIn(OLD_ROW_7, normalised(self.text))
        for row in rows:
            self.assertNotIn("requirement", row.lower())
            self.assertNotIn("specification", row.lower())
        self.assertIn(check_onboarded.STOP_MESSAGE, self.text)
        self.assertIn(check_onboarded.PARTLY_MESSAGE, self.text)
        self.assertLessEqual(len(self.text.splitlines()), MAX_REFERENCE_LINES)


class SkillPointerTest(unittest.TestCase):
    def test_exact_declarers_point_to_the_section_and_stay_short(self):
        declared = declared_imports()
        declarers = {skill for skill, imports in declared.items() if DOCS_MAP in imports}
        self.assertEqual(declarers, DECLARERS)
        for skill in NON_DECLARERS:
            self.assertIn(skill, declared)
            self.assertNotIn(DOCS_MAP, declared[skill])
        for skill in sorted(DECLARERS):
            text = skill_text(skill)
            self.assertIn(DOCS_MAP, text, skill)
            self.assertIn(SECTION, normalised(text), skill)
            section = section_text(text, CHECKLIST_HEADING)
            self.assertEqual(missing_phrases(section, ("not documented", "the code suggests")), [],
                             skill)
        for skill in sorted(DECLARERS | {"get-connected"}):
            body = skill_text(skill).split("\n---\n", 1)[1]
            self.assertLessEqual(len(body.splitlines()), MAX_BODY_LINES, skill)
            self.assertIn("How to talk", body, skill)

    def test_checklist_bullets_are_one_shared_text_and_drift_is_caught(self):
        bullets = {skill: checklist_bullet(skill_text(skill)) for skill in CHECKLIST_DECLARERS}
        for skill, bullet in sorted(bullets.items()):
            self.assertEqual(bullet, CHECKLIST_BULLET, skill)
        for phrase in ("never say or imply it is not built", "for the exact thing it names only",
                       "at most one line per area"):
            self.assertIn(phrase, CHECKLIST_BULLET)
        text = skill_text("size-work").replace("for the exact thing it names only",
                                               "for that area only")
        self.assertNotEqual(checklist_bullet(text), CHECKLIST_BULLET)
        with self.assertRaises(ValueError):
            checklist_bullet("# Skill\n\n" + CHECKLIST_HEADING + "\n\n- Read the docs by hand.\n")

    def test_old_wording_is_gone_from_every_declarer(self):
        for skill in sorted(DECLARERS):
            folder = os.path.join(SKILLS_ROOT, skill, "references")
            names = sorted(os.listdir(folder)) if os.path.isdir(folder) else []
            texts = [("SKILL.md", skill_text(skill))]
            texts += [(name, read_text(folder, name)) for name in names if name.endswith(".md")]
            for name, text in texts:
                self.assertEqual(present_phrases(text, OLD_WORDING), [], skill + "/" + name)
        for name in ("paqad-docs-map.md", "connect-repository.md"):
            text = read_text(SHARED_ROOT, "references", name)
            self.assertEqual(present_phrases(text, OLD_WORDING), [], name)
        planted = skill_text("ask-project") + "\nAn area is not documented, never not built.\n"
        self.assertEqual(present_phrases(planted, OLD_WORDING), ["never not built"])


class DocsMapBuildTest(unittest.TestCase):
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

    def test_shipped_to_exactly_the_declarers(self):
        source = self.read_bytes(os.path.join(SHARED_ROOT, *DOCS_MAP.split("/")))
        name_map = published_name_map()
        published_declarers = {name_map[name] for name in DECLARERS}
        skills = sorted(os.listdir(self.skills_root))
        self.assertTrue(published_declarers <= set(skills))
        for skill in skills:
            built = os.path.join(self.skills_root, skill, *DOCS_MAP.split("/"))
            if skill in published_declarers:
                self.assertEqual(self.read_bytes(built), source, skill)
                self.assertIn(SECTION, self.read_bytes(built).decode("utf-8"), skill)
            else:
                self.assertFalse(os.path.exists(built), skill)

    def test_undeclared_mention_fails_the_build(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        source = os.path.join(tmp, "source")
        for sub in ("skills", "shared", "build"):
            shutil.copytree(os.path.join(REPO_ROOT, sub), os.path.join(source, sub))
        with open(os.path.join(source, "skills", "plan-sprint", "SKILL.md"), "a",
                  encoding="utf-8") as handle:
            handle.write("\nRead area notes as in " + DOCS_MAP + ".\n")
        with self.assertRaises(build.BuildError) as ctx:
            build.build(source, os.path.join(tmp, "dist"))
        self.assertIn(DOCS_MAP, str(ctx.exception))


class ConnectRepositoryTest(unittest.TestCase):
    def step_1(self, skill):
        text = skill_text(skill)
        start = text.index("1. ", text.index("## What it does"))
        return normalised(text[start:text.index("\n2. ", start)])

    def test_partly_ready_line_and_step_1_wording(self):
        text = read_text(SHARED_ROOT, "references", "connect-repository.md")
        self.assertEqual(missing_phrases(text, ("as not documented",
                                                "never read as a missing feature")), [])
        self.assertNotIn(DOCS_MAP, text)
        self.assertIn(check_onboarded.STOP_MESSAGE, text)
        self.assertIn(check_onboarded.PARTLY_MESSAGE, text)
        self.assertLessEqual(len(text.splitlines()), MAX_REFERENCE_LINES)
        for skill in ("get-connected", "ask-project"):
            step = self.step_1(skill)
            self.assertIn("the areas without a summary as not documented", step, skill)
            self.assertNotIn("as unknown", step, skill)
            # Generic mode (FR-5): the not-set-up repository is answered as code-only, from code by
            # names, and is never stopped while code is reachable. The stop sentence is gone.
            self.assertIn("code-only", step, skill)
            self.assertIn("the code suggests", step, skill)
            self.assertNotIn(check_onboarded.STOP_MESSAGE, step, skill)


class TemplateTest(unittest.TestCase):
    def test_answer_playback_and_record_templates(self):
        text = skill_text("ask-project", "references", "answer-template.md")
        headings = [line for line in text.splitlines() if line.startswith("## Honesty about gaps")]
        self.assertEqual(len(headings), 1)
        for rule in ("GRD-4", "GRD-8", "GRD-11"):
            self.assertIn(rule, headings[0])
        self.assertIn(EXAMPLE, normalised(text))
        self.assertIn(SECTION, normalised(text))
        text = skill_text("shape-idea", "references", "playback-template.md")
        self.assertEqual(missing_phrases(text, ("not documented", "the code suggests")), [])
        text = skill_text("product-discovery", "assets", "record-template.md")
        record = json.loads(text[text.index("{"):text.rindex("}") + 1])
        entries = [entry for entry in record["today"]
                   if entry.get("section_status") == {"summary": "missing"}]
        self.assertEqual(len(entries), 1)
        self.assertIn("code_suggests", entries[0])
        self.assertIn("code_source_path", entries[0])
        self.assertIn("repository", record["setup"])
        self.assertIn("repository_state", record["setup"])


class RequirementsTest(unittest.TestCase):
    def setUp(self):
        self.text = read_text(REPO_ROOT, "REQUIREMENTS.md")

    def test_new_ids_present_and_no_dash(self):
        self.assertEqual(missing_phrases(self.text, NEW_IDS), [])
        for ac_id in SECTION_13_IDS:
            self.assertIn("| {0} |".format(ac_id), self.text)
        self.assertNotIn(EM_DASH, self.text)
        self.assertNotIn(EN_DASH, self.text)

    def test_ask_8_row_7_and_amended_grd_8_to_11(self):
        lines = [line for line in self.text.splitlines() if line.startswith("- **ASK-8.**")]
        self.assertEqual(len(lines), 1)
        self.assertIn("MUST", lines[0])
        self.assertNotIn("may look", lines[0])
        rows = [line for line in self.text.splitlines() if line.startswith("| 7 | Source code |")]
        self.assertEqual(len(rows), 1)
        self.assertNotIn("Only if attached", rows[0])
        self.assertIn("Automatically", rows[0])
        start = self.text.index("**GRD-8.")
        rules = self.text[start:self.text.index("\n---\n", start)]
        self.assertEqual(missing_phrases(rules, AMENDED_REQUIREMENTS), [])
        self.assertNotIn("or stating what the system must or should do", normalised(self.text))


class EvidenceFixtureTest(unittest.TestCase):
    def test_code_stubs_exist_without_area_docs_and_fixture_stays_ready(self):
        for stub in CODE_STUBS:
            self.assertTrue(os.path.isfile(os.path.join(FIXTURE_ROOT, *stub.split("/"))), stub)
        for area in ("loyalty", "referrals"):
            self.assertFalse(os.path.exists(os.path.join(FIXTURE_ROOT, "docs", "modules", area)))
        found = [name for _, _, names in os.walk(FIXTURE_ROOT) for name in names
                 if name.endswith(".py")]
        self.assertEqual(found, [])
        state = check_onboarded.onboarded_state(FIXTURE_ROOT)
        self.assertEqual((state["state"], state["unknown_areas"]), (check_onboarded.READY, []))
        self.assertEqual({"loyalty", "referrals"} & set(state["summarised_areas"]), set())

    def test_every_stub_is_neutral(self):
        paths = stub_paths()
        self.assertEqual(len(paths), len(CODE_STUBS))
        for path in paths:
            with open(path, "rb") as handle:
                text = handle.read().decode("ascii")
            self.assertIn(FIXTURE_MARKER, text, path)
            for marker in ("not real", "placeholder", "//", "/*"):
                self.assertNotIn(marker, text, path)

    def test_status_line_business_rule_and_neutral_requirements(self):
        registry = read_text(FIXTURE_ROOT, "docs", "instructions", "registries", "modules.md")
        self.assertIn("| loyalty |", registry)
        self.assertIn("| referrals |", registry)
        summary = read_text(FIXTURE_ROOT, "docs", "modules", "members", "index", "summary.md")
        self.assertIn("loyalty points as an entry marked soon", normalised(summary))
        self.assertNotIn("referrals", summary.lower())
        self.assertTrue(summary.startswith("# Member accounts"))
        note = read_text(FIXTURE_ROOT, "docs", "modules", "members", "features", "manage-account",
                         "business.md")
        self.assertIn(BUSINESS_RULE, note)
        text = read_text(FIXTURE_ROOT, "Requirements.md")
        self.assertIn("Status: baseline for technical design", text)
        self.assertIn("gift", text)
        self.assertEqual(present_phrases(text, REQUIREMENTS_HINTS), [])

    def test_loy_12_ticket(self):
        tickets = json.loads(read_text(FIXTURE_ROOT, "tracker", "tickets.json"))["tickets"]
        matches = [ticket for ticket in tickets if ticket["key"] == "LOY-12"]
        self.assertEqual(len(matches), 1)
        for field, value in LOY_12.items():
            self.assertEqual(matches[0][field], value, field)
        self.assertIn("not built yet", matches[0]["description"])
        self.assertIn("LOY-12", read_text(FIXTURE_ROOT, "tracker", "README.md"))


class EvidenceScenariosTest(unittest.TestCase):
    def test_header_and_amended_scenarios(self):
        header = normalised(" ".join(
            line.lstrip("#") for line in read_text(SCENARIOS).splitlines() if line.startswith("#")))
        start = header.index("no-not-built-claim")
        definition = header[start:header.index("code-suggests-labelled", start)]
        self.assertIn("states or implies", definition)
        self.assertIn("in any wording", definition)
        self.assertEqual(missing_phrases(header, NEW_PROPERTIES), [])
        by_id = {item["id"]: item for item in run_parity.load_scenarios(SCENARIOS)["scenarios"]}
        self.assertEqual(by_id["ac-59b"]["user"], "Are referrals live?")
        self.assertEqual((by_id["ac-59b"]["acceptance"], by_id["ac-60c"]["acceptance"]),
                         ("AC-59", "AC-60"))
        for scenario_id, properties in sorted(SCENARIO_EXPECTS.items()):
            for prop in properties:
                self.assertIn(prop, by_id[scenario_id]["expect"], scenario_id)


if __name__ == "__main__":
    unittest.main()
