# Fix Protocol: API

> **Slug:** `fix-protocol`

No CLI verb of its own. The functions below are exported from `src/fix-protocol/index.ts`; the types live in `src/core/types/fix-protocol.ts`.

## `runFixProtocol`

```ts
export interface RunFixProtocolInput {
  project_root: string;
  defect_id: string;
  change: FixChange;
  proof: ProofCheck;
  baseline: GreenBaseline;
  failing_evidence: VerificationEvidenceFailure;
  linked_ac_id?: string | null;
  now: string;
  runProofOnUnfixedTree: (proof: ProofCheck) => Promise<ProofRunResult>;
  applyFix: () => Promise<void>;
  runProofOnFixedTree: (proof: ProofCheck) => Promise<ProofRunResult>;
  runFullSuiteAfterFix: () => Promise<TestIssueSnapshot[]>;
}

export function runFixProtocol(input: RunFixProtocolInput): Promise<FixProtocolResult>;

export interface FixProtocolResult {
  status:
    | 'skipped-no-behaviour-change'
    | 'rejected-proof-not-genuine'
    | 'rejected-proof-still-failing'
    | 'rejected-regression'
    | 'fixed';
  reason: string;
  affects_behaviour: AffectsBehaviourVerdict;
  proof_genuine?: ProofGenuinenessVerdict;
  regression?: RegressionVerdict;
  guard_path?: string;
}
```

The four effects are passed in, so the protocol works with any test tool. `guard_path` is set when the status is `fixed` and a regression guard was written.

## Steps you can call on their own

```ts
export function affectsBehaviour(change: FixChange): AffectsBehaviourVerdict;
export function assessProofGenuineness(
  proof: ProofCheck,
  unfixedRun: ProofRunResult,
): ProofGenuinenessVerdict;
export function proofPassesAfterFix(
  proof: ProofCheck,
  fixedRun: ProofRunResult,
): { passes: boolean; reason: string };
export function resolveGreenBaseline(input: {
  last_evidence: { overall_status: string; issues: TestIssueSnapshot[] } | null;
  tree_changed_since_evidence: boolean;
  rerun: () => TestIssueSnapshot[];
  now: string;
}): GreenBaseline;
export function detectRegression(
  baseline: TestIssueSnapshot[],
  afterFix: TestIssueSnapshot[],
): RegressionVerdict;
```

`resolveGreenBaseline` reuses the last evidence (`source: 'reused-evidence'`) only when it passed and the tree has not changed since; otherwise it reruns (`source: 'rerun'`).

## Regression guards

```ts
export function writeRegressionGuard(projectRoot: string, guard: RegressionGuard): Promise<string>;
export function readRegressionGuard(projectRoot: string, defectId: string): Promise<RegressionGuard | null>;
export function listRegressionGuards(projectRoot: string): Promise<RegressionGuard[]>;
```

A guard is stored as `.paqad/regression-guards/<defect id>.json`:

```ts
interface RegressionGuard {
  schema_version: '1.0.0';
  defect_id: string;
  created_at: string;
  proof: { test_id: string; test_file: string; command: string };
  failing_evidence: VerificationEvidenceFailure;
  linked_ac_id: string | null;
}
```

A defect id must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`, so it can never escape the folder.

## Decision packet

```ts
export function buildFixProofMethodPacket(input: {
  decision_id: string;
  defect_id: string;
  kind: string;
  detail: string;
  task_session_id: string;
  created_at: string;
  requested_by?: string;
}): DecisionPacket;
```

It builds a `fix.proof_method` packet, asked when no automated proof can be written for the defect. `requested_by` defaults to `fix-protocol`.
