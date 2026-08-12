# Site-Map Workflow

## Purpose

Build and maintain a verified map of the application: its surfaces (pages, screens, modals,
API endpoints, CLI commands, jobs), how they connect (transitions), what gates them (guards),
and the areas they live in. The map is a single AI-authored YML at `docs/site-map/` — the one
site-map location (`app-map.yaml`, `journeys/*.journey.yaml`, `answers.yaml`). You author it;
the deterministic engine proves it: every element is checked against real code, earns an honest
trust tier, and the map's freshness against the code is stamped into the map itself. Humans do
not read the YML — they read the dashboard's Site map area, which renders the stored map
statically with no model call at view time.

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
word. The deterministic `paqad-ai sitemap run` verb (the same engine behind Run on the
dashboard's Site map area) extracts the surfaces it can prove, resolves every cited
`file:line`, reconciles the extraction against the stored map, runs the graph invariants, and
stamps each element's earned trust tier plus the map-vs-code freshness back into
`docs/site-map/app-map.yaml`. There are no timestamped report dumps: `docs/site-map/` holds
only the current map, and the run's findings live in its evidence bundle under
`.paqad/site-map/runs/` and in what you narrate.

| Source                                                    | Role                                           |
| --------------------------------------------------------- | ---------------------------------------------- |
| `docs/site-map/app-map.yaml` + `journeys/*.journey.yaml`  | **the map of record** you author and curate    |
| `paqad-ai sitemap run` findings + stamped trust/freshness | **the proof** — machine-generated, zero tokens |
| The code-knowledge index, route/command scan, module map  | **primary evidence** the verb cites            |
| The dashboard's Site map area (static render of the map)  | **the deliverable** humans read                |

## One creation action

Creating the map is a single action for the person: they ask once ("create a site map"), and
readiness, authoring, the questions, and verification all run as internal stages of that one
action. The only moment you interrupt them is the one batched set of questions in Step 2. Do not
turn the internal stages into a string of prompts, and do not ask them to pick a document type
when the request already means the site map.

## Workflow Steps

The run is baseline-ratcheted: the first run records `.paqad/site-map/baseline.json`, and
later runs mark each finding `new-since-baseline` vs `pre-existing`.

### Step 1 — readiness

Map creation is gated on the documentation family: when the documentation foundation is absent,
or modules exist and none is documented, stop and name exactly which of `create documentation`
or `create module documentation` is missing. If the app shape is one no extractor covers, the
engine records a `blocked_checks` entry with the reason — surface it, do not fabricate surfaces
to fill the gap.

### Step 2 — author the map and settle the open questions

Write the map YML at `docs/site-map/` directly. For each surface supply the layer code alone
does not carry: a semantic slug, a title, the surface kind, entry/exit marks, and the module it
belongs to. Add transitions and guards, evidenced only: a transition records where it goes,
what triggers it, and the `file:line` that proves navigation actually occurs; a guard records
what it protects and how it is satisfied (`satisfy_via`). Every element carries a `file:line`
evidence pointer — a claim with no evidence is not allowed in the map.

A few decisions the code cannot settle are the person's to make: how to group surfaces into
districts, who the actors are and which guards they satisfy, which proposed journeys matter, and
which human label to show for a keyed string. Ask them in one batch, not one at a time:

1. Run `paqad-ai sitemap questions`. It reads the map you just authored plus the persisted
   answers and prints only the questions the map still needs, each drawn from a fixed list
   (grouping, actors and roles, journey priority, labels and language, app kind, and whether an
   unguarded surface is meant to be public). Never invent a question outside that list. A
   fully-authored map prints nothing, so you ask nothing.
2. Put the `to_ask` questions to the person in a single batched prompt (on Claude Code,
   `AskUserQuestion`). Show each question's plain reason and its `file:line` evidence, offer the
   recommended default, and let them defer. A choice they make is `human`; a default they accept
   or a question they defer is `default`.
3. Record the outcome with `paqad-ai sitemap answer --input <file>`, where the file is a JSON
   array of `{ question_id, answer, decided_by }`. It writes the decisions to
   `docs/site-map/answers.yaml` and stamps each one's provenance onto the surfaces it settled, so
   a human choice reads as confirmed and a default reads as a low-confidence guess.

The answers persist, so a later re-creation or a documentation sync does not re-ask a settled
question. A human answer whose code is unchanged is reused as is; a question whose evidence moved
is reopened and asked again, so a settled decision is never applied to code it no longer
describes.

### Step 3 — verify (run the verb)

Run `paqad-ai sitemap run`. It extracts the provable surfaces (real `file:line` evidence,
deduped and fingerprinted), reconciles them against the stored map (`SM-ADD` for an extracted
surface no map entry covers), runs the Tier-A checks (evidence resolution, cross-reference
integrity, graph invariants, trust honesty), and stamps the earned trust tiers and the
map-vs-code freshness into the stored map. Its exit code is the verdict: 0 clean, 1 findings,
2 an unexpected error.

### Step 4 — grade and close the gaps

Findings are `SM-*` (the id is a content-addressed `SM-<hash8>`; the category — `SM-ADD |
SM-REMOVE | SM-EDGE-STALE | SM-GUARD-DRIFT | SM-ORPHAN | SM-DEADEND | SM-TRUST | …` — is a
field). Fix what the engine proved, and grade only the claims it marked inconclusive: an
inconclusive claim is a question, not a finding, until you ground it. Then re-run the verb so
the map's stamped proof reflects the fixes.

### Step 5 — journeys

Journeys are `proposed`-only: propose capped, well-formed journeys — one actor, one goal,
ordered evidenced steps, dual ends — but a journey becomes `confirmed` only when a human signs
off through the audited surface (`paqad-ai sitemap journey confirm|reject`, or the dashboard's
journey curation). Do not confirm a journey here.

### Step 6 — narrate the receipt

Speak the verdict in the contract words (Safe to merge / Needs your attention / Inconclusive),
the top gaps, and any blocked checks, in the paqad voice.

## Rules

- Never skip the verb. The extraction, integrity checks, and the stamped trust and freshness
  come from `paqad-ai sitemap run`, never from your own reading of the code.
- Ground every surface, transition, and guard in a resolving `file:line`. A claim whose
  evidence does not resolve is a finding, not a fact.
- Do not flag a transition because a link exists — only when evidence shows navigation actually
  occurs. Do not name a surface the extractor never saw.
- The role that draws the map does not confirm it: modeling is yours, but journeys are
  confirmed by humans through the audited surface, never self-approved.
- The creation questions come from a fixed list, and a defaulted answer is recorded as a
  default, never as a human decision. Never ask outside the list, and never mark a deferred or
  defaulted choice as confirmed.
- `docs/site-map/` holds only the current map. Never write timestamped reports, generated
  views, or any second copy of the map there or anywhere else.
