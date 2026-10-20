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

## Why the code works the way it does

- **Pure core, thin edges.** `assemble.ts`, `detectors.ts` and the parsers in `gather.ts` do no
  I/O, so every branch is tested with fixtures. `gatherer.ts` does the real subprocess and file
  work and is left out of unit coverage, like the pentest engine; `run.ts` is tested with a fake
  gatherer. Every parser returns an empty list on bad input, so a broken tool reads as "found
  nothing" instead of crashing the run.
- **Secrets are never stored.** A secret is recorded as file, line, rule and a SHA-256
  fingerprint. gitleaks' own fingerprint is preferred; otherwise the match is hashed at once. The
  hash is a one-way marker, not a security primitive, and the built-in scanner is the
  lower-confidence fallback when gitleaks is missing.
- **Stable ids.** `HL-` ids hash a finding's identity fields (never `id`, `status` or
  `baseline_status`), so the same problem gets the same id on every run, which retest needs. A
  collision gets a `-NN` suffix, like the pentest scheme. Retest matches by that id, never lowers a
  severity, and marks a network-only finding it could not recheck offline as needing manual
  verification.
- **Baseline.** With no baseline every finding stays `unknown`; the run then writes the baseline,
  so the ratchet starts from the next run. A missing or corrupt baseline reads as none.
- **Tools.** Every scanner is optional and only invoked when on PATH; none is bundled. Which tools
  are present is decided from `missingBinaries` without spawning anything.
- **Stale docs.** A doc is a candidate when it references at least one source and its last commit
  is older than the last change of every source it references.

## Source Footprint

- `src/cli/commands/health.ts` — the `health run` / `health retest` verbs.
- `src/codebase-health/` — detectors (pure), gather/parsers, tool availability, baseline,
  report builder, assembly, retest, and the run orchestrators.
- `src/core/types/codebase-health.ts` — the finding / report / baseline types.
- Reuses: `src/code-knowledge` (dead code, unused deps), `src/introspection`
  (dependency inventory), `src/pentest/osv` (vuln matching), `src/rule-scripts/execute`
  (PATH gate).

## Why the code-knowledge index works the way it does

The reasons below are not obvious from the code in `src/code-knowledge/`. The index is built once
and read two ways: dead-code findings read it backwards, reuse answers read it forwards.

- **Extraction (`symbol-extractor.ts`, `types.ts`).** A regex pass with no type resolution:
  TypeScript and JavaScript get name, kind, line and signature; PHP and Dart only name and line,
  which is the honest limit of a regex. Every symbol records `extraction_tier: 'regex'` so a later
  parser upgrade can raise confidence without changing the shape. The schema version is bumped when
  the stored shape changes, and the store rejects a file with another version.
- **Edges (`import-edges.ts`).** File edges reuse the existing `scanImports`, so there is one
  resolver. A reference edge is an imported name the target file exports, matched by name only, so a
  name exported by two imported modules can be attributed to the wrong one; that is acceptable for a
  coarse reuse signal. Default and namespace imports are skipped (no named symbol), type-only imports
  count.
- **Reachability (`reachability.ts`, `entry-points.ts`).** Callers from test files are not counted,
  so a symbol used only by its own test reads as unused in production. A file with no callers is an
  orphan only when it is not an entry point (bins, CLI commands, runtime hooks, tests, package
  `main`/`bin`/`exports`), and the entry glob list is stored in the index header so a reader can see
  why a file was spared.
- **Dependency usage (`dependency-usage.ts`).** Only node dependencies are judged, because only
  TS/JS imports are scanned; claiming `imported: false` for another ecosystem would be dishonest, so
  those are left out.
- **Module attribution (`module-slugs.ts`, `module-map-evidence.ts`).** The module map has no
  "which module owns this file" lookup, so one is built from declared sources (both the `sources`
  shape and the generator's `source_paths` shape), and the longest matching path wins. Writing
  `evidence.symbols` uses the YAML document API so comments, order, other evidence and the flow-array
  style survive and the diff is only the additions.
- **Refresh (`refresh.ts`).** Only changed files are re-parsed and spliced in; a branch or head
  change forces a full rebuild, and with no index yet it does nothing (the first build stays
  explicit). Two known limits, which the full rebuild fixes: dependency usage is carried over, and an
  edge from an unchanged file into a changed one keeps its old resolution, so a renamed export is
  reconciled only on the next full build.
- **Storage (`store.ts`, `schema.ts`).** The JSON schema is packaged with the framework so a project
  cannot weaken it, and `index build` validates before writing. Writes are atomic; a missing,
  corrupt or schema-invalid file reads as absent, never as a half-built index. Files throughout the
  module are read directly with the error caught, never checked for existence first, which avoids a
  check-then-read race.
- **`reuse-catalog.ts`.** The catalog is generated by `index build` and must not be edited by hand;
  table cells replace `|` and newlines so a signature cannot break the table.

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
