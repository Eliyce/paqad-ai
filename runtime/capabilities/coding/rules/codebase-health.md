# Codebase-Health Workflow

## Purpose

Audit the project for code and packages that no longer earn their place: dead code,
unused packages, outdated or risky packages, leaked secrets, stale docs, and copy-paste
AI slop. A sibling of pentest and design-test — same tier, routed and rule-driven, no
stage-gating. Detection is deterministic and costs zero model tokens; you orchestrate,
triage, and narrate.

## Trigger

Run this workflow whenever the user says anything equivalent to:

- "check my project's health", "codebase health", "code health", "health check", "health audit"
- "audit my codebase", "find dead code", "check for unused code/packages", "cleanup audit"

Do **not** improvise a health audit. Always follow the steps below in order. For a retest
of an existing report, use the `health-retest` workflow instead. Note: a security review
is **pentest**, not this workflow.

## Source-of-Truth Model

There is one source of truth: the deterministic `paqad-ai health run` verb. It does all
detection and writes the findings JSON. You never re-derive or invent a finding — you run
the verb, read its output, triage it, and write the prose the report needs.

| Source | Role |
| --- | --- |
| `paqad-ai health run` output (`docs/health/<ts>.json`) | **the findings** — proof is machine-generated |
| The code-knowledge index, dependency inventory, tool output | **primary evidence** the verb cites |
| The human report `docs/health/<ts>.md` | **the deliverable** you narrate |

## Workflow Steps

Progress and outputs live under `.paqad/health/runs/<run_id>/` and `docs/health/`. The run
is resumable and baseline-ratcheted: the first run records `.paqad/health/baseline.json`,
and later runs mark each finding `new-since-baseline` vs `pre-existing`.

### Step 1 — run the verb

Run `paqad-ai health run` (add `--offline` if the user asked to skip network checks). It:

- reuses the code-knowledge index for dead code + unused dependencies (run `paqad-ai index
  build` first if it reports `blocked_checks: index-not-built`),
- shells out to `osv-scanner`, `gitleaks`, `jscpd` when they are on PATH and degrades to a
  labelled fallback or a `blocked_checks` entry (with an install hint) when they are not,
- writes `docs/health/<ts>.md` + `docs/health/<ts>.json` and the per-run finding index.

The verb's exit code is the verdict: 0 clean, 1 findings, 2 an unexpected error.

### Step 2 — read the findings JSON

Read `docs/health/<ts>.json`. Each finding carries `evidence[]` (the proof), a plain-words
`description` (why it matters), a `suggestion` (remove / update / reuse / rotate / rewrite),
a `tier` (`deterministic` or `ai-judged`), and a stable `HL-` id. Never restate a finding
the verb did not produce, and never expose a secret's bytes — secret findings carry only a
file:line + rule + fingerprint.

### Step 3 — triage

Sort the findings into the four-pile triage ledger (`.paqad/findings/triage.json`): confirmed,
unclear-spec, false-alarm, taste. Deterministic findings are proof-backed; `ai-judged`
candidates (stale-doc, ai-slop) are yours to grade — accept, downgrade, or dismiss with a
one-line reason. Deletion and rewrites are always a human decision; when the user wants to
act, route irreversible removals through the Decision Pause Contract.

### Step 4 — narrate the report

Speak in the paqad voice. Lead with the honest split the report already draws: **Proven**
findings (mechanically proven) and **Needs judgment** findings (candidates you graded).
Give the user the verdict in the contract words (Safe to merge / Needs your attention /
Inconclusive), the top remediation priorities, and the blocked checks with their install
hints. Do not inflate confidence: a blocked check is a gap, not a pass.

## Rules

- Never skip the verb. The findings come from `paqad-ai health run`, never from your own reading.
- If a scanner is unavailable, it is already recorded in `blocked_checks` — surface it, do not work around it.
- Secret evidence never contains the secret bytes. Only file:line + rule + fingerprint.
- Deletion, dependency removal, and rewrites are suggestions. Acting on them is the user's call.
- Always keep both the `.md` report and the `.json` sidecar; `health-retest` depends on the sidecar to preserve `HL-` ids.
