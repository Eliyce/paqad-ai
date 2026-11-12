#!/usr/bin/env python3
"""Tracker grounding (v3.3): the idea journey reads existing epics and tickets as a source.

Covers the file-level, automated acceptance criteria of tracker grounding and posting under an
existing epic: the new shared reference ground-from-tracker.md, its exact declarers and
byte-identical build copies, the tracker-only level id, the source lines, the "the tickets say"
label, the word-for-word sentences, the record template fields, the terms learned from tickets,
the language rule in voice.md, and the REQUIREMENTS.md v3.3 edits. Each wording test reads the
source and the built copy. The test names carry the spec criterion they prove as ac_<n>; the
REQUIREMENTS.md rows are named AC-76 and up.

Standard library only (Python 3.9+). No network. Reads the source tree; writes only under a
temporary folder.
"""

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
REFERENCES = os.path.join(SHARED_ROOT, "references")
BUILD_DIR = os.path.join(REPO_ROOT, "build")
PROJECT_ROOT = os.path.dirname(os.path.dirname(REPO_ROOT))
for extra_path in (BUILD_DIR, os.path.join(SHARED_ROOT, "scripts")):
    if extra_path not in sys.path:
        sys.path.insert(0, extra_path)

import build  # noqa: E402

PLUGIN_NAME = "paqad-product-discovery"
TRACKER_REFERENCE = "references/ground-from-tracker.md"
JIRA_PROFILE = "references/tracker-profiles-jira.md"
DECLARERS = {"get-connected", "ground-in-project", "shape-idea", "product-discovery",
             "decide-together", "check-tickets"}
JIRA_PROFILE_DECLARERS = {
    "get-connected", "ground-in-project", "post-tickets", "refine-ticket", "size-work", "plan-sprint",
}
UNCHANGED_SKILLS = ("ask-project", "refine-ticket", "size-work", "plan-sprint")
TRACKER_ONLY = "tracker-only"
LEVEL_IDS = ("project-docs", "docs-and-code", "code-only")
SOURCE_LINES = ("paqad, from project docs", "paqad, from docs and code", "paqad, from code only")
TRACKER_SOURCE_LINE = "paqad, from the tracker"
COMBINED_SUFFIX = '" and the tracker"'
LABEL = "the tickets say"
TRACKER_ONLY_SENTENCE = (
    "No repository is connected, so I'll work from the tickets in your tracker. "
    "Tickets show what was planned or asked for, not what is built."
)
STOP_SENTENCE = (
    "I can't read a repository or the tracker from here, so there is nothing to ground this on. "
    "Attach the repository or its docs folder, or switch on the tracker connector, and I'll carry on."
)
FINDING = (
    "The tickets say customers can pause a subscription (ABC-12, done), but the code suggests "
    "there is no pause action. I'm going with the repository."
)
CUT_LINE = "I looked at the 25 closest tickets"
EPIC_QUESTION = "Where should these tickets go?"
CANNOT_CHECK_SENTENCE = (
    "I can't read the tracker from here, so I can't check that epic. "
    "I'll draft a new epic instead, or you can connect the tracker and pick one."
)
EXPORT_NOTE = (
    "Parent holds the existing epic key ABC-7. If your importer does not accept it, set the "
    "parent with a bulk edit after the import."
)
FIELDS_READ = "key, type, summary, description, status, parent, labels, last updated"
NEVER_READ = "comments, attachments, work logs, people's names (assignee, reporter), other projects"
VENDOR_PATTERN = re.compile(r"claude|chatgpt|codex|anthropic|openai|rovo", re.IGNORECASE)
EM_DASH, EN_DASH = chr(0x2014), chr(0x2013)
MAX_REFERENCE_LINES = 100
MAX_GET_CONNECTED_BODY = 150
FIXTURE_ROOT = os.path.join(REPO_ROOT, "tests", "evals", "fixture-repo")
SCENARIOS = os.path.join(REPO_ROOT, "tests", "evals", "scenarios")
LOY_12_BYTES = """    {
      "key": "LOY-12",
      "summary": "Let members gift points",
      "description": "Loyalty is not built yet, so this is a brand new area. Members should be able to gift points to another member.",
      "labels": ["loyalty"],
      "parent": null,
      "links": [],
      "status": "To Do",
      "size": null,
      "sprint": null,
      "last_updated": "2026-09-28T10:00:00Z"
    }
"""


def read_text(*parts):
    with open(os.path.join(*parts), "r", encoding="utf-8") as handle:
        return handle.read()


def read_bytes(path):
    with open(path, "rb") as handle:
        return handle.read()


def normalised(text):
    return " ".join(text.split())


def missing(text, phrases):
    flat = normalised(text)
    return [phrase for phrase in phrases if phrase not in flat]


def skills_config():
    return build.parse_skills_yml(read_text(BUILD_DIR, "skills.yml"))


def declared_imports():
    return {skill["name"]: list(skill["imports"]) for skill in skills_config()["skills"]}


def published_name_map():
    return {skill["name"]: build.published_name(skill) for skill in skills_config()["skills"]}


def body_lines(skill_text):
    """Lines of a SKILL.md after its front matter."""
    parts = skill_text.split("---", 2)
    return parts[2].strip("\n").split("\n")


