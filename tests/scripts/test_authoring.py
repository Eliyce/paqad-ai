#!/usr/bin/env python3
"""Automated checks for the authoring acceptance criteria tagged proof:automated in the spec.

Standard library only (Python 3.9+). No network. Reads the source tree; writes nothing.
Covers AC-1 (skill frontmatter and structure), AC-10 (fixture repo is onboarded and carries a
template section), AC-11 (no host or vendor names under skills/ and shared/), AC-12 (no em dash
or en dash in authored content), and AC-13 (each SKILL.md opens with the How to talk block).

Paths resolve relative to the repository root (walked up from this file), so the suite is
portable and does not depend on any absolute path.
"""

import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))

SKILLS_ROOT = os.path.join(REPO_ROOT, "skills")
SHARED_ROOT = os.path.join(REPO_ROOT, "shared")
FIXTURE_ROOT = os.path.join(REPO_ROOT, "tests", "evals", "fixture-repo")

VENDOR_PATTERN = re.compile(r"claude|chatgpt|codex|anthropic|openai", re.IGNORECASE)
# Built with chr() so this source file itself stays ASCII and does not trip its own CI-5 check.
EM_DASH = chr(0x2014)
EN_DASH = chr(0x2013)

# Onboarding template markers from REQUIREMENTS.md section 7 (GRD-4), both generations.
TEMPLATE_MARKERS = (
    "Describe the business purpose of the",
    "Document the personas that interact with",
    "Capture the main user journeys for",
    "List the rules and invariants that must hold",
    "Record notifications, jobs, integrations",
    "Describe user-visible failures and recovery guidance",
    "Add domain terms that matter to stakeholders",
    "Capture the main journeys for",
    "Enumerate invariants that must hold",
    "Spell out idempotency expectations",
)


def read_text(path):
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def iter_source_files(root):
    """Yield every file path under root, skipping bytecode caches and compiled files."""
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d != "__pycache__"]
        for name in filenames:
            if name.endswith(".pyc"):
                continue
            yield os.path.join(dirpath, name)


def skill_dirs():
    return sorted(
        name
        for name in os.listdir(SKILLS_ROOT)
        if os.path.isdir(os.path.join(SKILLS_ROOT, name))
    )


def split_frontmatter(text):
    """Return (frontmatter_dict, body_text). Raises AssertionError on a malformed header."""
    lines = text.splitlines()
    assert lines and lines[0].strip() == "---", "SKILL.md must open with a --- frontmatter fence"
    fm = {}
    i = 1
    while i < len(lines) and lines[i].strip() != "---":
        key, sep, value = lines[i].partition(":")
        if sep:
            fm[key.strip()] = value.strip()
        i += 1
    assert i < len(lines), "SKILL.md frontmatter is not closed with ---"
    body = "\n".join(lines[i + 1:])
    return fm, body


class SkillFrontmatterTest(unittest.TestCase):
    """AC-1 (PLG-3): frontmatter name matches folder, description bounded, body under 500 lines,
    references nested at most one level deep."""

    def test_each_skill(self):
        skills = skill_dirs()
        self.assertTrue(skills, "no skills found under skills/")
        for skill in skills:
            skill_md = os.path.join(SKILLS_ROOT, skill, "SKILL.md")
            self.assertTrue(os.path.isfile(skill_md), "missing SKILL.md for {0}".format(skill))
            fm, body = split_frontmatter(read_text(skill_md))

            self.assertEqual(fm.get("name"), skill, "name must equal folder for {0}".format(skill))
            description = fm.get("description", "")
            self.assertTrue(description, "description missing for {0}".format(skill))
            self.assertLessEqual(
                len(description), 1024, "description over 1024 chars for {0}".format(skill)
            )

            body_line_count = len(body.splitlines())
            self.assertLess(
                body_line_count, 500, "SKILL.md body over 500 lines for {0}".format(skill)
            )

            references_dir = os.path.join(SKILLS_ROOT, skill, "references")
            if os.path.isdir(references_dir):
                for entry in os.listdir(references_dir):
                    self.assertFalse(
                        os.path.isdir(os.path.join(references_dir, entry)),
                        "references nested more than one level deep in {0}".format(skill),
                    )


