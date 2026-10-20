import type { FixChange } from '@/core/types/fix-protocol.js';
import type { VerificationEvidenceGate } from '@/core/types/verification-evidence.js';
import type { VerificationGate } from '@/core/types/verification.js';
import { readFeatureRecord } from '@/feature-evidence/feature-record.js';
import { changeAffectsBehaviour, readChangeDiff } from '@/fix-protocol/fix-change.js';
import {
  FIX_PROOF_STATE_LABEL,
  foldFixProofState,
  readFixProofRows,
  type FixProofState,
} from '@/fix-protocol/fix-proof-record.js';

export const FIX_PROOF_GATE = 'fix-proof' as VerificationGate;

export interface FixProofGateInput {
  projectRoot: string;
  dirName: string | null;
  isFeatureDev: boolean;
}

export interface FixProofGateDeps {
  readDiff?: (projectRoot: string) => FixChange | null;
}

export interface FixProofSummary {
  required: boolean;
  state: FixProofState;
  reason: string;
}

const MISSING_STEP: Record<Exclude<FixProofState, 'red-green'>, string> = {
  none: 'Run `paqad-ai fix prove red` before the fix, then `paqad-ai fix prove green` after it.',
  red: 'Run `paqad-ai fix prove green` now that the fix is in.',
  'green-only':
    'Show the test failing first: undo the fix, run `paqad-ai fix prove red`, restore it, then `paqad-ai fix prove green`.',
  'not-reproduced':
    'Write a test that fails on the old code, run `paqad-ai fix prove red`, then `paqad-ai fix prove green` after the fix.',
  held: 'Fix the check the change broke, then run `paqad-ai fix prove green` again.',
};

export function summarizeFixProof(
  input: FixProofGateInput,
  deps: FixProofGateDeps = {},
): FixProofSummary | null {
  if (!input.isFeatureDev || !input.dirName) return null;
  if (readFeatureRecord(input.projectRoot, input.dirName)?.kind !== 'fix') return null;
  const state = foldFixProofState(readFixProofRows(input.projectRoot, input.dirName));
  const diff = (deps.readDiff ?? readChangeDiff)(input.projectRoot);
  if (diff === null) {
    return { required: true, state, reason: 'The change could not be read, so proof is needed.' };
  }
  const verdict = changeAffectsBehaviour(diff);
  return { required: verdict.affects, state, reason: verdict.reason };
}

export interface FixProofEvaluation {
  gate: VerificationEvidenceGate | null;
  summary: FixProofSummary | null;
}

export function evaluateFixProof(
  input: FixProofGateInput,
  deps: FixProofGateDeps = {},
): FixProofEvaluation {
  const summary = summarizeFixProof(input, deps);
  return { gate: fixProofGate(input, summary), summary };
}

export function fixProofGate(
  input: FixProofGateInput,
  summary: FixProofSummary | null,
): VerificationEvidenceGate | null {
  if (!input.isFeatureDev || !input.dirName) return null;
  if (summary === null || !summary.required) {
    return {
      name: FIX_PROOF_GATE,
      status: 'skipped',
      detail:
        summary === null
          ? 'This change is not a fix, so no fix proof is needed.'
          : `This fix cannot change behaviour, so no proof is needed. ${summary.reason}`,
      remediation: null,
      failures: [],
      skip_kind: 'not-required',
    };
  }
  if (summary.state === 'red-green') {
    return {
      name: FIX_PROOF_GATE,
      status: 'pass',
      detail: `Fix proof: ${FIX_PROOF_STATE_LABEL['red-green']}.`,
      remediation: null,
      failures: [],
    };
  }
  return {
    name: FIX_PROOF_GATE,
    status: 'inconclusive',
    detail: `Fix proof did not run to the end: ${FIX_PROOF_STATE_LABEL[summary.state]}.`,
    remediation: MISSING_STEP[summary.state],
    failures: [],
    skip_kind: 'did-not-run',
  };
}
