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
import json
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

# The one canonical onboarded check, so the shared reference is compared with its real messages.
SHARED_SCRIPTS = os.path.join(SHARED_ROOT, "scripts")
if SHARED_SCRIPTS not in sys.path:
    sys.path.insert(0, SHARED_SCRIPTS)
import check_onboarded  # noqa: E402

# The entry skills a user may start directly (PLG-8/CI-11); every other skill is a step skill.
# S1b adds the three existing-work skills as entry skills (FR-13); the front door (published as
# paqad) is the sixth entry skill, so the set is six (FR-7). Source folders keep their unprefixed
# names, so the front door appears here as "front-door".
ENTRY_SKILLS = {
    "product-discovery",
    "ask-project",
    "refine-ticket",
    "size-work",
    "plan-sprint",
    "front-door",
}
# The front door is an entry skill everywhere, but it ships no scripts and so carries no "If the
# checks cannot run" capability fallback; it is exempt from that assertion alone (AC-10/INV-6).
CAPABILITY_FALLBACK_SKILLS = ENTRY_SKILLS - {"front-door"}
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
IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg")

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


def unquote_scalar(value):
    """Return a one-line frontmatter value without its YAML quotes (double or single)."""
    if len(value) >= 2 and value[0] == value[-1] == '"':
        return json.loads(value)
    if len(value) >= 2 and value[0] == value[-1] == "'":
        return value[1:-1].replace("''", "'")
    return value


def split_frontmatter(text):
    """Return (frontmatter_dict, body_text). Raises AssertionError on a malformed header."""
    lines = text.splitlines()
    assert lines and lines[0].strip() == "---", "SKILL.md must open with a --- frontmatter fence"
    fm = {}
    i = 1
    while i < len(lines) and lines[i].strip() != "---":
        key, sep, value = lines[i].partition(":")
        if sep:
            fm[key.strip()] = unquote_scalar(value.strip())
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


