#!/usr/bin/env python3
"""Automated checks for the v3.2 business-user feedback conversation rules (V-29).

Standard library only (Python 3.9+). No network. Reads the source tree; writes nothing.
Covers AC-1 (every choice through the host's choice prompt, a list in the reply only without one),
AC-4 (the question last, after the sources), AC-6 (the record kept silently, a resume file only on
request, the no-files fallback kept), AC-9 (keep moving, no carry-on pause) and AC-16
(REQUIREMENTS.md at v3.2 with its new markers and no em or en dash).

Text is compared with whitespace folded, so a rule wrapped across lines still matches.
"""

import json
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
SKILLS_ROOT = os.path.join(REPO_ROOT, "skills")
SHARED_ROOT = os.path.join(REPO_ROOT, "shared")
VOICE = os.path.join(SHARED_ROOT, "references", "voice.md")
CONSULTING = os.path.join(SHARED_ROOT, "references", "consulting.md")
DISCOVERY_SKILL = os.path.join(SKILLS_ROOT, "product-discovery", "SKILL.md")
JOURNEY = os.path.join(SKILLS_ROOT, "product-discovery", "references", "journey.md")
CHALLENGE_GUIDE = os.path.join(SKILLS_ROOT, "shape-idea", "references", "challenge-guide.md")
PLAYBACK_TEMPLATE = os.path.join(SKILLS_ROOT, "shape-idea", "references", "playback-template.md")
REQUIREMENTS = os.path.join(REPO_ROOT, "REQUIREMENTS.md")

CHOICE_PROMPT = "choice prompt"
KEEP_MOVING = "straight into the next step"
RESUME_FILE = "resume file"
# Built with chr() so this source file stays ASCII and does not trip the CI-5 dash check.
EM_DASH = chr(0x2014)
EN_DASH = chr(0x2013)
# Phrases the old journey used to offer the record; none may remain under skills/ or shared/.
DOWNLOAD_OFFERS = ("offer the user a download of the record", "offer it for download")
CARRY_ON_PAUSE = "Want me to carry on"
FIRST_NEW_AC = 68
LAST_NEW_AC = 75


def folded(path):
    """Return the file's text with every run of whitespace folded to one space."""
    with open(path, "r", encoding="utf-8") as handle:
        return " ".join(handle.read().split())


def source_files():
    """Return every authored text file under skills/ and shared/ (no bytecode caches)."""
    paths = []
    for root in (SKILLS_ROOT, SHARED_ROOT):
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d != "__pycache__"]
            paths.extend(os.path.join(dirpath, name) for name in filenames
                         if not name.endswith(".pyc"))
    return paths


def unquote_scalar(value):
    """Return a one-line frontmatter value without its YAML quotes (double or single)."""
    if len(value) >= 2 and value[0] == value[-1] == '"':
        return json.loads(value)
    if len(value) >= 2 and value[0] == value[-1] == "'":
        return value[1:-1].replace("''", "'")
    return value


def frontmatter_description(path):
    """Return the one-line description from a SKILL.md frontmatter."""
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            if line.startswith("description:"):
                return unquote_scalar(line.partition(":")[2].strip())
    return ""


def relative(path):
    return os.path.relpath(path, REPO_ROOT)


class ChoicePromptTest(unittest.TestCase):
    """AC-1: the choice prompt is named wherever a choice is asked; a list only without one."""

    def test_voice_states_the_rule_and_the_fallback(self):
        text = folded(VOICE)
        self.assertIn("the host's choice prompt", text)
        self.assertIn("Only when the host has no choice prompt, show the choices as a short list or "
                      "table in the reply", text)
        self.assertIn("Never show choices as a table or list in the reply when the choice prompt "
                      "is available", text)

    def test_consulting_con1_names_the_choice_prompt(self):
        text = folded(CONSULTING)
        con1 = text[text.index("## CON-1."):text.index("## CON-2.")]
        self.assertIn("the host's choice prompt", con1)

    def test_step_skills_and_references_name_the_choice_prompt(self):
        paths = [
            os.path.join(SKILLS_ROOT, "understand-idea", "SKILL.md"),
            os.path.join(SKILLS_ROOT, "understand-idea", "references", "success-prompts.md"),
            os.path.join(SKILLS_ROOT, "shape-idea", "SKILL.md"),
            CHALLENGE_GUIDE,
            os.path.join(SKILLS_ROOT, "decide-together", "SKILL.md"),
        ]
        for path in paths:
            self.assertIn(CHOICE_PROMPT, folded(path),
                          "{0} does not name the choice prompt".format(relative(path)))

    def test_options_no_longer_listed_as_table_material(self):
        text = folded(VOICE)
        tables = text[text.index("- Tables when they make sense."):text.index("- Lead with the answer.")]
        self.assertNotIn("options", tables)
        self.assertIn("go in the choice prompt, not a table", tables)


