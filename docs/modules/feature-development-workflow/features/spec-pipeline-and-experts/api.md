# Spec Pipeline & Experts (API)

> **Slug:** `spec-pipeline-and-experts`

The pipeline has no HTTP surface. Its API is a set of CLI verbs under `paqad-ai spec`, a few config keys, and two exported TypeScript names in `src/core/framework-config.ts`. Every verb is model-free: the agent runs the skills, and the verbs only validate, record and advance.

## CLI: `paqad-ai spec pipeline`

Every verb takes `--project-root <path>` (default: the current directory) and `--session <id>` (default: `SE_SESSION`, then `CLAUDE_SESSION_ID`).

| Verb | What it does |
|---|---|
| `start --request-file <path>` or `start --ticket <ref>` | Grounds and labels the request in one go. `--ticket` fetches a GitHub issue through `gh`. `--modules <list>` scopes grounding to named module slugs. |
| `status` | Shows the next step and the enforcement config in effect. |
| `ground [--modules <list>]` | Assembles grounding from the docs. |
| `label <prompt>` | Rates how clear the request is against the grounding. |
| `record <step> <file>` | Hands an agent-made artifact back for `questions`, `task` or `craft`. For `craft`, `--trace <path>` points at the trace that ties every spec line to a source. |
| `finish` | Decides freeze or non-blocking review and records where the spec came from. |
| `redo <step>` | Clears a step and everything after it so the run works them out again. |
| `metrics [--all]` | Reports what the run cost and changed. `--all` adds up every feature bundle. |

### `paqad-ai spec pipeline experts`

| Verb | What it does |
|---|---|
| `record <file>` | Stores the expert need the detector produced as the `experts.json` roster. |
| `brief <role>` | Prints one expert's brief, rebuilt from the run. Refuses if it no longer matches the roster's `brief_hash`. |
| `context` | Prints, as JSON, what the need detector and the chief architect read. |
| `notes <file>` | Stores the experts' findings and token actuals in `experts.json`. |
| `synthesis <file>` | Stores the chief architect's synthesis. Each conflict becomes one decision packet. |

## CLI: `paqad-ai spec freeze <spec-file>`

| Flag | Meaning |
|---|---|
| `--from-pipeline` | Freeze a spec the pipeline crafted, merging the staged run into `specification.json`. |
| `--manual` | Freeze a hand-written spec under strict adoption. Needs `--reason`. |
| `--reason <why>` | Why the spec was frozen without the pipeline. Recorded as `pipeline.manual_reason`. |
| `--signed-off-by <name>` | Who signs off the freeze. Default `unattributed`. |
| `--confirm-invariants` | Confirm every invariant as part of the sign-off. |
| `--spec-id <id>` | Spec id for the sidecar. Defaults to the file name without extension. |
| `--session <id>` | Session whose active feature receives `specification.json`. |
| `--keep-input` | Keep the input markdown instead of deleting it. |
| `--project-root <path>` | Project root. |

How a freeze is decided:

- Pipeline off: the spec freezes as before, with no `pipeline` section.
- Fast lane: the spec freezes without the pipeline and records `pipeline: { produced: false, skipped: "fast-lane" }`. If the lane is later raised, the completeness gate asks for a re-freeze through the pipeline.
- Graduated or full lane, adoption `strict`: a spec the pipeline did not make is refused unless `--manual --reason "<why>"` is given. `--manual` without `--reason` is refused too.
- Graduated or full lane, adoption `warn`: a hand-written spec freezes and records `pipeline.produced=false`.

## Config keys

Each key can be set in the usual layers. The first one found wins: the `PAQAD_*` env variable, then `.paqad/.config`, then `.paqad/configs/.config.*`. An unset key, or a value paqad does not recognise, falls back to the default.

| Key | Env | Default | Meaning |
|---|---|---|---|
| `spec_pipeline_enabled` | `PAQAD_SPEC_PIPELINE_ENABLED` | `true` | Master switch. |
| `spec_pipeline_experts_enabled` | `PAQAD_SPEC_PIPELINE_EXPERTS_ENABLED` | `true` | Runs the expert roster. Needs the master switch on. |
| `spec_pipeline_adoption` | `PAQAD_SPEC_PIPELINE_ADOPTION` | `strict` | `warn` or `strict`. How firmly the freeze asks for a pipeline spec. |
| `spec_pipeline_clarification` | `PAQAD_SPEC_PIPELINE_CLARIFICATION` | `warn` | `off`, `warn` or `strict` for the question round. |
| `spec_pipeline_final_review` | `PAQAD_SPEC_PIPELINE_FINAL_REVIEW` | `off` | `off`, `warn` or `strict` for the review before freeze. |
| `spec_pipeline_token_ceiling` | `PAQAD_SPEC_PIPELINE_TOKEN_CEILING` | `40000` | Per-run token budget. Going over is a recorded warning, never a block. |
| `spec_pipeline_standing_experts` | | the four standing roles | Comma-separated role ids. Empty means none. |

The first three defaults were turned on later: the pipeline, the experts and strict adoption are now on. They apply on the graduated and full lanes only. The fast lane never runs the pipeline, whatever these keys say.

### Switching it off

Set any of these in `.paqad/configs/.config.*` (whole team) or `.paqad/.config` (just you):

```ini
spec_pipeline_enabled=false          # no pipeline: specs are written by hand, as before
spec_pipeline_experts_enabled=false  # keep the pipeline, skip the experts
spec_pipeline_adoption=warn          # keep the pipeline, but let a hand-written spec freeze
```

`paqad-ai update` never writes a default into a config file, so an unset key keeps following the code default.

## `paqad-ai doctor`

The `Spec pipeline settings` check is always a pass. It is information, not a problem. It shows each of the three switches, its value and where the value came from (`default`, the env variable's name, or the config file). With nothing set, it reads like this:

```
spec pipeline on (default), experts on (default), adoption strict (default). It runs on the graduated and full lanes; the fast lane never runs it. The 4 standing experts carry about 24k tokens of budget per spec (ceiling 40k). To switch off: spec_pipeline_enabled=false, spec_pipeline_experts_enabled=false or spec_pipeline_adoption=warn in .paqad/configs/.config.* or .paqad/.config.
```

With the pipeline off it says so instead: specs are written by hand and no experts run. Separate doctor warnings flag a mix that cannot work, such as experts on with the pipeline off.

## TypeScript

From `src/core/framework-config.ts`:

```ts
export const SPEC_PIPELINE_DEFAULTS: Readonly<{
  spec_pipeline_enabled: boolean; // true
  spec_pipeline_experts_enabled: boolean; // true
  spec_pipeline_adoption: SpecPipelineAdoptionMode; // 'strict'
}>;

export interface SpecPipelineSwitches {
  enabled: boolean;
  experts_enabled: boolean;
  adoption: SpecPipelineAdoptionMode; // 'warn' | 'strict'
}

export function resolveSpecPipelineSwitches(map: ReadonlyMap<string, string>): SpecPipelineSwitches;
```

`SPEC_PIPELINE_DEFAULTS` is the one place the three defaults live. `resolveSpecPipelineSwitches` reads them from a layered config map. `readPipelineConfig` (`src/spec-pipeline/config.ts`) and `readSpecPipelineFlags` (`src/verification/repository/bundle-completeness-config.ts`) both call it, so they never disagree. The prompt-gate hook in `runtime/hooks/lib/agent-entry-directive.mjs` cannot import TypeScript, so it keeps a copy of the values. A unit test fails if that copy drifts.
