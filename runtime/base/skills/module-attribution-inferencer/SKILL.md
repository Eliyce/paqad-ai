---
name: module-attribution-inferencer
description: Form a hypothesis about which existing module a user prompt belongs to when the deterministic extractor returns nothing. Reads existing module-map.yml features and source paths, scores token overlap, returns a ranked multi-choice draft, and surfaces it via the Decision Pause Contract. Second half of the Attribution Gate. TS-canonical (`src/module-decisions/inferencer.ts`).
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
4. If `confident` is true, apply the top choice with no packet (see Confidence Handling). Otherwise create a single Decision Pause packet (one packet for the inferencer, not one-per-choice) with its change set, and leave it for the spec question round.

## Decision Pause Packet Shape

- **Question** — `Which module does this prompt belong to?`
- **Header** — `Module attribution`.
- **Options** — one per `choices` entry. Each option label:
  - `extend-existing` → `Extend "<name>" (<slug>)` with the `reasoning` shown as description.
  - `new-module-fallback` → `Introduce a new module` (description: collect a name from the user, then hand off back to `module-attribution-extractor`).
  - `no-attribution` → `Skip attribution for this prompt` (description: continue planning with no module-map mutation; record nothing).

Only an explicit `Extend` selection promotes a draft to `proposed → accepted`; the apply path mutates `module-map.yml` via `src/module-decisions/apply.ts`. `new-module-fallback` loops back through the extractor with the user-supplied name. `no-attribution` records no MD-XXXX file.

## Output Contract

- When `confident` is true: auto-apply the top choice with no packet. Apply it through `src/module-decisions/apply.ts` and record it in the plan's `reuse.consulted` as auto-applied, with its score (for example `{ "source": "module-doc", "query": "module attribution: auto-applied extend <slug> (score 0.62)", "target": "docs/instructions/rules/module-map.yml", "hits": 1 }`). The spec question round shows it to the owner as a choice already made that they can change; it is not a blocking question.
- When `confident` is false: zero or one MD-XXXX YAML file written under `.paqad/decisions/module-decisions/<id>.yml` (only when the owner picks `Extend "<name>"` or accepts the new-module fallback), and exactly one Decision Pause packet, created with its change set. Planning does not stop for it: it continues with `no-attribution` as a provisional label, and the packet is asked in the spec question round.
- The selected option drives the state transition; only an explicit `Extend` answer promotes a draft to `accepted`.
- `no-attribution` records nothing and returns control to planning.
- A project whose policy sets `attribution_pending: stop` keeps the old behaviour: the packet is asked during planning and planning waits for it.

## Confidence Handling

- `confident: true` (at least one existing-module choice scored 0.5 or more) → auto-apply the top choice, raise no packet, and record it as auto-applied with its score in `reuse.consulted`. A wrong choice made this way can be found later from the plan and changed by the owner in the spec question round.
- `confident: false` → raise the packet (change set), lead the question with `No existing module clearly matches — pick one of:` so the owner knows the inferencer is uncertain, and carry on planning with `no-attribution` as a provisional label. The packet waits for the spec question round; planning never stops for it.

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
