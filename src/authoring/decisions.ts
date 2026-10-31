import {
  createPendingDecision,
  readContractDecisions,
  type ContractDecisionOption,
} from '@/decisions/authoring.js';

export type AuthoringCategory =
  | 'authoring.overlap'
  | 'authoring.risky_script'
  | 'authoring.intake_gap'
  | 'authoring.improvement'
  | 'authoring.retirement'
  | 'authoring.override';

export interface AuthoringDecisionInput {
  category: AuthoringCategory;
  title: string;
  context: string;
  options: ContractDecisionOption[];
  recommendation: string;
  change?: string | null;
}

export function raiseAuthoringDecision(projectRoot: string, input: AuthoringDecisionInput): string {
  return createPendingDecision(projectRoot, {
    category: input.category,
    title: input.title,
    context: input.context,
    options: input.options,
    recommendation: input.recommendation,
    change: input.change ?? null,
  }).id;
}

export interface AuthoringDecisionRecord {
  id: string;
  category: string;
  status: 'pending' | 'resolved';
  chosen: string | null;
  resolvedBy: string | null;
  rationale: string | null;
  resolvedAt: string | null;
}

export function readAuthoringDecision(
  projectRoot: string,
  id: string,
): AuthoringDecisionRecord | null {
  const stored = readContractDecisions(projectRoot).filter((row) => row.packet.id === id);
  const row = stored.find((entry) => entry.status === 'resolved') ?? stored[0];
  if (!row) return null;
  const packet = row.packet as unknown as Record<string, unknown>;
  const response = packet.human_response as Record<string, unknown> | undefined;
  const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
  return {
    id,
    category: row.packet.category,
    status: row.status,
    chosen: row.status === 'resolved' ? text(packet.chosen) : null,
    resolvedBy: text(response?.responded_by) ?? text(packet.resolved_by),
    rationale: text(packet.rationale),
    resolvedAt: text(packet.resolved_at),
  };
}

export function option(
  key: string,
  label: string,
  preview: string,
  tradeOff: string,
): ContractDecisionOption {
  return { option_key: key, label, one_line_preview: preview, trade_off: tradeOff };
}
