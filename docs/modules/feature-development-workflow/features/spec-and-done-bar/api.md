# Feature Spec & "Done" Bar: API

> **Slug:** `spec-and-done-bar`

## CLI

```
paqad-ai spec freeze <spec-file> [--project-root <path>] [--signed-off-by <name>] [--spec-id <id>]
                     [--confirm-invariants] [--session <id>] [--keep-input]
                     [--from-pipeline] [--manual --reason <why>]
```

| Flag | Meaning |
| --- | --- |
| `--signed-off-by <name>` | Who signs off the freeze, default `unattributed` |
| `--spec-id <id>` | Spec id, default the spec file name without its extension |
| `--confirm-invariants` | Confirm every invariant as part of this sign-off |
| `--session <id>` | The session whose active feature gets `specification.json`, else `SE_SESSION`, else `CLAUDE_SESSION_ID` |
| `--keep-input` | Keep the spec markdown; by default it is deleted once the bundle has the frozen copy |
| `--from-pipeline` | Freeze the spec the spec pipeline crafted, merging its run into the record |
| `--manual --reason <why>` | Freeze a hand-written spec when the project requires the pipeline; the reason is recorded |

It exits 1 when the spec file is outside the project, inside a feature bundle, or unreadable; when the pipeline is required (`spec_pipeline_adoption=strict`) and neither `--from-pipeline` nor `--manual` was given; when `--from-pipeline` has no finished run, or the file is not the spec the pipeline crafted; and when the freeze has blockers, each printed with a red glyph. On success the frozen spec is written into the active feature bundle as `specification.json`.

## `src/spec/feature-spec-builder.ts`

```ts
export function buildFeatureSpec(options: {
  spec_id: string;
  spec_file: string;
  spec_markdown: string;
  suggested_invariants?: SuggestedInvariant[];
  spec_review?: SpecReviewReport | null;
  extracted_at?: string;
}): FeatureSpec;
```

`FeatureSpec` (`src/core/types/feature-spec.ts`) carries `schema_version`, `spec_id`, `spec_file`, `spec_hash`, `behaviour`, `acceptance_criteria`, `invariants`, `open_questions` and `frozen`, plus the optional `spec_review`, `non_goals`, `task`, `grounding`, `pipeline`, `trace` and `provenance`.

## `src/spec/spec-freeze.ts`

```ts
export function evaluateSpecFreeze(
  spec: FeatureSpec,
  specReview?: SpecReviewReport | null,
  options?: { requireVisualAc?: { files: string[] } },
): { can_freeze: boolean; blockers: string[] };
export function freezeSpec(spec: FeatureSpec, input: FreezeSpecInput): FeatureSpec;
export function isFrozenSpecStale(spec: FeatureSpec, currentSpecHash: string): boolean;
```

`requireVisualAc` is set when the plan or the change touches a frontend file, so the spec must carry a visual acceptance criterion.

## `src/spec/definition-of-done.ts`

```ts
export function isDone(input: {
  gates_passed: boolean;
  acceptance_criteria: { criterion_id: string; proof_passing: boolean }[];
  findings: { id: string; kind: string; confirmed: boolean }[];
}): {
  done: boolean;
  gates_passed: boolean;
  failing_criteria: string[];
  blocking_findings: string[];
};
export function renderDefinitionOfDone(input: DoneInput): string;
```

## Decision packets

```ts
export function buildSpecChangePacket(input: SpecDecisionInput): DecisionPacket;
export function buildSpecContradictionPacket(input: SpecDecisionInput): DecisionPacket;
export function runSpecChangeGuard(input: SpecChangeGuardInput): SpecChangeGuardOutcome;
```

The packets use the `spec.change` and `spec.contradiction` categories, and `requested_by` defaults to `spec-stage`.
