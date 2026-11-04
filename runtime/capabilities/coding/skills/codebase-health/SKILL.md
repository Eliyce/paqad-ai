---
name: codebase-health
description: Runs the codebase health audit through the paqad-ai health verbs, then triages and narrates the findings on dead code, packages, secrets, stale docs and copy-paste, and retests an earlier report. Use when the user asks to check project or code health, audit the codebase, find dead code or unused code or packages, run a cleanup audit, or retest health findings; the workflow is codebase-health or health-retest.
metadata:
  model_tier: reasoning
  cacheable: 'false'
  output_format: markdown
  paqad-meta: skill.meta.yaml
---

## What It Does

Audit the project for code and packages that no longer earn their place: dead code,
unused packages, outdated or risky packages, leaked secrets, stale docs, and copy-paste
AI slop. A sibling of pentest and design-test: same tier, routed and rule-driven, no
stage-gating. Detection is deterministic and costs zero model tokens; you orchestrate,
triage, and narrate.

A retest of an earlier report is the Retest mode of this skill.

## Use This When

Run this workflow whenever the user says anything equivalent to:

- "check my project's health", "codebase health", "code health", "health check", "health audit"
- "audit my codebase", "find dead code", "check for unused code/packages", "cleanup audit"

Do **not** improvise a health audit. Always follow the steps below in order. For a retest
of an existing report, use the `health-retest` workflow instead. Note: a security review
is **pentest**, not this workflow.

Use the Retest mode below when the workflow is `health-retest`.

## Inputs

### Source-of-Truth Model

There is one source of truth: the deterministic `paqad-ai health run` verb. It does all
detection and writes the findings JSON. You never re-derive or invent a finding: you run
the verb, read its output, triage it, and write the prose the report needs.

| Source                                                      | Role                                         |
| ----------------------------------------------------------- | -------------------------------------------- |
| `paqad-ai health run` output (`docs/health/<ts>.json`)      | **the findings**: proof is machine-generated |
| The code-knowledge index, dependency inventory, tool output | **primary evidence** the verb cites          |
| The human report `docs/health/<ts>.md`                      | **the deliverable** you narrate              |

## Procedure

Progress and outputs live under `.paqad/health/runs/<run_id>/` and `docs/health/`. The run
is resumable and baseline-ratcheted: the first run records `.paqad/health/baseline.json`,
and later runs mark each finding `new-since-baseline` vs `pre-existing`.

### Step 1: run the verb

Run `paqad-ai health run` (add `--offline` if the user asked to skip network checks). It:

- reuses the code-knowledge index for dead code + unused dependencies (run `paqad-ai index
build` first if it reports `blocked_checks: index-not-built`),
- shells out to `osv-scanner`, `gitleaks`, `jscpd` when they are on PATH and degrades to a
  labelled fallback or a `blocked_checks` entry (with an install hint) when they are not,
- writes `docs/health/<ts>.md` + `docs/health/<ts>.json` and the per-run finding index.

The verb's exit code is the verdict: 0 clean, 1 findings, 2 an unexpected error.

### Step 2: read the findings JSON

Read `docs/health/<ts>.json`. Each finding carries `evidence[]` (the proof), a plain-words
`description` (why it matters), a `suggestion` (remove / update / reuse / rotate / rewrite),
a `tier` (`deterministic` or `ai-judged`), and a stable `HL-` id. Never restate a finding
the verb did not produce, and never expose a secret's bytes: secret findings carry only a
file:line + rule + fingerprint.

### Step 3: triage

Sort the findings into the four-pile triage ledger (`.paqad/findings/triage.json`): confirmed,
unclear-spec, false-alarm, taste. Deterministic findings are proof-backed; `ai-judged`
candidates (stale-doc, ai-slop) are yours to grade: accept, downgrade, or dismiss with a
one-line reason. Deletion and rewrites are always a human decision; when the user wants to
act, route irreversible removals through the Decision Pause Contract.

### Step 4: narrate the report

Speak in the paqad voice. Lead with the honest split the report already draws: **Proven**
findings (mechanically proven) and **Needs judgment** findings (candidates you graded).
Give the user the verdict in the contract words (Safe to merge / Needs your attention /
Inconclusive), the top remediation priorities, and the blocked checks with their install
hints. Do not inflate confidence: a blocked check is a gap, not a pass.

### Retest mode

Use this mode for the `health-retest` workflow.

Re-run a prior codebase-health report and check off what got fixed. The retest never
invents findings and never lowers severity: it re-runs the same deterministic evidence and
reclassifies each source finding by its stable `HL-` id.

Run this workflow whenever the user says anything equivalent to:

- "health retest", "re-run the health check", "did my health findings get fixed?"

For a fresh audit, use the `codebase-health` workflow instead.

#### Inputs

- The source report sidecar. By default the newest `docs/health/*.json`; the user may name a
  specific one.

#### Step 1: run the verb

Run `paqad-ai health retest` (optionally `--sidecar <path>` to pick a specific source report,
`--offline` to skip network checks). It reads the source sidecar, re-runs the evidence, and
reclassifies each finding.

#### Step 2: read the retest JSON

Each source finding is now `fixed`, `still-open`, or `needs-manual-verification`, matched by
its `HL-` id. A network-required finding that could not be re-checked offline is
`needs-manual-verification`, not silently fixed.

#### Step 3: narrate the result

Report, in the paqad voice: how many are fixed, how many are still open, and how many need a
manual check. The verdict is Safe to merge only when nothing is still open. The retest report
is written to `docs/health/<orig-ts>-retest-<ts>.{md,json}`.

Retest mode rules:

- Never invent a new finding in a retest, and never lower a finding's severity.
- Match by stable `HL-` id, not by category.
- A network-required finding you could not re-check is `needs-manual-verification`, never `fixed`.

## Output Contract

- A health run writes `docs/health/<ts>.md` and the `docs/health/<ts>.json` sidecar, with stable `HL-` finding ids, and the per-run finding index under `.paqad/health/runs/<run_id>/`.
- A retest writes `docs/health/<orig-ts>-retest-<ts>.{md,json}` and keeps the source `HL-` ids.

## Escalate / Stop Conditions

- Never skip the verb. The findings come from `paqad-ai health run`, never from your own reading.
- If a scanner is unavailable, it is already recorded in `blocked_checks`: surface it, do not work around it.
- Secret evidence never contains the secret bytes. Only file:line + rule + fingerprint.
- Deletion, dependency removal, and rewrites are suggestions. Acting on them is the user's call.
- Always keep both the `.md` report and the `.json` sidecar; `health-retest` depends on the sidecar to preserve `HL-` ids.

## Resources

- Helper skill: `finding-normalizer`.
- `references/health-verbs.md`: read it when you need to see which verb a mode runs.
- `agents/openai.yaml`
