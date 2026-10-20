import { sha256Hex } from '@/compliance/markdown.js';
import {
  createPendingDecision,
  readContractDecisions,
  type ContractDecisionOption,
} from '@/decisions/authoring.js';
import { readFeatureRecord } from '@/feature-evidence/feature-record.js';
import { featureChangeKey } from '@/feature-evidence/paths.js';
import {
  DECISION_CATEGORY_DEFAULTS,
  type DecisionOption,
  type DecisionPacket,
} from '@/planning/decision-packet.js';
import { readExperts } from '@/spec-pipeline/run-store.js';

export interface FixProofMethodInput {
  decision_id: string;
  defect_id: string;
  kind: string;
  detail: string;
  task_session_id: string;
  created_at: string;
  requested_by?: string;
}

const DEFAULT_REQUESTED_BY = 'fix-protocol';
const CATEGORY = 'fix.proof_method' as const;
const QUESTION = 'How should we confirm this problem is fixed?';
const QA_ROLE = 'qa-engineer';
export const FAILING_TEST_OPTION_KEY = 'failing-test';

const MANUAL_METHOD_OPTIONS: readonly DecisionOption[] = [
  {
    option_key: 'human-verification-step',
    label: 'Use a manual check',
    one_line_preview: 'If you pick this, a person runs a set check to confirm the fix.',
    trade_off: 'You give up: a fully automated check.',
    evidence: {},
  },
  {
    option_key: 'recorded-baseline-snapshot',
    label: 'Keep an approved snapshot',
    one_line_preview:
      'If you pick this, we save an approved snapshot and compare later runs to it.',
    trade_off: 'You give up: free changes without re-approving the snapshot.',
    evidence: {},
  },
  {
    option_key: 'measured-threshold',
    label: 'Use a measured limit',
    one_line_preview: 'If you pick this, we check a measured value against a set limit.',
    trade_off: 'You give up: cases the chosen value does not catch.',
    evidence: {},
  },
];

export function buildFixProofMethodPacket(input: FixProofMethodInput): DecisionPacket {
  const ttlDays = DECISION_CATEGORY_DEFAULTS[CATEGORY].ttl_days;
  const ttlUntil = new Date(
    new Date(input.created_at).getTime() + ttlDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const fingerprint = `sha256:${sha256Hex(`${CATEGORY}:${input.kind}`)}`;

  return {
    decision_id: input.decision_id,
    fingerprint,
    category: CATEGORY,
    question: QUESTION,
    context: `Defect ${input.defect_id}. This kind of problem (${input.kind}) cannot be auto-checked. ${input.detail}`,
    options: MANUAL_METHOD_OPTIONS.map((option) => ({ ...option, evidence: {} })),
    confidence: 0.5,
    requested_by: input.requested_by ?? DEFAULT_REQUESTED_BY,
    task_session_id: input.task_session_id,
    linked_requirements: [],
    created_at: input.created_at,
    status: 'pending',
    ttl_until: ttlUntil,
    invalidation_watch: [],
  };
}

export function buildFixProofMethodOptions(
  qaFindings: readonly string[],
): ContractDecisionOption[] {
  return [
    {
      option_key: FAILING_TEST_OPTION_KEY,
      label: 'Write a test that fails before the fix',
      one_line_preview:
        'If you pick this, a test fails on the old code and passes after the fix, recorded with `paqad-ai fix prove`.',
      trade_off: 'You give up: nothing for code a test can reach; it needs a runnable test.',
      evidence: qaFindings.length > 0 ? { findings: [...qaFindings] } : {},
    },
    ...MANUAL_METHOD_OPTIONS.map((option) => ({
      option_key: option.option_key,
      label: option.label,
      one_line_preview: option.one_line_preview,
      trade_off: option.trade_off,
    })),
  ];
}

export function qaEngineerFindings(projectRoot: string, dirName: string): string[] {
  const findings = readExperts(projectRoot, dirName)?.findings ?? [];
  return findings
    .filter((finding) => finding.role === QA_ROLE)
    .map((finding) => `${finding.id}: ${finding.claim}`);
}

export interface RaiseFixProofMethodResult {
  id: string;
  raised: boolean;
}

export function raiseFixProofMethodDecision(
  projectRoot: string,
  dirName: string,
): RaiseFixProofMethodResult | null {
  if (readFeatureRecord(projectRoot, dirName)?.kind !== 'fix') return null;
  const change = featureChangeKey(dirName);
  const existing = readContractDecisions(projectRoot).find(
    ({ packet }) => packet.category === CATEGORY && packet.change === change,
  );
  if (existing) return { id: existing.packet.id, raised: false };
  const { id } = createPendingDecision(projectRoot, {
    category: CATEGORY,
    title: QUESTION,
    context:
      'This change is a fix that changes behaviour, so paqad wants proof the problem is gone. ' +
      'A test that fails before the fix and passes after it is the strongest proof; pick another ' +
      'method only when no test can reach the problem.',
    options: buildFixProofMethodOptions(qaEngineerFindings(projectRoot, dirName)),
    recommendation: FAILING_TEST_OPTION_KEY,
    origin: 'fix-proof',
    change,
  });
  return { id, raised: true };
}

export function fixProofMethodLine(id: string): string {
  return (
    `**▸ paqad** · This is a fix, so I need to know how to prove it. Answer ${id} ` +
    `(\`paqad-ai decision resolve ${id} failing-test\` is my pick), then I'll continue.`
  );
}
