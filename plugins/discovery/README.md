# paqad-product-discovery

Source for the paqad-product-discovery plugin: a set of skills that help ask what a product
does, shape ideas into user-story tickets, refine tickets, size work and plan sprints, grounded in
the target repository's docs and code. The plugin works on any
repository at the best evidence level it can reach (from project docs, from docs and code, or
from code only); it never refuses a repository that has readable code. This repository is the
plugin source and build; it is not itself a product repo the plugin answers questions about.

Provenance: moved here from `Eliyce/paqad-product-discovery` at commit 249b9f4d. That repository
keeps the earlier history.

The version is the paqad-ai version in the repository `package.json`. `build/build.py` reads it
from there, or from `--version` when given.

## What the plugin reads, says and links to

So the behaviour is disclosed and never a surprise under directory policy:

- Every answer carries exactly one short source line naming the evidence level it rests on:
  "paqad, from project docs", "paqad, from docs and code" or "paqad, from code only". It is
  provenance, not a sales line.
- When a repository is not fully set up with paqad, the plugin may show one informational upgrade
  nudge, at most once per conversation or when you ask why an answer is thin. It links to an
  information page only, never to a purchase page. The link carries only a static campaign tag
  (`src=discovery-plugin`) with no user, repository or question data. The link is exactly
  `https://paqad.ai/?src=discovery-plugin`. See [publish/claude/PRIVACY.md](publish/claude/PRIVACY.md).
- The plugin only reads: it reads the project documents and the code by names, honours a never-read
  list (secrets, environment files, `.paqad/` contents, `docs/instructions/rules/`, `.git/`,
  `vendor/`, `node_modules/`), and never edits, runs or installs anything.

## Status

S1 is BUILT: the full idea journey and question answering on claude.ai. It ships the ten
idea-and-question skills built skills-only from one source, the ported scripts, the
consulting stance, Jira posting, record and export. Unit tests cover every skill script and
the eval scenarios are authored.

Host install across claude.ai, ChatGPT and Codex is still "packaged, not verified" (CI-19):
the plugin is packaged but no automated host verdict is claimed. The cross-host unknowns
(U-1..U-17) are verified MANUALLY, and those verdicts are still `pending` in
`hosts/{claude,chatgpt,codex}.md`.

S1b is BUILT: the three existing-work entry skills (`refine-ticket`, `size-work`,
`plan-sprint`), each with standard-library unit tests and eval scenarios authored. Host
install for them stays "packaged, not verified" (CI-19), same as S1.

Not yet built: S2 (ChatGPT and Codex parity) and S3 (CI, evals in CI, release channels).

v3.2 applies the business-user test feedback: every choice goes through the host's choice prompt,
a closing question comes last after the sources, the journey never pauses to ask whether to carry
on, the record is kept silently with a resume file only on request, and tickets are user stories
with Given/When/Then acceptance criteria.

The product spec is [docs/plugin-discovery/REQUIREMENTS.md](../../docs/plugin-discovery/REQUIREMENTS.md).

## The skills

Fourteen skills, built from one source. Six are entry points a user can invoke directly; the
rest run as the `paqad-discover` journey directs them. Each skill's source folder keeps its
unprefixed name and the user-visible name is the `paqad-` published name applied at build time
(approach B); start from the `/paqad` front door and it routes you to the right entry skill.
Published name shown first, source folder in parentheses.

- `/paqad` (entry; source `front-door`) - the front door: routes an ask, discover, refine-ticket,
  size-work or plan-sprint intent to the matching entry skill behind the scenes.
- `paqad-discover` (entry; source `product-discovery`) - coordinates the idea journey: step order,
  the record (kept silently), resume on request, going back, side questions, the consulting stance,
  and plain status at every step.
- `paqad-ask` (entry; source `ask-project`) - answers a business question from the target repository
  at the best evidence level (project docs, docs and code, or code only), with sources and a source
  line, and can hand the answer into the idea journey.
- `paqad-refine-ticket` (entry; source `refine-ticket`) - refines an existing ticket field by field,
  applying each change only on approval.
- `paqad-size-work` (entry; source `size-work`) - gives advisory size suggestions for a piece of
  work, backed by comparables.
- `paqad-plan-sprint` (entry; source `plan-sprint`) - proposes a sprint plan and assigns the work on approval.
- `paqad-get-connected` (source `get-connected`) - step 0: confirms the repository is reachable,
  detects its evidence level, the tracker is writable, and reads the tracker project's setup.
- `paqad-understand-idea` (source `understand-idea`) - step 1: one question at a time until the goal,
  who benefits, success and constraints are clear.
- `paqad-ground-in-project` (source `ground-in-project`) - step 2: reads the project's documents in
  order, finds related areas, and reports coverage and template sections.
- `paqad-shape-idea` (source `shape-idea`) - step 3: plays the idea back, looks through the expert
  lenses, and offers options, a smaller first step and a recommendation.
- `paqad-decide-together` (source `decide-together`) - step 4: settles the open choices one at a time
  and records each decision.
- `paqad-write-tickets` (source `write-tickets`) - step 5 drafting: produces the canonical ticket set
  of user stories with Given/When/Then acceptance criteria, and a readable preview.