class BuiltCopies(unittest.TestCase):
    """Builds the plugin once into a temporary folder, so each wording test can read the source and
    the built copy of the same file."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        build.build(REPO_ROOT, os.path.join(cls.tmp, "dist"), version="0.0.0", target="paqad")
        cls.built_skills = os.path.join(cls.tmp, "dist", "plugins", PLUGIN_NAME, "skills")
        cls.names = published_name_map()

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def both(self, skill, *parts):
        """The source text and the built text of one skill file, shared references included."""
        source_path = os.path.join(SKILLS_ROOT, skill, *parts)
        if not os.path.exists(source_path):
            source_path = os.path.join(SHARED_ROOT, *parts)
        built_path = os.path.join(self.built_skills, self.names[skill], *parts)
        return read_text(source_path), read_text(built_path)

    def assert_both_hold(self, skill, parts, phrases):
        for label, text in zip(("source", "built"), self.both(skill, *parts)):
            self.assertEqual(missing(text, phrases), [], "{0} {1} {2}".format(skill, parts, label))


class TrackerReferenceTest(BuiltCopies):
    """FR-32: ground-from-tracker.md is the one home of the tracker grounding rules."""

    def setUp(self):
        self.path = os.path.join(REFERENCES, "ground-from-tracker.md")
        self.text = read_text(self.path)

    def test_ac_34_reference_is_under_the_line_cap_with_its_verified_line(self):
        lines = self.text.rstrip("\n").split("\n")
        self.assertLess(len(lines), MAX_REFERENCE_LINES)
        self.assertRegex(self.text, r"(?m)^verified: \d{4}-\d{2}-\d{2}$")
        self.assertNotIn(EM_DASH, self.text)
        self.assertNotIn(EN_DASH, self.text)
        self.assertIsNone(VENDOR_PATTERN.search(self.text))

    def test_ac_34_both_word_for_word_sentences_in_source_and_built_copy(self):
        for skill in sorted(DECLARERS):
            self.assert_both_hold(skill, ("references", "ground-from-tracker.md"),
                                  [TRACKER_ONLY_SENTENCE, STOP_SENTENCE])
        self.assert_both_hold("get-connected", ("SKILL.md",), [TRACKER_ONLY_SENTENCE, STOP_SENTENCE])

    def test_ac_34_get_connected_body_stays_within_150_lines(self):
        for text in self.both("get-connected", "SKILL.md"):
            self.assertLessEqual(len(body_lines(text)), MAX_GET_CONNECTED_BODY)

    def test_ac_15_limits_fields_never_read_list_and_cut_line(self):
        phrases = ["at most 25", "at most 10", FIELDS_READ, NEVER_READ, CUT_LINE,
                   "one, `setup.project_key`", "epics first, then stories and tasks"]
        for skill in sorted(DECLARERS):
            self.assert_both_hold(skill, ("references", "ground-from-tracker.md"), phrases)

    def test_ac_16_either_search_kind_keeps_epics_first_inside_one_cap(self):
        self.assertEqual(missing(self.text, [
            "The search may be a natural language search or a JQL search, with the same limits.",
            "A JQL search always carries the project clause and puts the epic type first",
            "sort natural language results by type afterwards",
            "say so once",
            "Never fetch a second page.",
        ]), [])

    def test_ac_17_a_used_up_total_is_reused_and_the_epic_check_still_runs(self):
        self.assertEqual(missing(self.text, [
            "one total across every step that reads the tracker",
            "Only the read-only check of a chosen epic before posting is allowed on top.",
            "a later step reuses what was read, makes no new lookup and says so in one line",
        ]), [])

    def test_ac_18_nothing_related_carries_on_and_never_means_not_built(self):
        self.assertEqual(missing(self.text, [
            "say once that no related tickets were found and that this does not mean nothing is built",
            "lower the confidence and carry on",
            "No ticket about something never means it is not built and never means it was not planned.",
        ]), [])

    def test_ac_1_tracker_only_run_carries_on_with_its_own_source_line(self):
        self.assertEqual(missing(self.text, [
            '| no | yes | `["tracker"]` | `tracker-only` |',
            "say once at step 0",
            'Tracker only: "{0}"'.format(TRACKER_SOURCE_LINE),
        ]), [])
        self.assert_both_hold("get-connected", ("SKILL.md",), [
            "set `setup.evidence_level` to `tracker-only` and say once",
            "skip `scripts/check_onboarded.py`",
        ])
        self.assert_both_hold("ground-in-project", ("SKILL.md",), [
            "With no readable repository, skip steps 1 to 4 and `scripts/check_onboarded.py`",
        ])

    def test_ac_1_no_repository_branch_sits_before_the_onboarded_check(self):
        text = read_text(SKILLS_ROOT, "ground-in-project", "SKILL.md")
        self.assertLess(text.index("With no readable repository"),
                        text.index("Run\n   `scripts/check_onboarded.py` first"))

    def test_ac_2_repository_first_then_tickets_and_one_combined_source_line(self):
        self.assertEqual(missing(self.text, [
            '| yes | yes | `["repository", "tracker"]` | the repository\'s level |',
            ("The repository is always read first. Tracker lines are added second and never replace "
             "a repository line."),
            "Still exactly one short source line per answer.",
            "the repository line plus {0}".format(COMBINED_SUFFIX),
            '"paqad, from code only and the tracker"',
        ]), [])
        self.assert_both_hold("ground-in-project", ("SKILL.md",), [
            "When the tracker is a source, read it second",
            "A ticket line never replaces a repository line.",
        ])

    def test_ac_3_ticket_lines_keep_the_label_and_keys_everywhere(self):
        self.assertEqual(missing(self.text, [
            'Every line that rests on tickets contains "{0}" and names the issue keys.'.format(LABEL),
            "the today block, the playback, ticket text, the preview",
            'A ticket marked done is "the tickets say this was finished (ABC-12)".',
            "It is never reported as built",
        ]), [])
        carriers = (
            ("ground-in-project", ("SKILL.md",)),
            ("shape-idea", ("SKILL.md",)),
            ("shape-idea", ("references", "playback-template.md")),
            ("write-tickets", ("assets", "epic-template.md")),
            ("write-tickets", ("assets", "ticket-template.md")),
            ("check-tickets", ("references", "review-checklist.md")),
            ("product-discovery", ("assets", "record-template.md")),
        )
        for skill, parts in carriers:
            self.assert_both_hold(skill, parts, [LABEL])

    def test_ac_4_a_done_ticket_alone_never_gives_already_exists(self):
        self.assert_both_hold("shape-idea", ("SKILL.md",), [
            "A ticket line alone never gives that outcome, even for a ticket marked done",
            "recommend checking with the team before building again",
            "a code-suggests line in the today block shows it exists",
            "recommend the already-exists outcome",
        ])
        self.assertEqual(missing(self.text, [
            'on its own it never gives the "already exists" outcome',
        ]), [])

    def test_ac_6_repository_wins_and_docs_against_code_still_picks_neither(self):
        self.assertEqual(missing(self.text, [FINDING, "The repository wins.",
                                             "Raise it once in the playback"]), [])
        self.assert_both_hold("shape-idea", ("references", "challenge-guide.md"),
                              [FINDING, "an issue key"])
        self.assert_both_hold("ground-in-project", ("SKILL.md",),
                              ["the repository wins", "I'm going with the repository."])
        docs_map = read_text(REFERENCES, "paqad-docs-map.md")
        self.assertEqual(missing(docs_map, ["The docs say ..., but the code suggests ..."]), [])
        self.assertEqual(missing(self.text, ["docs against code still says both and picks neither"]), [])

    def test_ac_7_neither_readable_stops_with_the_message_and_invents_nothing(self):
        self.assertEqual(missing(self.text, [
            '| no | no | `[]` | not set, the journey stops |',
            "Neither readable, say this, invent nothing and stop: \"" + STOP_SENTENCE,
        ]), [])
        self.assert_both_hold("get-connected", ("SKILL.md",),
                              ["If neither is readable, say this, invent nothing and stop"])

    def test_ac_8_connecting_a_source_after_the_stop_carries_on_with_the_same_idea(self):
        self.assertEqual(missing(self.text, [
            "When the user then connects either one in the same conversation, check step 0 again "
            "and carry on with the idea already given.",
        ]), [])
        self.assert_both_hold("product-discovery", ("SKILL.md",), [
            "check step 0 again and carry on with the idea already given. Start no new run.",
        ])

    def test_ac_9_readable_but_not_writable_grounds_and_leaves_by_export(self):
        self.assert_both_hold("get-connected", ("SKILL.md",), [
            "Check the tracker for reading and for writing separately",
            "`setup.tracker_readable`",
            ("If the tracker is readable but not writable, do not stop: say once, before grounding "
             "starts, that the tickets will leave by export, and carry on."),
        ])
        self.assert_both_hold("get-connected", ("references", "connect-tracker.md"), [
            "A tracker that answers the read but refuses the write still grounds the idea",
            "Never create, edit or delete an issue to test access.",
            "try no other route",
        ])

    def test_ac_10_a_repository_only_run_keeps_its_three_source_lines(self):
        levels = read_text(REFERENCES, "evidence-levels.md")
        self.assertEqual(missing(levels, SOURCE_LINES + LEVEL_IDS), [])
        self.assertEqual(missing(self.text, ["Repository only: unchanged.",
                                             '| yes | no | `["repository"]` | the repository\'s level |']), [])

    def test_ac_11_a_record_without_grounding_sources_is_repository_only(self):
        self.assertEqual(missing(self.text, [
            'A record with no `setup.grounding_sources` is read as `["repository"]`.',
        ]), [])
        self.assert_both_hold("ground-in-project", ("SKILL.md",),
                              ["A record with no such list is repository only."])
        self.assert_both_hold("product-discovery", ("SKILL.md",),
                              ["A record with no `setup.grounding_sources` is repository only."])

    def test_ac_12_resume_keeps_tracker_lines_and_asks_to_reconnect_late(self):
        self.assertEqual(missing(self.text, [
            "On resume, tracker lines are a snapshot.",
            "say once that they are from the earlier session",
            "ask to reconnect only at a later step that needs to read or write the tracker",
            "Do not repeat the tracker-only sentence.",
        ]), [])
        self.assert_both_hold("product-discovery", ("SKILL.md",), [
            "say once that they are from the earlier session",
            "ask to reconnect only at the first later step that needs to read or write the tracker",
            "Do not say the tracker-only sentence again.",
        ])

    def test_ac_13_a_repository_connected_mid_run_redoes_step_2_onward(self):
        self.assertEqual(missing(self.text, [
            "A repository connected in the middle of a tracker-only run is a repository switch",
            "redo step 2 onward and say in one line what changes",
        ]), [])
        self.assert_both_hold("product-discovery", ("SKILL.md",), [
            "rewrite the today block so step 2 onward is redone, and say in one line what changes",
        ])
        self.assert_both_hold("product-discovery", ("references", "journey.md"), [
            "patch `setup` and rewrite `today`, so step 2 onward is redone like a repository switch",
            "| today | playback, decisions, ticket_set_ref, readiness, posted |",
        ])


class DeclarersTest(BuiltCopies):
    """FR-33, FR-34: the exact declarers name the reference and ship a byte-identical copy."""

    def test_exact_declarers_name_the_reference(self):
        declared = declared_imports()
        declarers = {skill for skill, imports in declared.items() if TRACKER_REFERENCE in imports}
        self.assertEqual(declarers, DECLARERS)
        for skill in sorted(DECLARERS):
            self.assertIn(TRACKER_REFERENCE, read_text(SKILLS_ROOT, skill, "SKILL.md"), skill)

    def test_jira_profile_declarers(self):
        declared = declared_imports()
        declarers = {skill for skill, imports in declared.items() if JIRA_PROFILE in imports}
        self.assertEqual(declarers, JIRA_PROFILE_DECLARERS)
        self.assertIn(JIRA_PROFILE, read_text(SKILLS_ROOT, "ground-in-project", "SKILL.md"))

    def test_shipped_byte_identical_to_exactly_the_declarers(self):
        source = read_bytes(os.path.join(SHARED_ROOT, *TRACKER_REFERENCE.split("/")))
        published = {self.names[name] for name in DECLARERS}
        for skill in sorted(os.listdir(self.built_skills)):
            built = os.path.join(self.built_skills, skill, *TRACKER_REFERENCE.split("/"))
            if skill in published:
                self.assertEqual(read_bytes(built), source, skill)
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
            handle.write("\nSee " + TRACKER_REFERENCE + ".\n")
        with self.assertRaises(build.BuildError) as ctx:
            build.build(source, os.path.join(tmp, "dist"), version="0.0.0")
        self.assertIn(TRACKER_REFERENCE, str(ctx.exception))

    def test_skills_that_keep_todays_behaviour_do_not_read_tickets_as_a_source(self):
        declared = declared_imports()
        for skill in UNCHANGED_SKILLS:
            text = read_text(SKILLS_ROOT, skill, "SKILL.md")
            self.assertNotIn(TRACKER_REFERENCE, declared[skill], skill)
            self.assertNotIn("ground-from-tracker", text, skill)
            self.assertNotIn(LABEL, text, skill)
            self.assertNotIn(TRACKER_ONLY, text, skill)


class SharedPointersTest(unittest.TestCase):
    """FR-35 to FR-37: the two older shared references point at the new one by its title."""

    def test_evidence_levels_points_by_title_and_keeps_its_three_levels(self):
        text = read_text(REFERENCES, "evidence-levels.md")
        self.assertLessEqual(len(text.rstrip("\n").split("\n")), MAX_REFERENCE_LINES)
        self.assertNotIn("ground-from-tracker", text)
        self.assertEqual(missing(text, [
            "Only the idea journey reads existing tickets as a source",
            'the reference titled "Grounding from the tracker"',
            "`tracker-only`",
            "is read with the lowest confidence and supports no claim about what is built",
            ("connecting the repository would let answers rest on what is built, not only on what "
             "was planned"),
            "## The three levels",
        ] + list(LEVEL_IDS) + list(SOURCE_LINES)), [])

    def test_jira_profile_names_the_grounding_read(self):
        text = read_text(REFERENCES, "tracker-profiles-jira.md")
        self.assertLessEqual(len(text.rstrip("\n").split("\n")), MAX_REFERENCE_LINES)
        self.assertNotIn("ground-from-tracker", text)
        self.assertEqual(missing(text, [
            "Only the idea journey reads existing epics and tickets as a source.",
            "The search may be a natural language search or a JQL search",
            "for finding existing epics and tickets for grounding",
            "or an existing epic or ticket for grounding",
        ]), [])

    def test_docs_map_keeps_seven_rows_and_github_profile_is_untouched(self):
        docs_map = read_text(REFERENCES, "paqad-docs-map.md")
        rows = re.findall(r"(?m)^\| \d+ \|", docs_map)
        self.assertEqual(len(rows), 7)
        self.assertNotIn(LABEL, docs_map)
        self.assertIn("export only", read_text(REFERENCES, "tracker-profiles-github.md"))
        self.assertNotIn(LABEL, read_text(REFERENCES, "connect-repository.md"))


class RecordTemplateTest(BuiltCopies):
    """FR-27, FR-72, NFR-6: the new record fields are shaped by the record template only."""

    def setUp(self):
        self.text = read_text(SKILLS_ROOT, "product-discovery", "assets", "record-template.md")
        self.record = json.loads(self.text[self.text.index("{"):self.text.rindex("}") + 1])

    def test_setup_carries_the_source_order_and_the_read_state(self):
        setup = self.record["setup"]
        self.assertEqual(setup["grounding_sources"], ["repository"])
        self.assertIs(setup["tracker_readable"], False)
        self.assertEqual(sorted(setup["tracker_reads"]), ["issues_opened", "results_looked_at"])
        self.assertIn("can_create", setup)
        self.assertEqual(missing(self.text, [
            'A record without it is read as ["repository"].',
            "setup.tracker_readable is true or false and sits beside the write check can_create",
            "setup.evidence_level is tracker-only",
        ]), [])

    def test_ac_3_tracker_entry_has_the_label_fields_and_no_source_path(self):
        entries = [entry for entry in self.record["today"]
                   if entry["evidence_level"] == TRACKER_ONLY]
        self.assertEqual(len(entries), 1)
        entry = entries[0]
        self.assertIn("tickets_say", entry)
        self.assertEqual(entry["ticket_keys"], [])
        self.assertNotIn("source_path", entry)
        self.assertTrue(all("evidence_level" in item for item in self.record["today"]))
        self.assertEqual(missing(self.text, [
            'tickets_say, one line in the plugin\'s own words that itself contains "the tickets say"',
            "ticket_keys, the list of issue keys it rests on",
            "A tracker-only entry has evidence_level tracker-only and no source_path.",
            "never copies a description word for word",
        ]), [])

    def test_ac_6_a_disagreement_is_a_finding_on_the_today_entry(self):
        self.assert_both_hold("product-discovery", ("assets", "record-template.md"), [
            "the entry adds disagreement, the one-line finding that names the issue key and ends "
            "\"I'm going with the repository.\"",
        ])

    def test_ac_37_glossary_pair_notes_that_the_term_came_from_the_tickets(self):
        self.assertEqual(self.record["glossary"][0]["term_source"], "docs")
        self.assertEqual(missing(self.text, [
            "term_source says where the other term came from, docs or tickets",
            "a pair without it is read as from the docs",
        ]), [])
        self.assert_both_hold("ground-in-project", ("SKILL.md",), [
            'Pair a term the tickets use for the user\'s term in the glossary, with `term_source` '
            '"tickets".',
        ])

    def test_ac_42_checked_values_stay_as_defined_in_another_language(self):
        self.assert_both_hold("product-discovery", ("assets", "record-template.md"), [
            "In a run held in another language these values keep their English label, keys and "
            "level ids.",
        ])
        self.assert_both_hold("write-tickets", ("assets", "ticket-template.md"), [
            "The field labels and section headings above stay as written.",
        ])

    def test_record_scripts_know_nothing_of_the_new_fields(self):
        for script in ("record.py", "check_record.py", "check_onboarded.py"):
            text = read_text(SHARED_ROOT, "scripts", script)
            for word in ("grounding_sources", "tracker_readable", "tickets_say", "term_source"):
                self.assertNotIn(word, text, script)


class TermsAndLanguageTest(BuiltCopies):
    """Part C: terms learned from tickets, and the person's language."""

    def test_ac_38_first_use_shows_the_other_term_and_where_it_came_from(self):
        self.assert_both_hold("write-tickets", ("assets", "ticket-template.md"), [
            ("The first time the author's term appears, the other term follows in brackets with "
             "where it came from"),
            '"(called entry gate in the tickets)"',
        ])
        reference = read_text(REFERENCES, "ground-from-tracker.md")
        self.assertEqual(missing(reference, [
            'The user\'s term still wins: "(called entry gate in the tickets)" follows its first use.',
        ]), [])
        requirements = read_text(PROJECT_ROOT, "docs", "plugin-discovery", "REQUIREMENTS.md")
        self.assertEqual(missing(requirements, [
            "A rejected mapping is corrected everywhere.",
            '"(called entry gate in the tickets)"',
        ]), [])

    def test_ac_39_voice_carries_the_language_rule_in_every_built_skill(self):
        rule = [
            "Reply in the language the person writes in, and follow them if they switch.",
            "Give the plugin's fixed sentences in that language with the same meaning.",
        ]
        voice = read_text(REFERENCES, "voice.md")
        self.assertEqual(missing(voice, rule), [])
        self.assertLessEqual(len(voice.rstrip("\n").split("\n")), MAX_REFERENCE_LINES)
        self.assertNotIn(EM_DASH, voice)
        self.assertNotIn(EN_DASH, voice)
        self.assertIsNone(VENDOR_PATTERN.search(voice))
        built = sorted(os.listdir(self.built_skills))
        self.assertEqual(len(built), 14)
        for skill in built:
            copy = os.path.join(self.built_skills, skill, "references", "voice.md")
            self.assertEqual(read_bytes(copy), voice.encode("utf-8"), skill)

    def test_ac_41_ticket_text_follows_the_language_of_the_existing_tickets(self):
        self.assert_both_hold("write-tickets", ("assets", "ticket-template.md"), [
            "Write the ticket in the language the tracker project's existing tickets use when they "
            "were read, otherwise in the author's language, unless the author asks for another.",
        ])
        reference = read_text(REFERENCES, "ground-from-tracker.md")
        self.assertEqual(missing(reference, [
            "Write ticket text in the language of the tickets already read, otherwise in the "
            "person's language, unless the person asks for another.",
        ]), [])

    def test_ac_42_the_label_is_translated_in_replies_and_tickets_and_kept_in_the_record(self):
        self.assert_both_hold("ground-in-project", ("references", "ground-from-tracker.md"), [
            "In another language, replies and tickets give the label in that language with the "
            "same meaning, and the record value keeps the English words.",
        ])


