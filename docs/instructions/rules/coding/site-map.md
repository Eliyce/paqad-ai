# Site-Map Workflow

## Purpose

Build and maintain a verified map of the application: its surfaces (pages, screens, modals,
API endpoints, CLI commands, jobs), how they connect (transitions), what gates them (guards),
and the areas they live in. The map is a single YML at `docs/site-map/` — the one site-map
location (`app-map.yaml`, `journeys/*.journey.yaml`, `answers.yaml`). The engine drafts the
skeleton from proven code, you add the meaning the code does not carry, and the deterministic
engine proves it: every element is checked against real code, earns an honest trust tier, and
the map's freshness against the code is stamped into the map itself. Humans do not read the YML
— they read the dashboard's Site map area, which renders the stored map statically with no model
call at view time.

## Trigger

Run this workflow whenever the user says anything equivalent to:

- "create a site map", "create sitemap", "generate the site map", "map the app"
- "update the site map", "draw a journey map"

Do **not** improvise a site map. Always follow the steps below in order. Re-checking an
existing map against the current code is the `site-map-retest` workflow — the same
verification run again, not a different engine. This is a `coding`-capability workflow behind
the `site_map` flag (env `PAQAD_SITE_MAP`); when the flag is off, nothing here loads or runs.

## Source-of-Truth Model

