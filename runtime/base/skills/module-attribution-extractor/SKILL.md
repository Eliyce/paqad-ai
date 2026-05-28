---
name: module-attribution-extractor
description: Run the deterministic module-attribution extractor over a user prompt and surface any MD-XXXX drafts via the Decision Pause Contract. This is the first half of the Attribution Gate spliced into feature-development.planning (issue #80). Pattern set is finite, framework-owned, and TS-canonical (`src/module-decisions/extractor.ts`); extending it is a framework PR.
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
    description: The user prompt to analyse (typically a pasted ticket or feature request).
  project_root:
    type: path
    required: false
    description: Project root used to resolve module-map.yml for collision detection. Defaults to cwd.
---

## What It Does

Applies the framework-owned pattern set (`Module:` / `Component:` / `Area:` / `Subsystem:` ticket headers; `module: <slug>`; `new module <Name>`; `in the <name> module`) to the prompt. Emits one candidate per distinct slug, classified as `exact-match`, `near-collision` (Levenshtein ≤ 2 against an existing slug), or `unknown`. Multiple modules in a single prompt produce one MD-XXXX draft each (spec AC #9).

## Use This When

- Running the Attribution Gate at the start of `feature-development.planning`.
- A user pastes a ticket and you need a deterministic first pass before invoking the inferencer.
- A user prompt explicitly names a module (`module: billing`, `Subsystem: Reporting`).

## Inputs

- `prompt` — required. The user-supplied text (typically a ticket body or feature request).
- `project_root` — optional. Used to resolve `module-map.yml` for collision detection. Defaults to `cwd`.
- The pattern set itself is closed and lives in `runtime/base/skills/module-attribution-extractor/references/pattern-set.md`.

## Procedure

1. Resolve the project root (default `cwd`).
2. Invoke the TS engine via CLI:
   ```
   paqad-ai module-decisions extract --project-root <root> --prompt-file <tmp>
   ```
   Prefer `--prompt-file` over `--prompt` so multiline ticket text survives the shell.
3. Parse the emitted JSON. Each entry in `candidates` has: `slug`, `display_name`, `kind`, `collision_with`, `pattern`, `excerpt`.
4. If `needs_decision` is empty, the extractor either found nothing or every hit was an `exact-match` — exit with the literal status `extractor: no-decision-needed` so the caller can fall through to the inferencer (the empty case) or continue planning (the exact-match case).
5. Otherwise, for each candidate in `needs_decision`, surface a Decision Pause packet via `AskUserQuestion` (or the active adapter's Decision Pause Contract entry point).

## Decision Pause Packet Shape

For each candidate that needs a decision, the packet must include:

- **Question** — the user-visible question. For `unknown`: `Confirm new module "<display_name>" (slug: <slug>)?`. For `near-collision`: `"<slug>" is suspiciously close to existing module "<collision_with>" — confirm which one this is.`
- **Header** — short tag, e.g. `New module`, `Slug collision`.
- **Options** (2–4):
  - **Accept new module `<slug>`** — proceed to atomic apply via `src/module-decisions/apply.ts`.
  - For near-collision: **Use existing `<collision_with>`** — resolve to the existing slug; mark the draft `superseded`.
  - **Rename** — collect a new slug from the user; loop back through `extract`.
  - **Reject** — mark the draft `rejected`; no module-map mutation.

The packet's selected option drives the state transition. Only an explicit `Accept` response promotes the MD-XXXX from `draft` → `proposed` → `accepted` (spec AC #11). No silent acceptance.

## Output Contract

- Zero or more MD-XXXX YAML files written under `.paqad/decisions/module-decisions/<id>.yml` (one per candidate that needs a decision).
- A `Workflow Status` block listing what was extracted and what is awaiting the user.
- On accepted decisions only: `apply.ts` performs the snapshot → temp-write → rename → record update → events append. **Do not write `module-map.yml` from this skill directly.**
- When the extractor returns no candidates, emit the literal status `extractor: no-decision-needed` so the caller can fall through to `module-attribution-inferencer`.

## Escalate / Stop Conditions

- Stop and surface the packet if `kind === 'near-collision'` — never auto-resolve to either side.
- Stop if the same slug appears in two different patterns with conflicting display names — ask which name to use.
- Refuse to write any MD-XXXX file if the project has no `.paqad/` directory (project is not onboarded).

## Resources

- `runtime/base/skills/module-attribution-extractor/references/pattern-set.md` — bundled pattern reference.
- `runtime/base/skills/module-attribution-extractor/agents/openai.yaml` — agent interface metadata.
- `src/module-decisions/extractor.ts` — pattern set + classification.
- `src/module-decisions/schema.ts` — MD-XXXX state machine.
- `src/module-decisions/apply.ts` — atomic apply path (only writer of `module-map.yml`).
- `.paqad/decision-pause-contract.md` — packet semantics.