class OneLevelReferenceTest(unittest.TestCase):
    """CI-2 (TD-21): references nest at most one level deep, in the shared source and in the built
    dist skill references, not only in the authored skills/<skill>/references."""

    def _assert_flat(self, references_dir):
        for entry in sorted(os.listdir(references_dir)):
            self.assertFalse(
                os.path.isdir(os.path.join(references_dir, entry)),
                "references nested more than one level deep: {0}/{1}".format(references_dir, entry),
            )

    def test_shared_references_are_flat(self):
        shared_refs = os.path.join(SHARED_ROOT, "references")
        self.assertTrue(os.path.isdir(shared_refs), "shared/references is missing")
        self._assert_flat(shared_refs)

    def test_dist_skill_references_are_flat(self):
        dist_skills = os.path.join(
            REPO_ROOT, "dist", "plugins", "paqad-product-discovery", "skills")
        self.assertTrue(os.path.isdir(dist_skills), "dist is not built; run build/build.py")
        for skill in sorted(os.listdir(dist_skills)):
            refs = os.path.join(dist_skills, skill, "references")
            if os.path.isdir(refs):
                self._assert_flat(refs)


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
            os.path.join(REPO_ROOT, "publish"),
        ]
        offenders = []
        for root in roots:
            if not os.path.isdir(root):
                continue
            for path in iter_source_files(root):
                if path.endswith(IMAGE_SUFFIXES):
                    continue
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
        for skill in sorted(CAPABILITY_FALLBACK_SKILLS):
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
    the journey is identical across capabilities. The branch lives once in the shared
    connect-repository.md reference, which both reading skills point to."""

    def test_both_reading_skills_carry_the_branch(self):
        reference = read_text(os.path.join(SHARED_ROOT, "references", "connect-repository.md"))
        for phrase in (
            "by capability, not by host",
            "read repository files on demand",
            "attach the repository",
        ):
            self.assertIn(phrase, reference, "connect-repository.md is missing: {0}".format(phrase))
        for skill in ("ground-in-project", "ask-project"):
            text = read_text(os.path.join(SKILLS_ROOT, skill, "SKILL.md"))
            self.assertIn(
                "references/connect-repository.md",
                text,
                "{0} does not point to the shared doc-access reference".format(skill),
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


class GithubProfileTest(unittest.TestCase):
    """S4 part 1: the GitHub Issues tracker profile exists as a shared reference, is declared by the
    two tracker-touching skills, and describes GitHub as export only (no write action promised). The
    no-vendor-name and no-dash sweeps already cover the file through NeutralWordingTest and
    HousePromptTest, since it lives under shared/."""

    PROFILE_REL = "tracker-profiles-github.md"

    def test_profile_exists_with_core_sections(self):
        path = os.path.join(SHARED_ROOT, "references", self.PROFILE_REL)
        self.assertTrue(os.path.isfile(path), "GitHub tracker profile is missing")
        text = read_text(path)
        for heading in ("## Actions", "## Export", "## Labels", "## Setup to read at step 0"):
            self.assertIn(heading, text, "GitHub profile missing section {0}".format(heading))
        self.assertIn("export only", text.lower())

    def test_profile_declared_by_tracker_skills(self):
        declared = _declared_imports_by_skill()
        wanted = "references/" + self.PROFILE_REL
        for skill_name in ("get-connected", "post-tickets"):
            self.assertIn(
                wanted,
                declared.get(skill_name, []),
                "{0} does not declare the GitHub tracker profile".format(skill_name),
            )

    def test_tracker_skills_reference_the_profile(self):
        for skill_name in ("get-connected", "post-tickets"):
            text = read_text(os.path.join(SKILLS_ROOT, skill_name, "SKILL.md"))
            self.assertIn(
                self.PROFILE_REL,
                text,
                "{0} SKILL.md does not reference the GitHub tracker profile".format(skill_name),
            )


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



CONNECT_REPOSITORY = "references/connect-repository.md"
CHECK_ONBOARDED = "scripts/check_onboarded.py"
FIND_RELATED = "scripts/find_related.py"
CONNECT_REPOSITORY_SKILLS = {
    "ask-project",
    "get-connected",
    "ground-in-project",
    "refine-ticket",
    "size-work",
}
CHECK_ONBOARDED_SKILLS = {"get-connected", "ask-project", "ground-in-project"}
ASK_PROJECT_DESCRIPTION = (
    "Answers business questions about the product from the project's own documentation and code, in "
    "plain words with sources. Use it when someone asks what the product is, what it does or what "
    "areas it has (\"what is this product?\", \"what does this project do?\", \"what areas does it "
    "have?\"), when a repository is attached or connected and the user asks what it is or what it "
    "does, or when they ask how something works today (\"can customers pause a subscription "
    "today?\", \"who uses the export screen?\", \"which orders go to the finance system?\"). It "
    "works on any repository at the best evidence level it can reach, reads only what the question "
    "needs, leads with the answer, adds one short Sources line and one short source line for the "
    "level, shows the project's own term on first use, and says honestly where the documents cannot "
    "confirm something. It never writes to the tracker, and it can offer to carry a question into "
    "the idea journey when the answer reveals a gap."
)
OVERVIEW_CUES = ("what is this product?", "what does this project do?", "what areas does it have?")


def entry_description_problems(description):
    """Return the trigger-hygiene problems of an entry skill description (empty when clean)."""
    problems = []
    if len(description) > 1024:
        problems.append("over 1024 characters")
    if "\n" in description:
        problems.append("more than one line")
    if ": " in description:
        problems.append("contains ': '")
    if "<" in description or ">" in description:
        problems.append("contains < or >")
    if EM_DASH in description or EN_DASH in description:
        problems.append("contains a dash")
    if VENDOR_PATTERN.search(description):
        problems.append("names a host or vendor")
    if STEP_PHRASE in description:
        problems.append("reads as a step skill")
    if "Use it when" not in description:
        problems.append("missing 'Use it when'")
    return problems


def checklist_section(skill):
    text = read_text(os.path.join(SKILLS_ROOT, skill, "SKILL.md"))
    start = text.index("## If the checks cannot run")
    end = text.find("\n## ", start + 1)
    return text[start:] if end == -1 else text[start:end]


class RepositorySelectionTest(unittest.TestCase):
    """AC-18 (GRD-3, INV-4): one shared repository rule carries the by-capability branch, the choice
    cues, the four marks and both onboarded messages verbatim, and no skill-local copy remains."""

    def setUp(self):
        self.path = os.path.join(SHARED_ROOT, "references", "connect-repository.md")
        self.text = read_text(self.path)

    def test_by_capability_phrases(self):
        for phrase in ("by capability, not by host", "read repository files on demand",
                       "attach the repository"):
            self.assertIn(phrase, self.text)

    def test_selection_cues_and_marks(self):
        lowered = self.text.lower()
        for cue in ("list", "exactly one", "most recently active first", "recommended", "switch"):
            self.assertIn(cue, lowered, "missing selection cue {0}".format(cue))
        # Generic mode: the choice-list marks are the four evidence levels (FR-18, AC-5). The
        # onboarded-check table still maps the state words to those levels, so both appear.
        for mark in ("from project docs", "from docs and code", "from code only", "not checked"):
            self.assertIn(mark, lowered, "missing level mark {0}".format(mark))
        for mark in ("ready", "partly ready", "not set up", "not checked"):
            self.assertIn(mark, lowered, "missing state word {0}".format(mark))

    def test_messages_are_the_script_constants_verbatim(self):
        self.assertIn(check_onboarded.STOP_MESSAGE, self.text)
        self.assertIn(check_onboarded.PARTLY_MESSAGE, self.text)

    def test_at_most_100_lines(self):
        self.assertLessEqual(len(self.text.splitlines()), 100)

    def test_no_skill_local_copies_remain(self):
        for rel in (("references", "connect-repository.md"), ("scripts", "check_onboarded.py")):
            self.assertFalse(os.path.exists(os.path.join(SKILLS_ROOT, "get-connected", *rel)))
        self.assertTrue(os.path.isfile(os.path.join(SHARED_ROOT, "scripts", "check_onboarded.py")))


class RepositoryDeclarationTest(unittest.TestCase):
    """AC-19 (PLG-9, PLG-10): the shared rule and the onboarded check are declared by exactly the
    skills that use them, and every find_related user also ships check_onboarded."""

    def setUp(self):
        self.declared = _declared_imports_by_skill()

    def declarers(self, rel):
        return {skill for skill, imports in self.declared.items() if rel in imports}

    def test_exact_declarers(self):
        self.assertEqual(self.declarers(CONNECT_REPOSITORY), CONNECT_REPOSITORY_SKILLS)
        self.assertEqual(self.declarers(CHECK_ONBOARDED), CHECK_ONBOARDED_SKILLS)
        self.assertNotIn(CONNECT_REPOSITORY, self.declared["plan-sprint"])
        self.assertNotIn(CHECK_ONBOARDED, self.declared["plan-sprint"])

    def test_find_related_users_declare_check_onboarded(self):
        users = self.declarers(FIND_RELATED)
        self.assertTrue(users)
        self.assertLessEqual(users, self.declarers(CHECK_ONBOARDED))

    def test_declaring_skills_name_the_files(self):
        for rel in (CONNECT_REPOSITORY, CHECK_ONBOARDED):
            for skill in sorted(self.declarers(rel)):
                text = read_text(os.path.join(SKILLS_ROOT, skill, "SKILL.md"))
                self.assertIn(rel, text, "{0} declares {1} but never names it".format(skill, rel))


class SingleSourceDocAccessTest(unittest.TestCase):
    """AC-20: the two reading skills point to the shared rule instead of an inline copy."""

    def test_reading_skills_point_to_the_shared_rule(self):
        for skill in ("ask-project", "ground-in-project"):
            text = read_text(os.path.join(SKILLS_ROOT, skill, "SKILL.md"))
            self.assertIn(CONNECT_REPOSITORY, text)
            self.assertNotIn("upload `docs/` as files or a zip", text)


class AskProjectTriggerTest(unittest.TestCase):
    """AC-21 (PLG-8): the widened ask-project description, and the helper that guards it."""

    def test_description_is_the_frozen_text(self):
        fm, _ = split_frontmatter(read_text(os.path.join(SKILLS_ROOT, "ask-project", "SKILL.md")))
        description = fm["description"]
        self.assertEqual(description, ASK_PROJECT_DESCRIPTION)
        self.assertTrue(description.startswith("Answers"))
        for cue in OVERVIEW_CUES + ("a repository is attached or connected",):
            self.assertIn(cue, description)
        self.assertEqual(entry_description_problems(description), [])

    def test_helper_rejects_planted_descriptions(self):
        planted = {
            "over 1024 characters": ASK_PROJECT_DESCRIPTION + " x" * 200,
            "contains ': '": ASK_PROJECT_DESCRIPTION + " Note: more.",
            "reads as a step skill": ASK_PROJECT_DESCRIPTION + " Runs when the journey directs it.",
            "contains a dash": ASK_PROJECT_DESCRIPTION.replace(", in plain", " " + EM_DASH + " in plain"),
        }
        for problem, description in planted.items():
            self.assertIn(problem, entry_description_problems(description))


class RecordRepositoryFieldsTest(unittest.TestCase):
    """AC-22 (REC-1, FR-32): the record template's setup block carries the repository choice."""

    def test_setup_carries_repository_fields(self):
        text = read_text(
            os.path.join(SKILLS_ROOT, "product-discovery", "assets", "record-template.md")
        )
        record = json.loads(text[text.index("{"):text.rindex("}") + 1])
        self.assertEqual(record["setup"]["repository"], "")
        self.assertEqual(record["setup"]["repository_state"], "")


