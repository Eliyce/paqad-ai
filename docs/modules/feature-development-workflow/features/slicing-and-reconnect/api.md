# Build in Small Pieces & Reconnect: API

> **Slug:** `slicing-and-reconnect`

No CLI verb of its own. What is in the code today is the reconnect check in `src/planning/reconnect-check.ts` and the `combine_reason` field on a slice. The slice-granularity rule, the slice executor and the dependency queue that the technical view describes are no longer in `src/planning/`.

## `computeReconnect`

```ts
export interface ReconnectInput {
  spec: FeatureSpec;
  slices: ExecutionSlice[];
  snapshot: PlanVsActualSnapshot;
  lane: PlanningLane;
}

export function computeReconnect(input: ReconnectInput): ReconnectReport;
export function renderReconnectReport(report: ReconnectReport): string;
```

```ts
export interface ReconnectReport {
  coherent: boolean;
  anchored: boolean;
  review: 'structural' | 'agent-re-read';
  frozen_criteria_total: number;
  uncovered_criteria: string[];
  unproven_criteria: string[];
  unwired_seams: ReconnectSeam[];
  contradictions: ReconnectContradiction[];
}

export interface ReconnectSeam {
  slice_id: string;
  depends_on: string;
  kind: 'dangling' | 'upstream-unproven';
  detail: string;
}

export interface ReconnectContradiction {
  kind: 'double-owned' | 'off-spec';
  criterion_id: string;
  slice_ids: string[];
  detail: string;
}
```

`review` is `agent-re-read` on the full lane and `structural` on the others. `renderReconnectReport` turns the report into the markdown shown to the developer.

## `ExecutionSlice.combine_reason`

`combine_reason?: string` on `ExecutionSlice` (`src/core/types/planning.ts`) records why one slice covers more than one acceptance criterion.