class RequirementsV33Test(unittest.TestCase):
    """FR-78 to FR-80: REQUIREMENTS.md is v3.3 with the new ids, the acceptance rows from AC-76 on
    and no em or en dash, and no README carries the version."""

    def setUp(self):
        self.text = read_text(PROJECT_ROOT, "docs", "plugin-discovery", "REQUIREMENTS.md")

    def test_markers_present_and_no_dash(self):
        markers = ["v3.3", "V-30", "OD-23", "GRD-17", "GRD-18", "GRD-19", "PUB-9", "U-20",
                   "TALK-16", TRACKER_ONLY_SENTENCE, STOP_SENTENCE, FINDING, TRACKER_SOURCE_LINE,
                   CUT_LINE, "`existing_key`", "`setup.grounding_sources`", "`tracker_readable`"]
        self.assertEqual(missing(self.text, markers), [])
        self.assertNotIn(EM_DASH, self.text)
        self.assertNotIn(EN_DASH, self.text)

    def test_new_acceptance_rows_present(self):
        for number in range(76, 114):
            self.assertIn("| AC-{0} |".format(number), self.text, number)

    def test_old_wording_is_gone_and_the_docs_against_code_rule_stays(self):
        self.assertNotIn("tracker only for step 6", self.text)
        self.assertIn(
            '"The docs say ..., but the code suggests ...", and neither is picked as fact.',
            normalised(self.text))

    def test_no_readme_carries_the_version(self):
        for parts in (("README.md",), ("publish", "claude", "README.md"),
                      ("publish", "chatgpt", "README.md")):
            self.assertNotIn("v3.3", read_text(REPO_ROOT, *parts), parts)

    def test_every_host_file_holds_the_new_unknown_as_pending(self):
        for host in ("claude", "chatgpt", "codex"):
            text = read_text(REPO_ROOT, "hosts", host + ".md")
            rows = [line for line in text.split("\n") if line.startswith("| U-20")]
            self.assertEqual(len(rows), 1, host)
            self.assertIn("| pending |  |", rows[0], host)


