---
name: module-attribution-inferencer
description: Form a hypothesis about which existing module a user prompt belongs to when the deterministic extractor returns nothing. Reads existing module-map.yml features and source paths, scores token overlap, returns a ranked multi-choice draft, and surfaces it via the Decision Pause Contract. Second half of the Attribution Gate (issue #80, Phase 1 §4.3.b). TS-canonical (`src/module-decisions/inferencer.ts`).
model_tier: fast
triggers:
  - workflow:
      - feature-development
      - module-attribution
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  prompt:
    type: string
    required: true
    description: The user prompt to analyse.
  project_root:
    type: path
    required: false
    description: Project root used to resolve module-map.yml. Defaults to cwd.
  max_choices:
    type: string
    required: false
    description: Cap on existing-module choices returned (default "3"). CLI passes as a string and parses internally.
---

## What It Does

Runs **only** when the `module-attribution-extractor` returned `extractor: no-decision-needed` with zero raw candidates. Tokenises the prompt, scores each existing module's name + feature names + source paths + evidence (symbols, routes, tables) against it, weights name/slug tokens 2× over path tokens, and emits a ranked multi-choice draft. Always includes two fallback choices (`new-module-fallback`, `no-attribution`) so the Decision Pause packet is complete even when nothing scores above the floor.

## Use This When

- The extractor produced zero candidates (no ticket headers, no `module:` markers, no `new module` phrasing).
- You need to ask the user "which module does this belong to?" before continuing planning.

Do **not** run this when the extractor already produced candidates — that path is owned by `module-attribution-extractor`.

## Inputs

- `prompt` — required. The user-supplied text.
- `project_root` — optional. Defaults to `cwd`. Used to load `module-map.yml`.
- `max_choices` — optional. Cap on existing-module choices returned (default `3`).
- Scoring details live in `runtime/base/skills/module-attribution-inferencer/references/scoring.md`.

## Procedure

1. Resolve the project root (default `cwd`).
2. Invoke the TS engine via the bundled wrapper:
   ```
   bash scripts/infer.sh <prompt-file> [project-root] [max-choices]
   ```
   The wrapper shells out to `paqad-ai module-decisions infer --project-root <root> --prompt-file <tmp> [--max-choices N]`.
3. Parse the emitted JSON. Fields: `choices[]` (sorted by `score` desc, with fallbacks last), `prompt_tokens`, `confident`.
4. Surface a single Decision Pause packet to the user (one packet for the inferencer, not one-per-choice).

## Decision Pause Packet Shape

- **Question** — `Which module does this prompt belong to?`
- **Header** — `Module attribution`.
- **Options** — one per `choices` entry. Each option label:
  - `extend-existing` → `Extend "<name>" (<slug>)` with the `reasoning` shown as description.
  - `new-module-fallback` → `Introduce a new module` (description: collect a name from the user, then hand off back to `module-attribution-extractor`).
  - `no-attribution` → `Skip attribution for this prompt` (description: continue planning with no module-map mutation; record nothing).

Only an explicit `Extend` selection promotes a draft to `proposed → accepted`; the apply path mutates `module-map.yml` via `src/module-decisions/apply.ts`. `new-module-fallback` loops back through the extractor with the user-supplied name. `no-attribution` records no MD-XXXX file.

## Output Contract

- Zero or one MD-XXXX YAML file written under `.paqad/decisions/module-decisions/<id>.yml` (only when the user picks `Extend "<name>"` or accepts the new-module fallback).
- Exactly one Decision Pause packet surfaced per inferencer invocation.
- The selected option drives the state transition; only an explicit `Extend` answer promotes a draft to `accepted` (spec AC #11).
- `no-attribution` records nothing and returns control to planning.

## Confidence Handling

- `confident: true` (at least one existing-module choice scored ≥ 0.2) → present the packet normally.
- `confident: false` → present the same packet but lead the question with `No existing module clearly matches — pick one of:` so the user knows the inferencer is uncertain. This avoids the agent silently picking a weak match (spec risk-mitigations table: "Attribution Gate gated by a new planning step that no-ops when the inferencer is confident").

## Escalate / Stop Conditions

- Stop and skip this skill entirely if the extractor returned candidates.
- Refuse to run if `module-map.yml` is missing — the inferencer needs the map to form hypotheses. Surface a one-line message: `Inferencer requires module-map.yml; run "create documentation" first.`
- Do **not** write `module-map.yml` from this skill. All map mutations go through `src/module-decisions/apply.ts`.

## Scripts

Deterministic plumbing — do **not** re-derive these in the LLM layer.

- `scripts/infer.sh <prompt-file> [project-root] [max-choices]` — invoke the inferencer; prints the JSON report.
- `scripts/is-confident.sh [report.json|-]` — exit 0 if `confident === true`, exit 1 otherwise. Use to decide whether to lead the packet question with the `No existing module clearly matches — pick one of:` prefix.
- `scripts/require-module-map.sh [project-root]` — stop-condition gate: exit 1 with the literal `Inferencer requires module-map.yml; run "create documentation" first.` if the map is missing.

## Assets

- `assets/templates/packet-inferencer.md` — Decision Pause packet template (single packet covering all choices).

## Resources

- `runtime/base/skills/module-attribution-inferencer/references/scoring.md` — bundled scoring reference.
- `runtime/base/skills/module-attribution-inferencer/agents/openai.yaml` — agent interface metadata.
- `src/module-decisions/inferencer.ts` — scoring + ranking.
- `src/module-decisions/schema.ts` — MD-XXXX state machine.
- `src/module-decisions/apply.ts` — atomic apply path.
- `runtime/base/skills/module-attribution-extractor/SKILL.md` — first half of the Attribution Gate.
- the Decision Pause Contract (in the framework bootstrap) — packet semantics.
