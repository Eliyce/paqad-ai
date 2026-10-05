# paqad-product-discovery

Source for the paqad-product-discovery plugin: a set of skills that help shape product
ideas into well-formed tickets, grounded in the target project's own documentation. This
repository is the plugin source and build; it is not a paqad-onboarded product repo.

## Status

S1 is BUILT: the full idea journey and question answering on claude.ai. It ships the ten
idea-and-question skills built skills-only from one source, the ported scripts, the
consulting stance, Jira posting, record and export. Unit tests cover every skill script and
the eval scenarios are authored.

Host install across claude.ai, ChatGPT and Codex is still "packaged, not verified" (CI-19):
the plugin is packaged but no automated host verdict is claimed. The cross-host unknowns
(U-1..U-17) are verified MANUALLY, and those verdicts are still `pending` in
`hosts/{claude,chatgpt,codex}.md`.

Not yet built: S1b (`refine-ticket`, `size-work`, `plan-sprint`), S2 (ChatGPT and Codex
parity) and S3 (CI, evals in CI, release channels).

The product spec is `REQUIREMENTS.md`.

## The skills

Ten skills, built from one source. Five are entry points a user can invoke directly; the rest
run as the `product-discovery` journey directs them.

- `product-discovery` (entry) - coordinates the idea journey: step order, the record, resume,
  going back, side questions, the consulting stance, and plain status at every step.
- `ask-project` (entry) - answers a business question from the onboarded documents, with
  sources, and can hand the answer into the idea journey.
- `get-connected` - step 0: confirms the documents are reachable and onboarded, the tracker is
  writable, and reads the tracker project's setup.
- `understand-idea` - step 1: one question at a time until the goal, who benefits, success and
  constraints are clear.
- `ground-in-project` - step 2: reads the project's documents in order, finds related areas,
  and reports coverage and template sections.
- `shape-idea` - step 3: plays the idea back, looks through the expert lenses, and offers
  options, a smaller first step and a recommendation.
- `decide-together` - step 4: settles the open choices one at a time and records each decision.
- `write-tickets` - step 5 drafting: produces the canonical ticket set and a readable preview.
- `check-tickets` - step 5 checking: checks the tickets for gaps, duplicates, jargon and
  untestable outcomes, and searches the tracker for duplicates.
- `post-tickets` - step 6: final preview, approval, create in order, record receipts,
  reconcile, read back and report.

## Layout at a glance

- `shared/references/`, `shared/scripts/` - shared text and script modules imported into skills
  at build time, held once (PLG-9).
- `skills/<skill-name>/` - each skill source (`SKILL.md` plus any `references/`, `assets/`,
  `scripts/`).
- `build/skills.yml` - the single source of truth for name, version, description, license,
  display text, and each skill's declared shared imports.
- `build/build.py` - assembles `dist/` from that single source and generates every manifest.
- `hosts/{claude,chatgpt,codex}.md` - per-host manual install notes and the recording harness
  for the cross-host unknowns (U-1..U-17). Not shipped in the plugin.
- `tests/scripts/` - standard-library unit tests for every skill script.
- `tests/evals/fixture-repo/`, `tests/evals/scenarios/` - evaluation fixtures and scenarios.
- `dist/` - generated plugin output (produced by the build; gitignored, not hand-edited).
- `.changeset/`, `.github/workflows/{ci,release,verify}.yml` - release tracking and CI.

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

## Test

```
python3 -m unittest discover -s tests/scripts
```

## Host verification

The plugin is packaged for claude.ai, ChatGPT, and Codex, but S1 claims no automated host
verdict. The cross-host unknowns (U-1..U-17) are recorded MANUALLY in
`hosts/{claude,chatgpt,codex}.md`: install the plugin on each host, exercise the real skills
(ask a question with `ask-project`; start an idea with `product-discovery`), run the listed
checks, and fill in each verdict (every verdict starts as `pending`). "Packaged" is not
"verified"; host verification is complete only once those harnesses are filled in.