class ExistingEpicWordingTest(BuiltCopies):
    """Part B: the epic question at step 4, the draft at step 5 and the hand off at step 6, as
    worded in the skill sources and their built copies."""

    def setUp(self):
        self.text = read_text(SKILLS_ROOT, "product-discovery", "assets", "record-template.md")
        self.record = json.loads(self.text[self.text.index("{"):self.text.rindex("}") + 1])

    def test_ac_34_epic_question_and_cannot_check_sentence_word_for_word(self):
        self.assert_both_hold("decide-together", ("SKILL.md",),
                              [EPIC_QUESTION, CANNOT_CHECK_SENTENCE])
        self.assert_both_hold("post-tickets", ("SKILL.md",), [EXPORT_NOTE])
        requirements = read_text(PROJECT_ROOT, "docs", "plugin-discovery", "REQUIREMENTS.md")
        self.assertEqual(missing(requirements, [EPIC_QUESTION]), [])

    def test_ac_19_the_question_is_asked_once_and_recorded_as_the_epic_choice(self):
        self.assert_both_hold("decide-together", ("SKILL.md",), [
            ("Only when the outcome leads to tickets and the tracker is a Jira project that can be "
             'read, ask once, through the choice prompt: "Where should these tickets go?"'),
            '"A new epic" and up to three existing epics that match the idea',
            '"Under ABC-7: <epic title>"',
            "the recommended one marked with a short reason",
            "Record the answer as `epic_choice`",
            "ends the step without the question",
            "A tracker with no epics, such as GitHub Issues, never gets it.",
        ])
        choices = [d["epic_choice"] for d in self.record["decisions"] if "epic_choice" in d]
        self.assertEqual(choices, [[{"mode": "new"},
                                    {"mode": "existing", "key": "ABC-7", "title": ""}]])

    def test_ac_20_no_matching_epic_skips_the_question_with_one_line(self):
        self.assert_both_hold("decide-together", ("SKILL.md",), [
            "When no existing epic matches the idea, skip the question and say in one line that a "
            "new epic will be drafted and that an epic key can still be named.",
        ])

    def test_ac_21_a_typed_key_is_checked_and_nothing_is_recorded_until_it_passes(self):
        self.assert_both_hold("decide-together", ("SKILL.md",), [
            ("A typed key must look like a tracker key and its project part must equal "
             "`setup.project_key` before any read."),
            "Refuse a key from another project without opening the issue or showing its title.",
            "say which check failed and ask the same question again",
            "Record nothing until a key passes.",
        ])

    def test_ac_22_an_unreadable_tracker_drafts_a_new_epic(self):
        self.assert_both_hold("decide-together", ("SKILL.md",), [
            "When the tracker cannot be read, a key cannot be checked. Say this and draft a new "
            "epic: \"" + CANNOT_CHECK_SENTENCE + "\"",
        ])

    def test_ac_23_a_redraft_keeps_the_choice_and_a_change_brings_a_new_approval(self):
        self.assert_both_hold("write-tickets", ("SKILL.md",), [
            "A redraft keeps the recorded choice and does not ask again.",
            "that changes the recorded choice, so show the preview again and ask for approval again",
        ])
        self.assert_both_hold("decide-together", ("references", "decision-template.md"), [
            "a redraft keeps it, and changing it marks the ticket set, the readiness and the "
            "posting stale, so the preview and the approval come again",
        ])
        self.assert_both_hold("check-tickets", ("SKILL.md",), [
            "so a set that no longer matches the recorded epic choice is refused",
        ])

    def test_ac_25_one_choice_per_epic_and_a_single_group_can_be_moved(self):
        self.assert_both_hold("decide-together", ("references", "decision-template.md"), [
            "a list with one choice per planned epic, in epic order",
            "One run may mix a new epic and an existing one.",
        ])
        self.assert_both_hold("decide-together", ("SKILL.md",), [
            ("The step 5 preview shows where each group of tickets goes, and the user may move a "
             "single group there."),
            "Moving a group changes the choice, so the preview and the approval are shown again.",
        ])
        self.assert_both_hold("write-tickets", ("SKILL.md",), [
            "Each group shows where it goes: a new epic, or an existing epic on its own row marked "
            '"not changed".',
        ])

    def test_ac_26_a_resumed_run_with_an_unreadable_tracker_leaves_by_export(self):
        self.assert_both_hold("decide-together", ("references", "decision-template.md"), [
            "On resume with the tracker no longer readable, keep the choice",
            ("the tickets leave by export with the epic key, and one line says the epic was last "
             "checked in the earlier session and is not confirmed now"),
        ])
        self.assert_both_hold("post-tickets", ("SKILL.md",), [
            ("On resume with an unreadable tracker, export with the key and say the epic was last "
             "checked in the earlier session and is not confirmed now."),
            "Nothing is created until every check passes.",
        ])

    def test_ac_28_a_ticket_under_an_existing_epic_stands_on_its_own(self):
        self.assert_both_hold("write-tickets", ("SKILL.md",), [
            "each ticket under it carries the goal, the why and the scope it needs in its own body",
            "the title is the live title as read, never rewritten",
            "gets `existing_key`, the live title, an empty `body_markdown` and an empty `labels` list",
            "with the real key and title on its Epic line",
        ])
        self.assert_both_hold("write-tickets", ("assets", "ticket-template.md"), [
            "Under an existing epic the Epic line shows the real key and the live title",
            "`**Epic:** ABC-7 Order history`",
        ])
        self.assert_both_hold("write-tickets", ("assets", "epic-template.md"), [
            "An epic that already exists in the tracker is never drafted from this template.",
        ])

    def test_ac_31_and_ac_32_the_post_skill_asks_first_and_uses_the_live_title(self):
        self.assert_both_hold("post-tickets", ("SKILL.md",), [
            "ask before the first create",
            "A no creates nothing and goes back to the step 4 question.",
            ("say so in one line and use the live title on each ticket's Epic line before the "
             "approval"),
            'A failed read is "could not check the epic", never "the epic does not exist".',
            "the only operation on its key is the read",
            'An existing epic sits on its own row marked "not changed".',
            "never report a clean success",
        ])
        self.assert_both_hold("post-tickets", ("references", "post-procedure.md"), [
            "Every such read comes before the first create of any kind",
            "a retry finds the tickets already created by their run label and makes no second copy",
        ])

    def test_ac_17_later_steps_reuse_what_was_read(self):
        self.assert_both_hold("decide-together", ("SKILL.md",), [
            "When the total is used up, reuse what was read and say so in one line.",
        ])
        self.assert_both_hold("check-tickets", ("SKILL.md",), [
            "Never flag a chosen existing epic as its own duplicate.",
            "at most 25 and inside the run's read total",
            "when the total is used up, reuse what was read and say so",
        ])

    def test_posted_block_shows_an_existing_epic_as_not_changed(self):
        statuses = [row["status"] for row in self.record["posted"]["issues"]]
        self.assertEqual(statuses, ["created", "not changed"])
        self.assertEqual(missing(self.text, [
            "or not changed for an existing epic, which is never counted as created",
            "It sits inside the go-back chain, so it survives a redraft",
        ]), [])

    def test_existing_epic_scenarios_and_the_script_proven_rows(self):
        sys.path.insert(0, os.path.join(REPO_ROOT, "tests", "evals"))
        import run_parity
        scenarios = run_parity.load_scenarios(os.path.join(SCENARIOS, "existing-epic.yml"))["scenarios"]
        covered = {int(item["acceptance"].split("-")[1]) for item in scenarios}
        self.assertEqual(covered, {94, 95, 96, 97, 99, 100, 102, 104, 105})
        for item in scenarios:
            for field in ("id", "title", "acceptance", "entry_skill", "fixture", "tracker", "user"):
                self.assertNotIn(": ", str(item[field]), item["id"])
        readme = read_text(SCENARIOS, "README.md")
        self.assertEqual(missing(readme, [
            "AC-83, AC-103 and AC-106 are script-proven by `test_posting.py`",
            "AC-101 is script-proven by `test_tickets.py`",
            "AC-98 is script-proven by `test_record.py`",
        ]), [])
        sys.path.insert(0, os.path.join(REPO_ROOT, "tests", "ci"))
        import check_scenarios
        self.assertEqual(check_scenarios.check(), [])


