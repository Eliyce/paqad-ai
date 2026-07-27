# Site-Map Workflow

## Purpose

Build and maintain a verified map of the application: its surfaces (pages, screens, modals,
API endpoints, CLI commands, jobs), how they connect (transitions), what gates them (guards),
and the areas they live in. A sibling of codebase-health and design-test — routed and
rule-driven, no stage-gating. The deterministic engine does extraction, cross-reference
integrity, and publication and costs zero model tokens; you supply the judgment the engine
cannot: naming and typing surfaces, tracing real navigation, inferring guards, and grading
the inconclusive claims the engine hands you.

## Trigger

Run this workflow whenever the user says anything equivalent to:

- "create a site map", "create sitemap", "generate the site map", "map the app" <!-- @rule RL-fb47 -->
- "update the site map", "draw a journey map" <!-- @rule RL-3923 -->

Do **not** improvise a site map. Always follow the steps below in order. For a re-run of an
existing map against the current code, use the `site-map-retest` workflow instead. This is a
`coding`-capability workflow behind the `site_map` flag (env `PAQAD_SITE_MAP`); when the flag
is off, nothing here loads or runs.

## Source-of-Truth Model

The deterministic `paqad-ai sitemap run` verb is the engine. It extracts surfaces from the
code, resolves every citation to a `file:line`, checks cross-reference integrity and the graph
invariants, and publishes the index, overview, and registries. You never invent a surface,
transition, or finding the engine did not ground — you run the verb, read what it grounded,
add the modeling judgment it asks for, and grade the claims it marks inconclusive.

| Source                                                        | Role                                              |
| ------------------------------------------------------------- | ------------------------------------------------- |
| `paqad-ai sitemap run` output (`docs/site-map/<ts>.json`)     | **the findings + extraction** — machine-generated |
| `docs/instructions/site-map/app-map.yaml` + `journeys/*.yaml` | **the map of record** you curate                  |
| The code-knowledge index, route/command scan, module map      | **primary evidence** the verb cites               |
| The published `index.md` + `overview.md` + registries         | **the deliverable** you narrate                   |

## Workflow Steps

Progress and outputs live under `.paqad/site-map/runs/<run_id>/` and `docs/site-map/`. The
run is resumable and baseline-ratcheted: the first run records `.paqad/site-map/baseline.json`,
and later runs mark each finding `new-since-baseline` vs `pre-existing`.

### Step 1 — readiness (`site-map-readiness` skill)

Confirm the app kind and frameworks are detectable and the extractor has a surface to read.
If the app shape is one no extractor covers, the engine records a `blocked_checks` entry with
the reason — surface it, do not fabricate surfaces to fill the gap.

### Step 2 — run the verb

Run `paqad-ai sitemap run`. It reuses the code-knowledge index, extracts the surfaces it can
prove (real `file:line` evidence, deduped and fingerprinted), reconciles them against the
committed `app-map.yaml` (`SM-ADD` for an extracted surface no map entry covers), runs the
Tier-A checks (evidence resolution, cross-reference integrity, graph invariants), and writes
`docs/site-map/<ts>.{md,json}` plus the per-run finding index. Its exit code is the verdict:
0 clean, 1 findings, 2 an unexpected error.

### Step 3 — model the surfaces (`surface-modeling` skill)

For each extracted surface the verb could not fully type, supply the non-inferable layer:
a semantic slug, a title, the surface kind, entry/exit marks, and the module it belongs to
(joined to the module map). Every surface you name must carry resolving evidence, and every
extracted entry must be accounted for — mapped, or excluded with a stated reason. This is the
one place the map gains meaning the code alone does not carry; keep it honest.

### Step 4 — trace flow (`transition-tracing` + `guard-inference` skills)

Add transitions and guards, evidenced only. A transition records where it goes, what triggers
it, and the `file:line` that proves navigation actually occurs. A guard records what it
protects and how it is satisfied (`satisfy_via`). Re-run the verb so its graph analysis —
reachability, dead ends, guard coverage — recomputes over your additions with zero tokens.

### Step 5 — assemble + verify (`site-map-assembly` + `map-verification` skills)

The verb compiles the layers into `app-map.yaml` and marks each claim it could not settle
deterministically as inconclusive. Refute or confirm those, and only those: an inconclusive
claim is a question, not a finding, until you ground it.

### Step 6 — gap analysis + publication (`site-map-gap-analysis` + `site-map-publication` skills)

Turn the invariants and verdicts into `SM-*` findings (the id is a content-addressed
`SM-<hash8>`; the category — `SM-ADD | SM-REMOVE | SM-EDGE-STALE | SM-GUARD-DRIFT | SM-ORPHAN |
SM-DEADEND | …` — is a field). The verb publishes the token-budgeted `index.md`, the
deterministic `overview.md` Mermaid, and the screen/API registries; you curate only the prose
the index and overview narrate. Then narrate the receipt in the paqad voice: the verdict in
the contract words (Safe to merge / Needs your attention / Inconclusive), the top gaps, and any
blocked checks.

Journeys are `proposed`-only: the `journey-synthesis` skill (with the `journey-designer` role)
proposes capped, well-formed journeys — one actor, one goal, ordered evidenced steps, dual ends —
but a journey becomes `confirmed` only when a human signs off through the audited surface. Do not
confirm a journey here.

## Rules

- Never skip the verb. The extraction, integrity checks, and published views come from <!-- @rule RL-9194 -->
  `paqad-ai sitemap run`, never from your own reading of the code.
- Ground every surface, transition, and guard in a resolving `file:line`. A claim whose <!-- @rule RL-3681 -->
  evidence does not resolve is a finding, not a fact.
- Do not flag a transition because a link exists — only when evidence shows navigation actually <!-- @rule RL-d4e9 -->
  occurs. Do not name a surface the extractor never saw.
- The role that draws the map does not confirm it: modeling is yours, but journeys are <!-- @rule RL-c14a -->
  confirmed by humans through the audited surface, never self-approved.
- Always keep both the `.md` report and the `.json` sidecar; `site-map-retest` depends on the <!-- @rule RL-cc21 -->
  sidecar to preserve `SM-` ids.
