// The six mandatory feature-development stage agents (issue #567).
//
// Under stage isolation each mandatory stage runs in its own host subagent. This module is
// the single source of truth for which stages get an agent, the agent's name, its per-stage
// tool scope, and the cold-brief body every host renders. The names are `paqad-<stage>`
// (hyphenated), so the `^paqad-` SubagentStop matcher fires only for these agents; the body
// tells the agent to record under the LEDGER stage name (underscored, from STAGE_ORDER).
//
// ticket_intake and delivery are excluded: intake is orchestrator-side routing and delivery
// is the human-gated PR step — neither is a "think and type in isolation" stage.

import { STAGE_ORDER } from '@/pipeline/feature-development-policy.js';

/** One stage agent's identity and tool scope. */
export interface StageAgentDef {
  /** The host agent name, `paqad-<stage>` with hyphens (matched by `^paqad-`). */
  agentName: string;
  /** The canonical ledger stage name (underscored, a member of STAGE_ORDER). */
  ledgerStage: string;
  /** Claude `tools` frontmatter — the tools this stage is allowed. */
  claudeTools: string;
  /** A one-line role, used in the agent description. */
  role: string;
}

/** Read-only stages get discovery tools plus Bash (to run the paqad-ai stage verbs). */
const READ_ONLY_TOOLS = 'Read, Grep, Glob, Bash';
/** The development stage edits source. */
const DEVELOPMENT_TOOLS = 'Read, Edit, Write, NotebookEdit, Grep, Glob, Bash';
/** Documentation sync edits docs. */
const DOC_SYNC_TOOLS = 'Read, Edit, Write, Grep, Glob, Bash';

const STAGE_META: Record<string, { tools: string; role: string }> = {
  planning: { tools: READ_ONLY_TOOLS, role: 'plan the change and record the reuse-checked plan' },
  specification: {
    tools: READ_ONLY_TOOLS,
    role: 'write and freeze the feature spec before any code',
  },
  development: { tools: DEVELOPMENT_TOOLS, role: 'implement the frozen spec' },
  review: { tools: READ_ONLY_TOOLS, role: 'review the change and record the review' },
  checks: { tools: READ_ONLY_TOOLS, role: 'run the project checks and record the result' },
  documentation_sync: {
    tools: DOC_SYNC_TOOLS,
    role: 'sync the canonical docs the change affects',
  },
};

/** The ledger stages that get an isolated agent, in STAGE_ORDER order. */
export const STAGE_AGENT_STAGES: readonly string[] = STAGE_ORDER.filter(
  (stage) => stage in STAGE_META,
);

/** Turn a ledger stage name (`documentation_sync`) into an agent name (`paqad-documentation-sync`). */
export function agentNameForStage(ledgerStage: string): string {
  return `paqad-${ledgerStage.replace(/_/g, '-')}`;
}

/** The six stage-agent definitions, derived from STAGE_ORDER so they cannot drift from it. */
export const MANDATORY_STAGE_AGENTS: readonly StageAgentDef[] = STAGE_AGENT_STAGES.map(
  (ledgerStage) => ({
    agentName: agentNameForStage(ledgerStage),
    ledgerStage,
    claudeTools: STAGE_META[ledgerStage]!.tools,
    role: STAGE_META[ledgerStage]!.role,
  }),
);

/**
 * The cold-brief body every stage agent carries, identical across hosts (issue #567). It is
 * the whole contract a fresh subagent needs: load the framework, learn which stage and change
 * it is running, read the stage's own instructions, run the stage CLI verbs under the
 * orchestrator's session id, and return one short message — never ask the human, never edit a
 * bundle by hand, never skip a verb.
 */
export function buildStageAgentBody(def: StageAgentDef): string {
  return [
    `You are the paqad **${def.ledgerStage}** stage agent. You run one stage of one`,
    `feature-development change in your own isolated context and then return. Your job: ${def.role}.`,
    '',
    '## Load the framework first',
    '',
    '1. Resolve `.paqad/framework-path.txt` to the paqad install directory.',
    '2. Load `AGENT-BOOTSTRAP.md` then `AGENT-ROUTER.md` from there and follow them, then write',
    '   the `.paqad/.agent-entry-loaded` sentinel. You are a feature-development stage, so load',
    '   the rules too (`paqad-ai rules load`).',
    '3. You run in your own subagent context, so the entry gate tracks your load separately from',
    '   the orchestrator. If it blocks your first edit, it names a per-agent marker under',
    '   `.paqad/session/agent-entry/` — create exactly that file (or write `.paqad/.agent-entry-loaded`',
    '   with the Write tool) and retry. This is the gate confirming YOU loaded the framework.',
    '',
    '## What you were dispatched with',
    '',
    'The orchestrator passes you the change ref, the lane, the previous stage pillar file(s), and',
    "`SE_SESSION` — the orchestrator's session id. **Export `SE_SESSION` for every command you run**",
    'so every row and artifact you write is recorded under the one change identity.',
    '',
    '## Run your stage',
    '',
    `1. Read the \`${def.ledgerStage}\` stage's \`read:\` list and \`instructions\` from`,
    '   `docs/instructions/workflows/feature-development.yaml`, plus the previous pillar file(s).',
    `2. \`npx paqad-ai stage start ${def.ledgerStage}\` (with \`SE_SESSION\` exported).`,
    '3. Do the stage work, then write its rigid artifact with the stage verb',
    '   (`plan compile` / `spec freeze` / `rules load` / `review record` / `checks run`), or make the',
    '   edits for a mutation stage.',
    `4. \`npx paqad-ai stage end ${def.ledgerStage} --artifact <the-rigid-file>\` (mutation stages need no artifact).`,
    '',
    '## Hard rules',
    '',
    '- **Never ask the human.** If you hit a decision pause, create the packet with',
    '  `npx paqad-ai decision create …` and return immediately with `paused: D-<id>` — the',
    '  orchestrator asks the human and re-dispatches you.',
    '- **Never write into a feature bundle directory by hand.** Only the stage verbs write there.',
    '- **Never skip a CLI verb** because "the orchestrator will do it" — it will not.',
    '- Return exactly: your `status` (`completed` or `paused: D-<id>`), the pillar file path, and at',
    '  most five lines of summary. Nothing else.',
  ].join('\n');
}