class PublishedTextTest(unittest.TestCase):
    """FR-81, FR-82: the privacy, terms, README and listing texts disclose the tracker reading."""

    FILES = (("publish", "claude", "PRIVACY.md"), ("publish", "claude", "README.md"),
             ("publish", "chatgpt", "README.md"), ("publish", "claude", "TERMS.md"), ("README.md",),
             ("build", "skills.yml"))

    def test_every_text_says_what_is_read_and_what_never_is(self):
        for parts in self.FILES:
            flat = normalised(read_text(REPO_ROOT, *parts))
            self.assertIn("existing epics and tickets in the one tracker project you point it at",
                          flat, parts)
            self.assertRegex(flat, r"never (reads )?(their )?comments, attachments", parts)
            self.assertIn("people's names", flat, parts)
            self.assertNotIn(EM_DASH, flat, parts)
            self.assertNotIn(EN_DASH, flat, parts)
            self.assertNotIn("v3.3", flat, parts)

    def test_privacy_states_the_limits_and_what_reaches_the_tracker(self):
        text = read_text(REPO_ROOT, "publish", "claude", "PRIVACY.md")
        self.assertNotIn("Nothing else is sent to the tracker", normalised(text))
        self.assertEqual(missing(text, [
            "no more than 25 search results and opens no more than 10 tickets in a run",
            "key, type, summary, description, status, parent, labels and last updated date",
            "search words taken from your idea are sent to the tracker",
            "is processed by your AI host and kept as short lines",
            "in the discovery record in the working folder",
            "It never changes an existing epic.",
            "only when you approve", "## Contact", "## Changes",
            "## What the plugin reads", "## In short",
        ]), [])

    def test_listing_text_stays_inside_its_limits(self):
        config = skills_config()
        self.assertLessEqual(len(config["long_description"]), 4000)
        capabilities = [item.strip() for item in config["capabilities"].split("|")]
        self.assertLessEqual(len(capabilities), 20)
        self.assertTrue(all(len(item) <= 120 for item in capabilities))


