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
 * The extra `paqad:` namespace a Claude Code *plugin* agent carries before its name
 * (`paqad:paqad-development`, issue #616, Part 3).
 */
export const PLUGIN_AGENT_NAMESPACE = 'paqad:';

/** An agent type without the plugin's `paqad:` namespace, so plugin and npm agents read alike. */
export function stripPluginAgentNamespace(agentType: string): string {
  return agentType.startsWith(PLUGIN_AGENT_NAMESPACE)
    ? agentType.slice(PLUGIN_AGENT_NAMESPACE.length)
    : agentType;
}

const STAGE_BY_AGENT_NAME: ReadonlyMap<string, string> = new Map(
  MANDATORY_STAGE_AGENTS.map((def) => [def.agentName, def.ledgerStage]),
);

/**
 * The ledger stage a `paqad-<stage>` agent name runs, or null for any other name (issue #639,
 * Part 13). Only the six stage agents are stages: a High Table seat (`paqad-expert`,
 * `paqad-chief-architect`) or any other `paqad-` name is not, so it can never add a
 * `stage-agent` row or count as an isolated stage.
 */
export function stageForAgentName(agentName: string): string | null {
  return STAGE_BY_AGENT_NAME.get(agentName.trim()) ?? null;
}

// ── The High Table seats (issue #639, Part 13) ─────────────────────────────────────────

/** The host agent that sits one expert seat at the High Table. Its role comes in the prompt. */
export const EXPERT_AGENT_NAME = 'paqad-expert';
/** The host agent that chairs the High Table. */
export const CHIEF_ARCHITECT_AGENT_NAME = 'paqad-chief-architect';

/** One High Table agent's identity: the same fields a stage agent renders from. */
export interface HighTableAgentDef {
  agentName: string;
  claudeTools: string;
  description: string;
}

/**
 * The two High Table agents. Neither edits source: an expert reads its brief and writes one note,
 * the chief reads the notes and writes the synthesis, each through a `paqad-ai` verb. They write
 * their artifact with the shell under `.paqad/tmp/`, so they get no Edit or Write tool.
 */
export const HIGH_TABLE_AGENTS: readonly HighTableAgentDef[] = [
  {
    agentName: EXPERT_AGENT_NAME,
    claudeTools: READ_ONLY_TOOLS,
    description:
      'paqad High Table seat: one expert writes one note for its role. Dispatched by the paqad orchestrator only.',
  },
  {
    agentName: CHIEF_ARCHITECT_AGENT_NAME,
    claudeTools: READ_ONLY_TOOLS,
    description:
      'paqad High Table chair: the chief architect rules on the expert notes. Dispatched by the paqad orchestrator only.',
  },
];

/** True when an agent type (with or without the plugin namespace) is a High Table seat. */
export function isHighTableAgent(agentType: string | null | undefined): boolean {
  if (typeof agentType !== 'string') return false;
  const name = stripPluginAgentNamespace(agentType.trim());
  return name === EXPERT_AGENT_NAME || name === CHIEF_ARCHITECT_AGENT_NAME;
}

const SEAT_RULES = [
  '## Hard rules',
  '',
  '- **Never edit source, docs or config.** You write one artifact under `.paqad/tmp/high-table/`',
  '  with the shell (a heredoc) and hand it to the verb. You have no Edit or Write tool.',
  '- **Never write into a feature bundle directory.** Only the verb writes there.',
  '- **Never ask the human.** A question only a person can answer goes into your artifact in the',
  '  skill format; the orchestrator asks it in the question round.',
  '- You do not load the paqad router or the rules. Your brief carries what a seat needs.',
  '- **Export `SE_SESSION`** from the value the orchestrator gave you for every `paqad-ai` command,',
  '  so every row you write lands under the one change.',
];

/** The cold-brief body of the expert seat agent (issue #639, Part 13). */
export function buildExpertAgentBody(): string {
  return [
    'You are one seat at the paqad **High Table**: a single expert writing request-time notes for',
    'one feature-development change. The orchestrator tells you your role (for example',
    '`security-auditor`), the change ref and `SE_SESSION`. Other experts run beside you in their',
    'own subagents, so you cover your role only.',
    '',
    '## Run your seat',
    '',
    '1. Print your brief first: `paqad-ai spec pipeline experts brief <role>`. This also records',
    '   that your seat started writing.',
    '2. Follow the `expert-notes` skill for your role. Use your host skill when it is installed,',
    '   otherwise read `runtime/base/skills/expert-notes/SKILL.md` in the paqad install directory',
    '   that `.paqad/framework-path.txt` names, and your lens under its `references/lenses/`.',
    '3. Write ONE note for your role only, in the skill format, with one entry in `notes` (your',
    '   role, its `findings` and `questions`) and your spent tokens under `tokens.<role>`.',
    '   Save it as `.paqad/tmp/high-table/<role>-notes.json`.',
    '4. Record it: `paqad-ai spec pipeline experts notes .paqad/tmp/high-table/<role>-notes.json`.',
    '   A refusal names what to fix; fix the artifact and run the verb again.',
    '5. Return one line: your role, the number of findings and questions, and the tokens you spent.',
    '',
    ...SEAT_RULES,
  ].join('\n');
}

/** The cold-brief body of the chief architect agent (issue #639, Part 13). */
export function buildChiefArchitectAgentBody(): string {
  return [
    'You are the **chief architect** who chairs the paqad **High Table** for one',
    'feature-development change. Every seated expert has recorded its note. The orchestrator gives',
    'you the change ref and `SE_SESSION`.',
    '',
    '## Rule on the notes',
    '',
    '1. Read the table first: `paqad-ai spec pipeline experts context`. It prints the request, the',
    '   grounding, every note, the voice warnings and the merge, and records that you started.',
    '2. Follow the `expert-synthesis` skill. Use your host skill when it is installed, otherwise',
    '   read `runtime/base/skills/expert-synthesis/SKILL.md` in the paqad install directory that',
    '   `.paqad/framework-path.txt` names.',
    '3. Write the synthesis in the skill format and save it as',
    '   `.paqad/tmp/high-table/synthesis.json`.',
    '4. Record it: `paqad-ai spec pipeline experts synthesis .paqad/tmp/high-table/synthesis.json`.',
    '   Each conflict becomes a decision packet the orchestrator asks the owner about. A refusal',
    '   names what to fix; fix the artifact and run the verb again.',
    '5. Return one line: your verdict and the counts of accepted, declined, conflicts and gaps.',
    '',
    ...SEAT_RULES,
  ].join('\n');
}

/** The body a High Table agent carries, by its definition. */
export function buildHighTableAgentBody(def: HighTableAgentDef): string {
  return def.agentName === CHIEF_ARCHITECT_AGENT_NAME
    ? buildChiefArchitectAgentBody()
    : buildExpertAgentBody();
}

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
    `2. \`paqad-ai stage start ${def.ledgerStage}\` (with \`SE_SESSION\` exported).`,
    '3. Do the stage work, then write its rigid artifact with the stage verb',
    '   (`plan compile` / `spec freeze` / `rules load` / `review record` / `checks run`), or make the',
    '   edits for a mutation stage.',
    `4. \`paqad-ai stage end ${def.ledgerStage} --artifact <the-rigid-file>\` (mutation stages need no artifact).`,
    '',
    '## Hard rules',
    '',
    '- **Never ask the human.** If you hit a decision pause, create the packet with',
    '  `paqad-ai decision create …` and return immediately with `paused: D-<id>` — the',
    '  orchestrator asks the human and re-dispatches you.',
    '- **Never write into a feature bundle directory by hand.** Only the stage verbs write there.',
    '- **Never skip a CLI verb** because "the orchestrator will do it" — it will not.',
    '- Return exactly: your `status` (`completed` or `paused: D-<id>`), the pillar file path, and at',
    '  most five lines of summary. Nothing else.',
  ].join('\n');
}

/**
 * Whether a recorded host adapter can dispatch stage subagents at all (issue #573).
 *
 * Derived from the SAME roster the agent writer renders for, so the completeness gate and
 * the installer can never disagree about which hosts isolation applies to (RULE-13
 * RL-3210). Gemini and the advisory IDEs expose no subagent dispatch, so a change recorded
 * against one of them must never be asked for isolation evidence.
 *
 * Imported lazily by callers that must not pull the writer's filesystem deps; the host
 * list itself lives in agent-writer.ts beside the templates it drives.
 */
export function isSubagentCapableAdapter(
  adapter: string | null | undefined,
  hosts: readonly { adapter: string }[],
): boolean {
  return typeof adapter === 'string' && hosts.some((host) => host.adapter === adapter);
}