class ThreeStateChecklistTest(unittest.TestCase):
    """AC-23 (PLG-6): each onboarded-check fallback does the three-state check by hand."""

    def test_checklists_name_the_three_states(self):
        for skill in sorted(CHECK_ONBOARDED_SKILLS):
            section = " ".join(checklist_section(skill).lower().split())
            for phrase in ("partly ready", "not set up", "empty or whitespace-only summary as missing",
                           CONNECT_REPOSITORY):
                self.assertIn(phrase, section, "{0} checklist missing {1}".format(skill, phrase))


class RequirementsV24Test(unittest.TestCase):
    """AC-26: REQUIREMENTS.md records the v2.4 change, and it and the get-the-documents feature
    docs stay free of em and en dashes."""

    def test_v24_markers_present(self):
        text = read_text(os.path.join(REPO_ROOT, "REQUIREMENTS.md"))
        for marker in ("v2.4", "V-25", "D-19", "D-20", "ASK-9", "OD-16", "OD-17", "U-18",
                       check_onboarded.PARTLY_MESSAGE, check_onboarded.STOP_MESSAGE):
            self.assertIn(marker, text)
        self.assertNotIn(EM_DASH, text)
        self.assertNotIn(EN_DASH, text)

    def test_get_the_documents_docs_have_no_dash(self):
        feature_dir = os.path.join(
            REPO_ROOT, "docs", "modules", "project-grounding", "features", "get-the-documents"
        )
        self.assertTrue(os.path.isdir(feature_dir), "missing {0}".format(feature_dir))
        paths = sorted(glob.glob(os.path.join(feature_dir, "*.md")))
        # A wrong path must fail here, not pass on an empty set (RL-6d7a).
        names = [os.path.basename(path) for path in paths]
        for expected in ("api.md", "business.md", "technical.md"):
            self.assertIn(expected, names, "get-the-documents missing {0}".format(expected))
        offenders = []
        for path in paths:
            text = read_text(path)
            if EM_DASH in text or EN_DASH in text:
                offenders.append(os.path.relpath(path, REPO_ROOT))
        self.assertEqual(
            offenders, [], "em or en dash in get-the-documents docs: {0}".format(offenders)
        )


if __name__ == "__main__":
    unittest.main()