class TrackerFixtureTest(unittest.TestCase):
    """FR-84: the fixture tracker gains epics and tickets, and a record from before the change."""

    def setUp(self):
        self.raw = read_text(FIXTURE_ROOT, "tracker", "tickets.json")
        self.tickets = {ticket["key"]: ticket for ticket in json.loads(self.raw)["tickets"]}

    def test_ac_5_fixture_holds_never_read_content_and_loy_12_is_byte_stable(self):
        ticket = self.tickets["SUB-81"]
        for field in ("comments", "assignee", "reporter", "attachments", "worklogs"):
            self.assertTrue(ticket[field], field)
        self.assertIn(LOY_12_BYTES, self.raw)
        skills = ("ground-in-project", "shape-idea", "write-tickets", "check-tickets")
        names = [ticket["assignee"], ticket["reporter"], ticket["comments"][0]["body"]]
        for skill in skills:
            for root, _dirs, files in os.walk(os.path.join(SKILLS_ROOT, skill)):
                for name in files:
                    if name.endswith(".md"):
                        text = read_text(root, name)
                        for value in names:
                            self.assertNotIn(value, text, name)
        reference = read_text(REFERENCES, "ground-from-tracker.md")
        self.assertEqual(missing(reference, [
            "Use only those eight, whatever comes back. Never quote, store or carry anything else.",
            "Never carry a person's name, a contact detail, a link or a secret-looking value.",
        ]), [])

    def test_fixture_has_an_open_epic_a_done_epic_and_a_done_ticket_the_code_does_not_bear_out(self):
        self.assertEqual(self.tickets["SUB-2"]["type"], "Epic")
        self.assertEqual(self.tickets["SUB-3"]["status"], "Done")
        self.assertEqual(self.tickets["SUB-80"]["status"], "Done")
        for root, _dirs, files in os.walk(os.path.join(FIXTURE_ROOT, "app")):
            for name in files:
                self.assertNotIn("skip", read_text(root, name).lower(), name)
        self.assertIn("hold", self.tickets["SUB-82"]["summary"])
        readme = read_text(FIXTURE_ROOT, "tracker", "README.md")
        for key in ("SUB-2", "SUB-3", "SUB-80", "SUB-81", "SUB-82"):
            self.assertIn(key, readme, key)

    def test_ac_11_fixture_record_has_no_grounding_sources_and_still_passes_the_record_check(self):
        import check_record
        path = os.path.join(FIXTURE_ROOT, "tracker", "record-before-tracker-grounding.json")
        record = json.loads(read_text(path))
        self.assertNotIn("grounding_sources", record["setup"])
        self.assertNotIn("tracker_readable", record["setup"])
        self.assertTrue(all("tickets_say" not in entry for entry in record["today"]))
        self.assertEqual(record["run"]["step"], 2)
        self.assertEqual(check_record.check(record), [])