- `paqad-check-tickets` (source `check-tickets`) - step 5 checking: checks the tickets for gaps,
  duplicates, jargon and untestable outcomes, and searches the tracker for duplicates.
- `paqad-post-tickets` (source `post-tickets`) - step 6: final preview, approval, create in order,
  record receipts, reconcile, read back and report.

## Layout at a glance

- `shared/references/`, `shared/scripts/` - shared text and script modules imported into skills
  at build time, held once (PLG-9).
- `skills/<skill-name>/` - each skill source (`SKILL.md` plus any `references/`, `assets/`,
  `scripts/`).
- `build/skills.yml` - the single source of truth for name, description, license,
  display text, the directory listing values (author, links, keywords, and the ChatGPT directory
  short and long description, category, default prompts and capabilities), and each skill's
  declared shared imports.
- `publish/claude/` - the end-user `README.md`, the `LICENSE`, `PRIVACY.md` and `TERMS.md` that
  the build copies into the Claude branch.
- `publish/chatgpt/README.md` - the end-user README the build copies into the ChatGPT directory
  package only. That package reuses the Claude `LICENSE`, the privacy policy and `icon.png` (as
  `assets/logo.png`).
- `build/build.py` - assembles `dist/` from that single source and generates every manifest.
- `build/package_chatgpt.py` - packs the ChatGPT directory package into the submission zip.
- `build/check_chatgpt_submission.py` - the pre-submission check for that zip or folder.
- `hosts/{claude,chatgpt,codex}.md` - per-host manual install notes and the recording harness
  for the cross-host unknowns (U-1..U-17). Not shipped in the plugin.
- `tests/scripts/` - standard-library unit tests for every skill script.
- `tests/evals/fixture-repo/`, `tests/evals/scenarios/` - evaluation fixtures and scenarios.
- `dist/` - generated plugin output (produced by the build; gitignored, not hand-edited). Besides
  the combined root it holds one branch per host under `dist/hosts/`: `claude`, `chatgpt`
  (workspace import), `codex`, and `chatgpt-directory`, the native package for the ChatGPT plugin
  directory.

## Requirements

A working Python 3.9 or newer. The committed code is standard-library only, so no third-party
packages or network access are needed to build or test. Below, `python3` means such an
interpreter.

## Build

```
python3 build/build.py
```

This reads `build/skills.yml`, copies each skill plus its declared shared imports, and writes
the generated plugin into `dist/`. Runs are deterministic: two consecutive runs on a clean
tree produce byte-identical `dist/` output. `dist/` is gitignored built output.

The build never writes a zip. To make and check the ChatGPT directory submission zip:

```
python3 build/package_chatgpt.py
python3 build/check_chatgpt_submission.py --zip paqad-product-discovery-chatgpt-v<version>.zip
```

The first writes `paqad-product-discovery-chatgpt-v<version>.zip` at the repo root (gitignored)
from `dist/hosts/chatgpt-directory`. The second prints a JSON report and exits 0 only when there
is no error.

## Test

```
python3 -m unittest discover -s tests/scripts
```

## Publishing

The Claude branch, `dist/hosts/claude`, is the whole public plugin repo
`Eliyce/paqad-product-discovery-plugin`: the marketplace, `README.md`, `LICENSE`, `PRIVACY.md` and
the plugin at `plugins/paqad-product-discovery`. Validate it with the pinned CLI:

```
npx -y @anthropic-ai/claude-code@2.1.300 plugin validate --strict dist/hosts/claude
npx -y @anthropic-ai/claude-code@2.1.300 plugin validate --strict dist/hosts/claude/plugins/paqad-product-discovery
```

`release.yml` (CI-16) pushes that branch to the public repo when `ENABLE_PUBLIC_RELEASE` and
`PUBLIC_DISTRIBUTION_REPO` are set. The directory submission steps are in `hosts/claude.md`.

The ChatGPT plugin directory takes a zip upload instead. The zip holds only the native Agent
Plugins package from `dist/hosts/chatgpt-directory` (a root `plugin.json` with `$schema` and
`extensions.com.openai.interface`), built by `build/package_chatgpt.py` and checked by
`build/check_chatgpt_submission.py`. Every pull request packs it twice, compares the bytes and runs
the check (CI-16 in `ci.yml`); `release.yml` builds and checks the same zip as the artifact
`chatgpt-directory-submission-zip` when `ENABLE_PUBLIC_RELEASE` is set. The check covers only
OpenAI's documented rules, so it is necessary, not sufficient. The upload steps are in
`hosts/chatgpt.md`, Directory submission.

## Host verification

The plugin is packaged for claude.ai, ChatGPT, and Codex, but S1 claims no automated host
verdict. The cross-host unknowns (U-1..U-17) are recorded MANUALLY in
`hosts/{claude,chatgpt,codex}.md`: install the plugin on each host, exercise the real skills
(ask a question with `paqad-ask`, or start from the `/paqad` front door and start an idea with
`paqad-discover`), run the listed
checks, and fill in each verdict (every verdict starts as `pending`). "Packaged" is not
"verified"; host verification is complete only once those harnesses are filled in.
