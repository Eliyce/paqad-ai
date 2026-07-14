# Codebase-Health Workflow

> **Layer:** `cli-commands` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `codebase-health`

## Purpose

Give every onboarded project a health check-up on demand — routed workflow #10, at
the same tier as pentest and design-test. The user says "check my project's health"
and paqad scans for six kinds of junk: dead code, unused packages, outdated or risky
packages, leaked secrets, stale docs, and copy-paste AI slop. Every finding carries
**proof** (real tool output, never an AI opinion), a plain-words reason it matters, and
a suggested action (remove, update, reuse, rotate, or rewrite). Running it again
("health retest") checks off what got fixed and shows what is still open.

## The one source of truth

There is exactly one place detection happens: the deterministic `paqad-ai health run`
verb. It costs **zero model tokens** — all detection is scripts and index reads. The
workflow rule markdown tells the AI only to run the verb, read its JSON, triage the
findings, and write the prose the report needs. The AI never re-derives or invents a
finding. This deliberately avoids the pentest split-brain (a TS engine that has drifted
from the rule the live session actually follows).

## Commands

```
paqad-ai health run    [--offline] [--project-root <path>] [--quiet]
paqad-ai health retest [--sidecar <path>] [--offline] [--project-root <path>] [--quiet]
```

| Flag | Meaning |
| --- | --- |
| `--offline` | Skip checks that need the network (deprecation, EOL) and say so in the report. |
| `--sidecar` | (retest) A specific source report sidecar; defaults to the newest `docs/health/*.json`. |
| `--quiet` | Suppress the trailing machine-readable summary line. |

Exit codes follow the audit convention: **0** clean · **1** findings (or still-open on
retest) · **2** an unexpected error.

## Finding categories and honesty tiers

| Category | Tier | Detection |
| --- | --- | --- |
| `unused-dependency` | deterministic | code-knowledge index (`imported:false`), corroborated by knip when present. |
| `dead-code` | deterministic | code-knowledge index: orphan files + exported symbols with `caller_count:0`. |
| `vulnerable-dependency` | deterministic | osv-scanner (offline db) → else native `npm audit` → else the OSV batch API (online). |
| `deprecated-dependency` | deterministic (online) | registry / EOL metadata; skipped with a note when offline. |
| `secret-leak` | deterministic | gitleaks (git history) → else a built-in working-tree regex scan (lower-confidence). **Evidence is redacted: file:line + rule + fingerprint, never the bytes.** |
| `duplication` | deterministic | jscpd when present. |
| `stale-doc` | **ai-judged** | git-timestamp drift candidates; the model grades relevance. Never blocks. |
| `ai-slop` | **ai-judged** | duplication clusters + one-caller wrapper symbols; the model reviews candidates. |

The report visibly separates **Proven** findings from **Needs judgment** findings. That
honesty split is the product.

## Baseline ratchet

The first run writes `.paqad/health/baseline.json` (the finding ids). Later runs mark
each finding `new-since-baseline` or `pre-existing`, so a legacy project is not drowned
and a team can require "no new findings" without fixing history first.

## Outputs

- `docs/health/<ts>.md` — the human report (dual-written with the sidecar).
- `docs/health/<ts>.json` — the machine sidecar that `health retest` reads to preserve ids.
- `docs/health/<orig-ts>-retest-<ts>.{md,json}` — a retest report.
- `.paqad/health/runs/<run_id>/finding-index.json` — the per-run finding index.
- `.paqad/health/baseline.json` — the ratchet baseline.

## Source Footprint

- `src/cli/commands/health.ts` — the `health run` / `health retest` verbs.
- `src/codebase-health/` — detectors (pure), gather/parsers, tool availability, baseline,
  report builder, assembly, retest, and the run orchestrators.
- `src/core/types/codebase-health.ts` — the finding / report / baseline types.
- Reuses: `src/code-knowledge` (dead code, unused deps), `src/introspection`
  (dependency inventory), `src/pentest/osv` (vuln matching), `src/rule-scripts/execute`
  (PATH gate).

## Boundaries

This module **owns** deterministic detection and the report. It does **not** delete or
auto-fix anything (suggestions only — deletion stays a human decision), gate CI, or run
on a schedule. Scanners are framework-owned and invoked from Node (no bash), so there is
no project footprint and no Windows `.sh` parity to maintain.

## Authority

The single source of truth for this module's identity, slug, and source paths is
[`docs/instructions/rules/module-map.yml`](../../../instructions/rules/module-map.yml).
If anything here disagrees with the map, the **map wins**.

## Related

- Workflow rules: `runtime/capabilities/coding/rules/codebase-health.md` + `health-retest.md`.
- Code-knowledge index: issue #353 (`src/code-knowledge`).
- Pentest (the sibling audit workflow): `src/pentest`, `docs/modules/...`.
- Code-knowledge index (dead code + unused deps source): `src/code-knowledge`.