class VoiceBlockTest(unittest.TestCase):
    """AC-13 (TALK-10/CI-20): each SKILL.md opens with a How to talk block pointing to
    references/voice.md."""

    def test_each_skill_opens_with_voice_block(self):
        for skill in skill_dirs():
            _, body = split_frontmatter(read_text(os.path.join(SKILLS_ROOT, skill, "SKILL.md")))
            non_empty = [ln for ln in body.splitlines() if ln.strip()]
            head = non_empty[:10]
            self.assertTrue(
                any("How to talk" in ln for ln in head),
                "no How to talk block near the top of {0} SKILL.md".format(skill),
            )
            head_text = "\n".join(non_empty[:15])
            self.assertIn(
                "references/voice.md",
                head_text,
                "How to talk block does not point to references/voice.md in {0}".format(skill),
            )


class NeutralWordingTest(unittest.TestCase):
    """AC-11 (PLG-4): no host or vendor names anywhere under skills/ or shared/."""

    def test_no_vendor_names(self):
        offenders = []
        for root in (SKILLS_ROOT, SHARED_ROOT):
            for path in iter_source_files(root):
                match = VENDOR_PATTERN.search(read_text(path))
                if match:
                    offenders.append(
                        "{0}: {1}".format(os.path.relpath(path, REPO_ROOT), match.group(0))
                    )
        self.assertEqual(offenders, [], "vendor name in shipped content: {0}".format(offenders))


class HousePromptTest(unittest.TestCase):
    """AC-12 (CI-5): no em dash and no en dash in authored content."""

    def test_no_em_or_en_dash(self):
        roots = [
            SKILLS_ROOT,
            SHARED_ROOT,
            os.path.join(REPO_ROOT, "hosts"),
            os.path.join(REPO_ROOT, "build"),
            os.path.join(REPO_ROOT, "tests"),
            os.path.join(REPO_ROOT, ".github"),
            os.path.join(REPO_ROOT, ".changeset"),
        ]
        offenders = []
        for root in roots:
            if not os.path.isdir(root):
                continue
            for path in iter_source_files(root):
                text = read_text(path)
                if EM_DASH in text or EN_DASH in text:
                    offenders.append(os.path.relpath(path, REPO_ROOT))
        self.assertEqual(offenders, [], "em or en dash in authored content: {0}".format(offenders))


class FixtureRepoTest(unittest.TestCase):
    """AC-10 (GRD-1): fixture repo is onboarded and a business.md carries both a real section and
    an onboarding template section."""

    def test_onboarded_layout(self):
        modules_md = os.path.join(
            FIXTURE_ROOT, "docs", "instructions", "registries", "modules.md"
        )
        self.assertTrue(os.path.isfile(modules_md), "fixture missing modules.md")

        modules_root = os.path.join(FIXTURE_ROOT, "docs", "modules")
        summaries = []
        for dirpath, _dirnames, filenames in os.walk(modules_root):
            if os.path.basename(dirpath) == "index" and "summary.md" in filenames:
                summaries.append(os.path.join(dirpath, "summary.md"))
        self.assertTrue(summaries, "fixture missing a docs/modules/<m>/index/summary.md")

    def test_business_md_has_real_and_template_sections(self):
        business_files = []
        for dirpath, _dirnames, filenames in os.walk(FIXTURE_ROOT):
            if "business.md" in filenames:
                business_files.append(os.path.join(dirpath, "business.md"))
        self.assertTrue(business_files, "fixture has no business.md")

        qualifying = []
        for path in business_files:
            text = read_text(path)
            has_template = any(marker in text for marker in TEMPLATE_MARKERS)
            has_real = "## Business rules" in text
            if has_template and has_real:
                qualifying.append(path)
        self.assertTrue(
            qualifying,
            "no business.md carries both a real section and a template-marker section",
        )


if __name__ == "__main__":
    unittest.main()
