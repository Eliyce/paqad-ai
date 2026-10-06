#!/usr/bin/env python3
"""Automated checks for the authoring acceptance criteria tagged proof:automated in the spec.

Standard library only (Python 3.9+). No network. Reads the source tree; writes nothing.
Covers AC-1 (skill frontmatter and structure), AC-10 (fixture repo is onboarded and carries a
template section), AC-11 (no host or vendor names under skills/ and shared/), AC-12 (no em dash
or en dash in authored content), and AC-13 (each SKILL.md opens with the How to talk block).

Paths resolve relative to the repository root (walked up from this file), so the suite is
portable and does not depend on any absolute path.
"""

import glob
import os
import re
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))

SKILLS_ROOT = os.path.join(REPO_ROOT, "skills")
SHARED_ROOT = os.path.join(REPO_ROOT, "shared")
FIXTURE_ROOT = os.path.join(REPO_ROOT, "tests", "evals", "fixture-repo")
SKILLS_YML = os.path.join(REPO_ROOT, "build", "skills.yml")

# Reuse the one canonical skills.yml reader from the build so this suite never re-derives it.
BUILD_DIR = os.path.join(REPO_ROOT, "build")
if BUILD_DIR not in sys.path:
    sys.path.insert(0, BUILD_DIR)
import build  # noqa: E402

