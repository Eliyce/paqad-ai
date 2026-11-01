import {
  createPendingDecision,
  readContractDecisions,
  type ContractDecisionOption,
} from '@/decisions/authoring.js';

export type AuthoringCategory =
  | 'authoring.overlap'
  | 'authoring.risky_script'
  | 'authoring.agent_permission'
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

export const OVERRIDE_ADD_UNVERIFIED = 'add-unverified';
export const OVERRIDE_DO_NOT_ADD = 'do-not-add';

export function raiseOverrideDecision(
  projectRoot: string,
  input: {
    skill: string;
    gate: string;
    why: string;
    change?: string | null;
    kind?: 'skill' | 'agent';
  },
): string {
  const kind = input.kind ?? 'skill';
  return raiseAuthoringDecision(projectRoot, {
    category: 'authoring.override',
    title: `The ${kind} ${input.skill} cannot run its ${input.gate} check. Add it unverified, kept in this project?`,
    context: input.why,
    options: [
      option(
        OVERRIDE_ADD_UNVERIFIED,
        'Add it unverified, kept in this project',
        `If you pick this, ${input.skill} is added with the label unverified and cannot leave this project.`,
        `You give up: proof that ${input.skill} helps.`,
      ),
      option(
        OVERRIDE_DO_NOT_ADD,
        'Do not add it',
        `If you pick this, ${input.skill} is not added.`,
        `You give up: the ${kind}.`,
      ),
    ],
    recommendation: OVERRIDE_DO_NOT_ADD,
    change: input.change,
  });
}

export const AGENT_PERMISSION_ALLOW = 'allow';
export const AGENT_PERMISSION_REMOVE = 'remove';

export function agentPermissionContext(powers: readonly string[], fileHash: string): string {
  return `Powers: ${[...powers].sort().join(', ')}. File hash: ${fileHash}.`;
}

export function raiseAgentPermissionDecision(
  projectRoot: string,
  input: { agent: string; powers: readonly string[]; fileHash: string; change?: string | null },
): string {
  const powers = [...new Set(input.powers)].sort();
  const list = powers.join(', ');
  return raiseAuthoringDecision(projectRoot, {
    category: 'authoring.agent_permission',
    title: `The agent ${input.agent} asks for these powers: ${list}. Allow these powers?`,
    context: agentPermissionContext(powers, input.fileHash),
    options: [
      option(
        AGENT_PERMISSION_ALLOW,
        'Allow these powers',
        `If you pick this, ${input.agent} keeps ${list}; adding a power or editing the agent asks again.`,
        'You give up: an agent limited to the minimum tools.',
      ),
      option(
        AGENT_PERMISSION_REMOVE,
        'Remove them',
        `If you pick this, ${list} is taken out of ${input.agent} before its checks run.`,
        'You give up: whatever those powers let the agent do.',
      ),
    ],
    recommendation: AGENT_PERMISSION_REMOVE,
    change: input.change,
  });
}
