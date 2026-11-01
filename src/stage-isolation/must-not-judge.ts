import {
  MANDATORY_STAGE_AGENTS,
  isHighTableAgent,
  stageForAgentName,
  stripPluginAgentNamespace,
} from './stage-agents.js';

export const MUST_NOT_VIOLATIONS = ['asked_human', 'bundle_write', 'out_of_stage_edit'] as const;
export type MustNotViolation = (typeof MUST_NOT_VIOLATIONS)[number];

export interface TranscriptToolUse {
  name: string;
  input: Record<string, unknown>;
}

const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
const ASK_TOOLS: ReadonlySet<string> = new Set(['AskUserQuestion']);
const BUNDLE_PATH = /(?:^|[\\/])\.paqad[\\/]ledger[\\/]feature-evidence[\\/][^\\/]+[\\/]/u;

function toolUsesIn(content: unknown): TranscriptToolUse[] {
  if (!Array.isArray(content)) return [];
  const uses: TranscriptToolUse[] = [];
  for (const block of content as unknown[]) {
    if (!block || typeof block !== 'object') continue;
    const entry = block as { type?: unknown; name?: unknown; input?: unknown };
    if (entry.type !== 'tool_use' || typeof entry.name !== 'string') continue;
    const input =
      entry.input && typeof entry.input === 'object'
        ? (entry.input as Record<string, unknown>)
        : {};
    uses.push({ name: entry.name, input });
  }
  return uses;
}

export function transcriptToolUses(raw: string): TranscriptToolUse[] {
  const uses: TranscriptToolUse[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let record: { message?: { role?: unknown; content?: unknown }; type?: unknown };
    try {
      record = JSON.parse(trimmed) as typeof record;
    } catch {
      continue;
    }
    const role = record.message?.role ?? record.type;
    if (role !== 'assistant') continue;
    uses.push(...toolUsesIn(record.message?.content));
  }
  return uses;
}

function editPath(use: TranscriptToolUse): string | null {
  const path = use.input.file_path ?? use.input.notebook_path ?? use.input.path;
  return typeof path === 'string' && path.trim() !== '' ? path : null;
}

function stageEdits(stage: string): boolean {
  const def = MANDATORY_STAGE_AGENTS.find((candidate) => candidate.ledgerStage === stage);
  return def !== undefined && /\bEdit\b/u.test(def.claudeTools);
}

export function judgeMustNot(
  stage: string,
  uses: readonly TranscriptToolUse[],
): MustNotViolation[] {
  const found = new Set<MustNotViolation>();
  const edits = stageEdits(stage);
  for (const use of uses) {
    if (ASK_TOOLS.has(use.name)) {
      found.add('asked_human');
      continue;
    }
    if (!EDIT_TOOLS.has(use.name)) continue;
    const path = editPath(use);
    if (path !== null && BUNDLE_PATH.test(path)) {
      found.add('bundle_write');
    } else if (!edits) {
      found.add('out_of_stage_edit');
    }
  }
  return MUST_NOT_VIOLATIONS.filter((violation) => found.has(violation));
}

export function unresolvedStageAgent(agentType: unknown): string | null {
  if (typeof agentType !== 'string') return null;
  const name = stripPluginAgentNamespace(agentType.trim());
  if (!name.startsWith('paqad-')) return null;
  if (isHighTableAgent(name) || stageForAgentName(name) !== null) return null;
  return name;
}

export function formatUnresolvedStageSummary(agentName: string): string {
  return (
    `**▸ paqad** · edit blocked: no active stage for \`${agentName}\`\n` +
    `> 🔴 Needs your attention — \`${agentName}\` is a paqad agent, but no paqad stage matches ` +
    `it, so the stage this edit belongs to cannot be resolved and the edit is denied. Dispatch ` +
    `the stage to its own agent (\`paqad-<stage>\`, for example \`paqad-development\`).`
  );
}