class TrackerScenariosTest(unittest.TestCase):
    """FR-84, NFR-15: the conversation rows are covered by scenarios the coverage check counts."""

    def setUp(self):
        self.path = os.path.join(SCENARIOS, "tracker-grounding.yml")
        self.raw = read_text(self.path)
        sys.path.insert(0, os.path.join(REPO_ROOT, "tests", "evals"))
        import run_parity
        self.scenarios = run_parity.load_scenarios(self.path)["scenarios"]

    def covered(self):
        return {int(scenario["acceptance"].split("-")[1]) for scenario in self.scenarios}

    def test_every_part_a_and_part_c_row_has_a_scenario(self):
        expected = set(range(76, 83)) | set(range(84, 94)) | set(range(107, 114))
        self.assertEqual(self.covered(), expected)

    def test_ac_10_repository_only_scenario_expects_no_new_sentence_and_no_epic_question(self):
        scenario = [item for item in self.scenarios if item["id"] == "tg-88"][0]
        self.assertEqual(scenario["tracker"], "not readable")
        for word in ("behaves-as-before", "source-line-unchanged", "no-epic-question",
                     "hands-off-by-export"):
            self.assertIn(word, scenario["expect"])

    def test_read_limit_cases_cover_0_10_11_25_and_26(self):
        ids = {item["id"] for item in self.scenarios if item["acceptance"] == "AC-84"}
        self.assertEqual(ids, {"tg-84-0", "tg-84-10", "tg-84-11", "tg-84-25", "tg-84-26"})

    def test_every_property_is_defined_and_no_value_holds_a_colon_space(self):
        header = [line for line in self.raw.split("\n") if line.startswith("#")]
        defined = {line.lstrip("#").split()[0] for line in header if line.lstrip("#").strip()}
        known = set()
        for name in os.listdir(SCENARIOS):
            if name.endswith(".yml"):
                for line in read_text(SCENARIOS, name).split("\n"):
                    if line.startswith("#") and line.lstrip("#").strip():
                        known.add(line.lstrip("#").split()[0])
        for scenario in self.scenarios:
            for field in ("id", "title", "acceptance", "entry_skill", "fixture", "tracker", "user"):
                self.assertNotIn(": ", str(scenario[field]), scenario["id"])
            for word in scenario["expect"]:
                self.assertIn(word, known, scenario["id"])
        for word in ("tracker-only-sentence-once", "repository-wins-finding-shown",
                     "read-limits-hold", "never-read-fields-absent"):
            self.assertIn(word, defined)

    def test_repo_selection_gains_no_row(self):
        text = read_text(SCENARIOS, "repo-selection.yml")
        for number in range(76, 114):
            self.assertNotIn("AC-{0}".format(number), text)

    def test_readme_names_the_file_and_its_rows(self):
        readme = read_text(SCENARIOS, "README.md")
        self.assertEqual(missing(readme, [
            "`tracker-grounding.yml`",
            "AC-76 to AC-82, AC-84 to AC-93 and AC-107 to AC-113",
        ]), [])