# The entry skills a user may start directly (PLG-8/CI-11); every other skill is a step skill.
# S1b adds the three existing-work skills as entry skills (FR-13), bringing the set to five.
ENTRY_SKILLS = {
    "product-discovery",
    "ask-project",
    "refine-ticket",
    "size-work",
    "plan-sprint",
}
# A step skill's description states it runs only when the journey directs it.
STEP_PHRASE = "journey directs it"
# The script-bearing skills that must carry a checklist fallback (PLG-6). S1b adds refine-ticket,
# size-work and plan-sprint: each ships its own scripts/*.py and declares shared scripts/*.py.
SCRIPT_BEARING_SKILLS = {
    "product-discovery",
    "ask-project",
    "get-connected",
    "ground-in-project",
    "check-tickets",
    "post-tickets",
    "refine-ticket",
    "size-work",
    "plan-sprint",
}

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
    """Return the authored skill directories: those that carry a SKILL.md.

    A skill directory that holds only scripts/ (its SKILL.md and references are authored in a
    later wave) is not yet an authored skill, so the authoring assertions below do not apply to
    it until its SKILL.md exists. Every S1 skill has a SKILL.md and so is always included.
    """
    return sorted(
        name
        for name in os.listdir(SKILLS_ROOT)
        if os.path.isdir(os.path.join(SKILLS_ROOT, name))
        and os.path.isfile(os.path.join(SKILLS_ROOT, name, "SKILL.md"))
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


def _declared_imports_by_skill():
    """Return {skill_name: [declared shared imports]} from build/skills.yml, via build's reader."""
    with open(SKILLS_YML, "r", encoding="utf-8") as handle:
        config = build.parse_skills_yml(handle.read())
    return {skill["name"]: list(skill["imports"]) for skill in config["skills"]}


class TriggerHygieneTest(unittest.TestCase):
    """AC-19 (PLG-8/CI-11): the entry skills are exactly the five {product-discovery, ask-project,
    refine-ticket, size-work, plan-sprint} and may invite direct use; every other skill is a step
    skill whose description states it runs only when the product-discovery journey directs it, so a
    host never fires a step skill on its own before a run exists."""

    def test_entry_skills_present(self):
        skills = set(skill_dirs())
        self.assertTrue(
            ENTRY_SKILLS.issubset(skills),
            "entry skills missing from the source tree: {0}".format(ENTRY_SKILLS - skills),
        )

    def test_entry_and_step_descriptions(self):
        for skill in skill_dirs():
            fm, _ = split_frontmatter(read_text(os.path.join(SKILLS_ROOT, skill, "SKILL.md")))
            description = fm.get("description", "")
            self.assertTrue(description, "description missing for {0}".format(skill))
            if skill in ENTRY_SKILLS:
                self.assertNotIn(
                    STEP_PHRASE,
                    description,
                    "entry skill {0} must not read as a step skill".format(skill),
                )
            else:
                self.assertIn(
                    STEP_PHRASE,
                    description,
                    "step skill {0} must say it runs only when the journey directs it".format(
                        skill
                    ),
                )


class ChecklistFallbackTest(unittest.TestCase):
    """AC-16 (PLG-6): every script-bearing skill carries an 'If the checks cannot run' checklist
    fallback section so the skill reaches the same outcome by hand on a host where scripts cannot
    run. A skill is script-bearing when it ships its own scripts/*.py or declares a shared
    scripts/*.py import in build/skills.yml."""

    def test_script_bearing_set_is_detected(self):
        declared = _declared_imports_by_skill()
        detected = set()
        for skill in skill_dirs():
            own_scripts = glob.glob(os.path.join(SKILLS_ROOT, skill, "scripts", "*.py"))
            declares_script = any(
                imp.startswith("scripts/") and imp.endswith(".py")
                for imp in declared.get(skill, [])
            )
            if own_scripts or declares_script:
                detected.add(skill)
        self.assertEqual(
            detected,
            SCRIPT_BEARING_SKILLS,
            "script-bearing detection drifted from the spec set: {0}".format(detected),
        )

    def test_each_script_bearing_skill_has_fallback(self):
        for skill in sorted(SCRIPT_BEARING_SKILLS):
            text = read_text(os.path.join(SKILLS_ROOT, skill, "SKILL.md"))
            self.assertIn(
                "If the checks cannot run",
                text,
                "script-bearing skill {0} is missing its checklist fallback section".format(skill),
            )


class CapabilityFallbackTest(unittest.TestCase):
    """AC-5 (PLG-7/AC-20): every entry skill carries a capability-based fallback section, and no
    shipped skill branches on a host or vendor name under skills/."""

    def test_every_entry_skill_has_capability_fallback(self):
        for skill in sorted(ENTRY_SKILLS):
            text = read_text(os.path.join(SKILLS_ROOT, skill, "SKILL.md"))
            self.assertIn(
                "If the checks cannot run",
                text,
                "entry skill {0} is missing its capability fallback section".format(skill),
            )

    def test_no_host_or_vendor_branching_under_skills(self):
        offenders = []
        for path in iter_source_files(SKILLS_ROOT):
            match = VENDOR_PATTERN.search(read_text(path))
            if match:
                offenders.append(
                    "{0}: {1}".format(os.path.relpath(path, REPO_ROOT), match.group(0))
                )
        self.assertEqual(
            offenders, [], "host or vendor branching under skills/: {0}".format(offenders)
        )


class DocAccessBranchTest(unittest.TestCase):
    """AC-3 (GRD-3): ground-in-project and ask-project carry the capability doc-access branch -- read
    repository files with a tool if one can, otherwise ask the user to attach or upload docs -- so
    the journey is identical across capabilities."""

    def test_both_reading_skills_carry_the_branch(self):
        for skill in ("ground-in-project", "ask-project"):
            text = read_text(os.path.join(SKILLS_ROOT, skill, "SKILL.md"))
            self.assertIn(
                "by capability, not by host",
                text,
                "{0} is missing the by-capability doc-access framing".format(skill),
            )
            self.assertIn(
                "read repository files on demand",
                text,
                "{0} is missing the read-on-demand branch".format(skill),
            )
            self.assertIn(
                "attach the repository",
                text,
                "{0} is missing the attach-or-upload branch".format(skill),
            )


class RecordFallbackTest(unittest.TestCase):
    """AC-4 (REC-2): product-discovery states the file-versus-chat-summary record fallback so resume
    and the one-line status are host-independent."""

    def test_product_discovery_states_file_vs_chat_summary(self):
        text = read_text(os.path.join(SKILLS_ROOT, "product-discovery", "SKILL.md"))
        self.assertIn("cannot create files", text)
        self.assertIn("chat summary", text)


class PostLinkFallbackTest(unittest.TestCase):
    """AC-1 (U-3): post-tickets carries the capability link fallback -- links with the action when it
    exists, otherwise each dependency as a Depends on text line with the user asked to link by hand --
    in both the SKILL.md and the posting procedure, with no host branching."""

    def test_post_tickets_carries_link_fallback(self):
        skill = read_text(os.path.join(SKILLS_ROOT, "post-tickets", "SKILL.md"))
        procedure = read_text(
            os.path.join(SKILLS_ROOT, "post-tickets", "references", "post-procedure.md")
        )
        for text in (skill, procedure):
            self.assertIn("Depends on", text)
            self.assertIn("link action", text)
            self.assertIsNone(VENDOR_PATTERN.search(text))
        self.assertIn("add the links by hand", skill)


class VendorScanScopeTest(unittest.TestCase):
    """AC-6 (CI-4): the neutral-wording scan walks only skills/ and shared/, so the per-host build
    constant and the parity harness may name the three hosts under build/ and tests/. This test
    confirms the scope is load-bearing: a host name does appear under build/ or tests/ today, yet
    none leaks into skills/ or shared/."""

    def test_host_names_allowed_under_build_and_tests(self):
        named = False
        for root in (os.path.join(REPO_ROOT, "build"), os.path.join(REPO_ROOT, "tests")):
            if not os.path.isdir(root):
                continue
            for path in iter_source_files(root):
                if VENDOR_PATTERN.search(read_text(path)):
                    named = True
                    break
            if named:
                break
        self.assertTrue(
            named,
            "expected at least one host name under build/ or tests/; the CI-4 scope must exclude them",
        )

    def test_no_host_name_under_skills_or_shared(self):
        for root in (SKILLS_ROOT, SHARED_ROOT):
            for path in iter_source_files(root):
                self.assertIsNone(
                    VENDOR_PATTERN.search(read_text(path)),
                    "vendor name under {0}".format(os.path.relpath(path, REPO_ROOT)),
                )


if __name__ == "__main__":
    unittest.main()