The stored map is the single source of truth, and trust comes from proof, not from the model's
word. The engine does the mechanical work and cites its evidence: `paqad-ai sitemap draft` writes
the surface skeleton straight from the extraction (one entry per proven surface, real `file:line`
evidence, resolved navigation links), and `paqad-ai sitemap run` (the same engine behind Run on
the dashboard's Site map area) resolves every cited `file:line`, reconciles the extraction and the
code-proven links against the stored map, runs the graph invariants, and stamps each element's
earned trust tier plus the map-vs-code freshness back into `docs/site-map/app-map.yaml`. You add
the layer the code does not carry — titles, semantic slugs, module intent, actors, journeys.
There are no timestamped report dumps: `docs/site-map/` holds only the current map, and the run's
findings live in its evidence bundle under `.paqad/site-map/runs/` and in what you narrate.

| Source                                                    | Role                                              |
| --------------------------------------------------------- | ------------------------------------------------- |
| `docs/site-map/app-map.yaml` + `journeys/*.journey.yaml`  | **the map of record**: engine-drafted, you curate |
| `paqad-ai sitemap draft` skeleton + resolved links        | **the proof-backed draft** — machine-written      |
| `paqad-ai sitemap run` findings + stamped trust/freshness | **the proof** — machine-generated, zero tokens    |
| The code-knowledge index, route/command scan, module map  | **primary evidence** the engine cites             |
| The dashboard's Site map area (static render of the map)  | **the deliverable** humans read                   |

## One creation action

Creating the map is a single action for the person: they ask once ("create a site map"), and
readiness, drafting, the questions, and verification all run as internal stages of that one
action. The only moment you interrupt them is the one batched set of questions in Step 1. Do not
turn the internal stages into a string of prompts, and do not ask them to pick a document type
when the request already means the site map.

## Workflow Steps

The run is baseline-ratcheted: the first run records `.paqad/site-map/baseline.json`, and
later runs mark each finding `new-since-baseline` vs `pre-existing`.

### Step 0 — check where the last run left off (always first)

Before anything else, run `paqad-ai sitemap status`. It reads the progress file the draft writes
and reports how many units are done, how many remain, and which unit is next. **A run never
starts from zero when progress exists.** If a previous session finished part of the map, this step
tells you exactly what is already done so you resume instead of re-doing it; your first narrated
line then says what you are skipping and why, for example `Skipping 7 journeys finished on
Monday.` `status` performs no writes, so it is always safe to run, even while another run is in
flight. With no progress file it simply says a run would start from the beginning.

### Step 1 — preflight, then settle every open question in one interruption

Run `paqad-ai preflight site-map`. It checks everything the run needs before any mapping work —
the documentation foundation and module docs, the CLI program, and (only on a Laravel project)
whether `php artisan route:list` can be obtained — and returns the questions the run cannot answer
itself. Put **every** returned question to the person in a **single** `AskUserQuestion` call, never
one at a time. Show each question's plain reason and its evidence, offer the recommended default,
and let them defer. Record the outcome with `paqad-ai sitemap answer --input <file>`, where the
file is a JSON array of `{ question_id, answer, decided_by }`: a choice they make is `human`, a
default they accept or a question they defer is `default`.

The answers persist, so a later re-creation or a documentation sync does not re-ask a settled
question. A human answer whose code is unchanged is reused as is; a question whose evidence moved
is reopened and asked again, so a settled decision is never applied to code it no longer
describes. If preflight reports the documentation family is missing, stop and name exactly which
of `create documentation` or `create module documentation` is needed; if the app shape is one no
extractor covers, surface the engine's `blocked_checks` reason rather than fabricating surfaces to
fill the gap.

### Step 2 — say how big the job is

Run `paqad-ai sitemap inventory`. It reports how many screens, groups, and guards the code has,
without changing anything. Say the size out loud, for example `Found 214 screens across 12
groups.`, so the person knows the scale before any write.

### Step 3 — draft the skeleton, then add the meaning

Run `paqad-ai sitemap draft`. The engine writes the map skeleton straight from what it already
extracted: one surface entry per proven surface (`id`, `kind`, `label`, the real `file:line`
evidence, `entry`, and `module` when the extractor revealed one), the areas from the module map,
and the navigation links the code proves, resolved to their target surfaces. `draft` is additive
and resumable — it merges into an existing map without clobbering anything you authored, never
deletes a surface a bad scan stopped seeing, and skips units a previous session already finished.

Then add the layer the code does not carry: a semantic slug and a human title for each surface,
the module intent, the actors and which guards they satisfy, and a human label for a keyed string.
Ground every addition in evidence — a guard records what it protects and how it is satisfied
(`satisfy_via`) with a resolving `file:line`; a claim with no evidence is not allowed in the map.
`sitemap draft` writes the skeleton from proven extraction, you add the meaning, and
`sitemap run` proves it — the verb does not author the whole map, and you do not hand-type the
surfaces the engine can already prove.

### Step 4 — propose the journeys, one at a time

Journeys are `proposed`-only: propose capped, well-formed journeys — one actor, one goal, ordered
evidenced steps, dual ends — and narrate each one as it lands, one short line per journey. A
journey becomes `confirmed` only when a human signs off through the audited surface (`paqad-ai
sitemap journey confirm|reject`, or the dashboard's journey curation). Do not confirm a journey
here: the role that draws the map does not confirm it.

### Step 5 — verify (run the verb)

Run `paqad-ai sitemap run`. It extracts the provable surfaces (real `file:line` evidence, deduped
and fingerprinted), reconciles them and the code-proven links against the stored map (`SM-ADD` for
an extracted surface no map entry covers, `SM-EDGE-MISSING` for a transition the code proves but
the map does not record), runs the Tier-A checks (evidence resolution, cross-reference integrity,
graph invariants, trust honesty), and stamps the earned trust tiers and the map-vs-code freshness
into the stored map. Its exit code is the verdict: 0 clean, 1 findings, 2 an unexpected error.

Findings are `SM-*` (the id is a content-addressed `SM-<hash8>`; the category — `SM-ADD |
SM-REMOVE | SM-EDGE-MISSING | SM-EDGE-STALE | SM-GUARD-DRIFT | SM-ORPHAN | SM-DEADEND | SM-TRUST |
…` — is a field). Fix what the engine proved, and grade only the claims it marked inconclusive: an
inconclusive claim is a question, not a finding, until you ground it. Then re-run the verb so the
map's stamped proof reflects the fixes.

### Step 6 — narrate the receipt

Speak the verdict in the contract words (Safe to merge / Needs your attention / Inconclusive),
the top gaps, and any blocked checks, in the paqad voice.

## Narration

Narrate in your own visible assistant text, and carry the step lines and the end-of-change
receipt into the **final message of the turn**: one heading plus one short line per journey. A
hook `systemMessage` is not a channel the developer reliably sees — on Desktop it leaks into the
chat as `Stop says:` prose — so never rely on a hook to speak for you. On a resumed run, the first
narrated line says what is being skipped and why (Step 0), so the person can see the run picked up
where the last one stopped instead of starting over.

## Rules

- Step 0 is always first: `paqad-ai sitemap status`, so a run resumes instead of restarting when
  progress exists. Never start from zero when the progress file says otherwise.
- Never skip the verb. The extraction, integrity checks, and the stamped trust and freshness
  come from `paqad-ai sitemap run`, never from your own reading of the code.
- `sitemap draft` writes the skeleton from proven extraction and the resolved links; you add the
  meaning; `sitemap run` proves it. Do not hand-type surfaces the engine can prove, and never
  claim the verb authors the whole map.
- Ground every surface, transition, and guard in a resolving `file:line`. A claim whose
  evidence does not resolve is a finding, not a fact.
- Do not flag a transition because a link exists — only when evidence shows navigation actually
  occurs. Do not name a surface the extractor never saw.
- The role that draws the map does not confirm it: modeling is yours, but journeys are
  confirmed by humans through the audited surface, never self-approved.
- Put every preflight question to the person in one batched prompt, never one at a time. The
  questions come from a fixed list, and a defaulted answer is recorded as a default, never as a
  human decision. Never ask outside the list, and never mark a deferred or defaulted choice as
  confirmed.
- `docs/site-map/` holds only the current map. Never write timestamped reports, generated
  views, or any second copy of the map there or anywhere else.