class QuestionLastTest(unittest.TestCase):
    """AC-4: the question comes last, after the sources, in the rule and in both examples."""

    def test_voice_carries_the_question_last_rule(self):
        text = folded(VOICE)
        self.assertIn("Question last.", text)
        self.assertIn("the question is the very last thing", text)
        self.assertIn("never hidden above the sources", text)

    def test_challenge_example_puts_sources_before_the_question(self):
        text = folded(CHALLENGE_GUIDE)
        example = text[text.index("## Example"):]
        self.assertLess(example.index("Sources:"), example.index("Which way?"))

    def test_playback_template_puts_sources_before_the_question(self):
        text = folded(PLAYBACK_TEMPLATE)
        self.assertLess(text.index("Sources line"), text.index("Does that shape work"))
        shape = text[text.index("## Example shape"):]
        self.assertIn("Last: Sources line, then the question in the choice prompt", shape)


class SilentRecordTest(unittest.TestCase):
    """AC-6: the record stays silent; a resume file only on request; the fallback stays."""

    def test_voice_carries_the_silent_record_rule(self):
        text = folded(VOICE)
        self.assertIn("The record stays silent.", text)
        self.assertIn(RESUME_FILE, text)
        self.assertIn("without naming its format", text)

    def test_product_discovery_offers_a_resume_file_only(self):
        text = folded(DISCOVERY_SKILL)
        self.assertIn(RESUME_FILE, text)
        self.assertIn("cannot create files", text)
        self.assertIn("chat summary", text)
        self.assertIn("Never offer, name or describe the record or its file", text)
        self.assertNotIn("download", frontmatter_description(DISCOVERY_SKILL))

    def test_no_download_offer_of_the_record_remains(self):
        files = source_files()
        # A wrong root must fail here, not pass on an empty set (RL-6d7a).
        self.assertTrue(files, "no files found under skills/ or shared/")
        for path in files:
            text = folded(path)
            for phrase in DOWNLOAD_OFFERS:
                self.assertNotIn(phrase, text, "{0} still offers the record".format(relative(path)))


class KeepMovingTest(unittest.TestCase):
    """AC-9: the keep-moving rule is in voice, the journey skill and the journey reference."""

    def test_keep_moving_rule_present(self):
        for path in (VOICE, DISCOVERY_SKILL, JOURNEY):
            text = folded(path)
            self.assertIn(KEEP_MOVING, text, "{0} lacks the keep-moving rule".format(relative(path)))
            self.assertIn("carry on", text)

    def test_no_carry_on_pause_anywhere(self):
        for path in source_files():
            self.assertNotIn(CARRY_ON_PAUSE, folded(path),
                             "{0} asks to carry on".format(relative(path)))


class RequirementsV32Test(unittest.TestCase):
    """AC-16: REQUIREMENTS.md records v3.2, its new rows, and stays free of em and en dashes."""

    def test_v32_markers_present(self):
        text = folded(REQUIREMENTS)
        for marker in ("v3.2", "V-29", "OD-21", "TALK-13", "TALK-14", "TALK-15", "TKT-6",
                       RESUME_FILE):
            self.assertIn(marker, text)
        for number in range(FIRST_NEW_AC, LAST_NEW_AC + 1):
            self.assertIn("| AC-{0} |".format(number), text)

    def test_no_dash(self):
        text = folded(REQUIREMENTS)
        self.assertNotIn(EM_DASH, text)
        self.assertNotIn(EN_DASH, text)


if __name__ == "__main__":
    unittest.main()