PROJECT_SENTENCE = (
    "Your branches and commits mostly mention ABC tickets, so I'll use the ABC project in Jira."
)
GET_CONNECTED = os.path.join(REPO_ROOT, "skills", "get-connected")


def scenario_expectations(file_name):
    evals = os.path.join(REPO_ROOT, "tests", "evals")
    if evals not in sys.path:
        sys.path.insert(0, evals)
    import run_parity
    scenarios = run_parity.load_scenarios(os.path.join(SCENARIOS, file_name))["scenarios"]
    return {scenario["acceptance"]: set(scenario["expect"]) for scenario in scenarios}


class StepZeroProjectScanTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.skill = read_text(GET_CONNECTED, "SKILL.md")
        cls.tracker = read_text(GET_CONNECTED, "references", "connect-tracker.md")
        cls.flat = normalised(cls.skill)
        cls.expect = scenario_expectations("step-zero.yml")

    def test_ac20_one_clear_prefix_is_recommended_with_the_sentence_after_one_check(self):
        self.assertEqual(self.skill.count(PROJECT_SENTENCE), 1)
        self.assertEqual(missing(self.skill, [
            "at least 3 hits and at least twice the next",
            "check that project with one read",
            "one choice prompt",
            "scripts/find_ticket_keys.py",
            "up to 100 branch names and the subjects of the last 50 commits",
            "resolved by capability",
        ]), [])
        self.assertIn("scripts/find_ticket_keys.py", declared_imports()["get-connected"])
        self.assertTrue({"project-sentence-once", "only-one-project-check-read",
                         "no-broad-tracker-search", "key-source-repository"} <= self.expect["AC-115"])

    def test_ac21_no_keys_asks_and_records_asked(self):
        self.assertIn("Nothing found, nothing read or no list actions: ask which Jira project to use",
                      self.flat)
        self.assertIn("`asked` otherwise", self.flat)
        self.assertTrue({"asks-which-project", "key-source-asked"} <= self.expect["AC-116"])

    def test_ac24_ac25_a_prefix_below_the_floor_is_a_plain_choice(self):
        self.assertIn("Fewer than 3 hits: recommend nothing; ask which Jira project to use, with "
                      "the prefixes found as plain choices plus a different project", self.flat)
        self.assertTrue({"prefix-as-plain-choice", "asks-which-project"} <= self.expect["AC-117"])

    def test_ac28_a_failed_check_read_asks_without_a_broad_search(self):
        self.assertIn("If that one read fails (not found, renamed or not visible), say once why and "
                      "ask instead", self.flat)
        self.assertIn("Never search the tracker broadly to pick a project", self.flat)
        self.assertTrue({"reason-said-once", "no-broad-tracker-search"} <= self.expect["AC-118"])

    def test_ac29_every_prompt_offers_a_different_project(self):
        self.assertGreaterEqual(self.flat.count("a different project"), 3)
        self.assertIn("Every prompt offers a different project", normalised(self.tracker))
        for ac in ("AC-115", "AC-117", "AC-119"):
            self.assertIn("offers-a-different-project", self.expect[ac], ac)

    def test_ac30_jira_keys_with_only_github_connected_offer_the_choice(self):
        self.assertIn("name that Jira project once and let the person choose: connect Jira now, or "
                      "carry on with GitHub and export the tickets", self.flat)
        self.assertIn("jira-named-once-with-choice", self.expect["AC-120"])

    def test_ac31_a_cut_short_list_still_scans_the_lines_read(self):
        self.assertIn("A list that errors or is cut short still counts: scan the lines read and "
                      "record `lines_read`; ask only when nothing was read", self.flat)
        self.assertIn("A failed list read never makes the repository unreadable", self.flat)
        self.assertTrue({"scan-on-lines-read", "no-unreadable-sentence"} <= self.expect["AC-121"])

    def test_ac32_github_refs_only_follow_the_github_profile(self):
        self.assertIn("Only GitHub refs such as `#123`: set `setup.tracker_kind` to `github` and "
                      "follow `references/tracker-profiles-github.md`", self.flat)
        self.assertIn("tracker-kind-github", self.expect["AC-122"])

    def test_ac33_no_repository_skips_the_scan(self):
        self.assertIn("With no readable repository skip this and ask which project to use",
                      self.flat)
        self.assertTrue({"scan-skipped", "asks-which-project"} <= self.expect["AC-123"])

    def test_ac45_the_project_never_comes_from_a_broad_search(self):
        for ac in ("AC-115", "AC-116", "AC-118", "AC-119", "AC-120", "AC-122", "AC-123"):
            self.assertIn("no-broad-tracker-search", self.expect[ac], ac)
        self.assertIn("Never search the tracker broadly to find the project",
                      normalised(self.tracker))
        hand = self.skill[self.skill.index("## If the checks cannot run"):]
        self.assertIn("with the same thresholds", normalised(hand))
        self.assertIn("If the checks cannot run, do the same by hand", normalised(self.tracker))

    def test_ac27_the_record_keeps_counts_only(self):
        template = read_text(REPO_ROOT, "skills", "product-discovery", "assets",
                             "record-template.md")
        self.assertIn('"project_key_source"', template)
        self.assertIn('"ticket_key_scan": { "lines_read": 0, "jira_prefixes": [{ "prefix": "ABC", '
                      '"count": 0 }], "github_refs": 0 }', template)
        self.assertIn("never the examples, branch names or commit text", self.flat)

if __name__ == "__main__":
    unittest.main()
