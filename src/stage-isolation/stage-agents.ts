import { isSubagentCapableAdapter } from '@/authoring/package/agent-render.js';
import {
  OUT_OF_SCOPE_FINDINGS_INSTRUCTION,
  REVIEW_DIGEST_REFRESH_INSTRUCTION,
  STAGE_ORDER,
} from '@/pipeline/feature-development-policy.js';

export interface StageAgentDef {
  agentName: string;
  ledgerStage: string;
  claudeTools: string;
  role: string;
  description: string;
  artifact: string;
  maxTurns: number;
}

export const REPORT_MAX_TOKENS = 2000;
export const STAGE_REPORT_STATUSES = [
  'DONE',
  'DONE_WITH_CONCERNS',
  'NEEDS_CONTEXT',
  'BLOCKED',
] as const;
export type StageReportStatus = (typeof STAGE_REPORT_STATUSES)[number];

const DISPATCHED_LINE = 'Dispatched by the paqad orchestrator only.';

const READ_ONLY_TOOLS = 'Read, Grep, Glob, Bash';
const DEVELOPMENT_TOOLS = 'Read, Edit, Write, NotebookEdit, Grep, Glob, Bash';
const DOC_SYNC_TOOLS = 'Read, Edit, Write, Grep, Glob, Bash';

interface StageMeta {
  tools: string;
  role: string;
  summary: string;
  artifact: string;
  maxTurns: number;
}

const STAGE_META: Record<string, StageMeta> = {
  planning: {
    tools: READ_ONLY_TOOLS,
    role: 'plan the change and record the reuse-checked plan',
    summary: 'maps reuse candidates and compiles plan.json',
    artifact: '`plan.json`, written by `paqad-ai plan compile`',
    maxTurns: 60,
  },
  specification: {
    tools: READ_ONLY_TOOLS,
    role: 'write and freeze the feature spec before any code',
    summary: 'drafts acceptance criteria, seats the High Table and freezes specification.json',
    artifact: '`specification.json`, written by `paqad-ai spec freeze`',
    maxTurns: 60,
  },
  development: {
    tools: DEVELOPMENT_TOOLS,
    role: 'implement the frozen spec',
    summary: 'implements the frozen spec in source and tests after rules load',
    artifact: 'the source and test edits, plus `rules-loaded.json` from `paqad-ai rules load`',
    maxTurns: 150,
  },
  review: {
    tools: READ_ONLY_TOOLS,
    role: 'review the change and record the review',
    summary: 'reads the diff against the spec and records review.json findings',
    artifact: '`review.json`, written by `paqad-ai review record`',
    maxTurns: 60,
  },
  checks: {
    tools: READ_ONLY_TOOLS,
    role: 'run the project checks and record the result',
    summary: 'runs lint, typecheck and the test suite once into checks.json',
    artifact: '`checks.json`, written by `paqad-ai checks run`',
    maxTurns: 60,
  },
  documentation_sync: {
    tools: DOC_SYNC_TOOLS,
    role: 'sync the canonical docs the change affects',
    summary: 'updates the canonical docs whose described behaviour the diff changed',
    artifact: 'the synced canonical docs',
    maxTurns: 60,
  },
};

export const STAGE_AGENT_STAGES: readonly string[] = STAGE_ORDER.filter(
  (stage) => stage in STAGE_META,
);

export function agentNameForStage(ledgerStage: string): string {
  return `paqad-${ledgerStage.replace(/_/g, '-')}`;
}

export const MANDATORY_STAGE_AGENTS: readonly StageAgentDef[] = STAGE_AGENT_STAGES.map(
  (ledgerStage) => {
    const meta = STAGE_META[ledgerStage]!;
    return {
      agentName: agentNameForStage(ledgerStage),
      ledgerStage,
      claudeTools: meta.tools,
      role: meta.role,
      description: `paqad ${ledgerStage.replace(/_/g, ' ')} stage: ${meta.summary}. ${DISPATCHED_LINE}`,
      artifact: meta.artifact,
      maxTurns: meta.maxTurns,
    };
  },
);

export const PLUGIN_AGENT_NAMESPACE = 'paqad:';

export function stripPluginAgentNamespace(agentType: string): string {
  return agentType.startsWith(PLUGIN_AGENT_NAMESPACE)
    ? agentType.slice(PLUGIN_AGENT_NAMESPACE.length)
    : agentType;
}

const STAGE_BY_AGENT_NAME: ReadonlyMap<string, string> = new Map(
  MANDATORY_STAGE_AGENTS.map((def) => [def.agentName, def.ledgerStage]),
);

export function stageForAgentName(agentName: string): string | null {
  return STAGE_BY_AGENT_NAME.get(agentName.trim()) ?? null;
}

export const EXPERT_AGENT_NAME = 'paqad-expert';
export const CHIEF_ARCHITECT_AGENT_NAME = 'paqad-chief-architect';

export interface HighTableAgentDef {
  agentName: string;
  claudeTools: string;
  description: string;
  maxTurns: number;
}

export const HIGH_TABLE_AGENTS: readonly HighTableAgentDef[] = [
  {
    agentName: EXPERT_AGENT_NAME,
    claudeTools: READ_ONLY_TOOLS,
    description: `paqad High Table seat: one expert role records its notes JSON of findings and questions. ${DISPATCHED_LINE}`,
    maxTurns: 20,
  },
  {
    agentName: CHIEF_ARCHITECT_AGENT_NAME,
    claudeTools: READ_ONLY_TOOLS,
    description: `paqad High Table chair: the chief architect rules on every seat and records synthesis.json with its conflicts. ${DISPATCHED_LINE}`,
    maxTurns: 30,
  },
];

export function isHighTableAgent(agentType: string | null | undefined): boolean {
  if (typeof agentType !== 'string') return false;
  const name = stripPluginAgentNamespace(agentType.trim());
  return name === EXPERT_AGENT_NAME || name === CHIEF_ARCHITECT_AGENT_NAME;
}

const SEAT_RULES = [
  '## Hard rules',
  '',
  '- Never edit source, docs or config: write only your artifact under `.paqad/tmp/high-table/`,',
  '  with a shell heredoc. Never write into a feature bundle directory; only the verb writes there.',
  '- Never ask the human. A question only a person can answer goes into your artifact; the',
  '  orchestrator asks it.',
  '- Skip the paqad router and rules; your brief has what a seat needs.',
  '- Export the `SE_SESSION` you were given for every `paqad-ai` command.',
];

export function reportSection(artifact: string, maxTurns: number, returnLine: string): string[] {
  return [
    '## Report',
    '',
    `Keep it under ${REPORT_MAX_TOKENS.toLocaleString('en-US')} tokens and finish in at most ${maxTurns} turns. Leave ${artifact}. ${returnLine}`,
    'End with one line: `Status: DONE`, `Status: DONE_WITH_CONCERNS` (name the concerns),',
    '`Status: NEEDS_CONTEXT` (name what you need) or `Status: BLOCKED` (after a decision pause,',
    'add `paused: D-<id>`).',
  ];
}

const EXPERT_DEF = (): HighTableAgentDef =>
  HIGH_TABLE_AGENTS.find((def) => def.agentName === EXPERT_AGENT_NAME)!;
const CHIEF_DEF = (): HighTableAgentDef =>
  HIGH_TABLE_AGENTS.find((def) => def.agentName === CHIEF_ARCHITECT_AGENT_NAME)!;

export function buildExpertAgentBody(): string {
  return [
    'You are one paqad **High Table** seat: one expert writing request-time notes for one',
    'feature-development change. The orchestrator gives you your role (for example',
    '`security-auditor`), the change ref and `SE_SESSION`. Cover your role only.',
    '',
    '## Run your seat',
    '',
    '1. Print your brief: `paqad-ai spec pipeline experts brief <role>` (this records your start).',
    '2. Follow the `expert-notes` skill for your role: the host skill, or',
    '   `runtime/base/skills/expert-notes/SKILL.md` under the install directory that',
    '   `.paqad/framework-path.txt` names, with your lens in its `references/lenses/`.',
    '3. Write one note for your role in the skill format: one `notes` entry (role, `findings`,',
    '   `questions`) and your spent tokens under `tokens.<role>`, saved as',
    '   `.paqad/tmp/high-table/<role>-notes.json`.',
    '4. Record it: `paqad-ai spec pipeline experts notes .paqad/tmp/high-table/<role>-notes.json`.',
    '   On a refusal, fix what it names and run the verb again.',
    '',
    ...SEAT_RULES,
    '',
    ...reportSection(
      'your recorded `.paqad/tmp/high-table/<role>-notes.json`',
      EXPERT_DEF().maxTurns,
      'Return one line: your role, the counts of findings and questions, and the tokens spent.',
    ),
  ].join('\n');
}

export function buildChiefArchitectAgentBody(): string {
  return [
    'You are the **chief architect** chairing the paqad **High Table** for one',
    'feature-development change, after every seat has recorded its note. The orchestrator',
    'gives you the change ref and `SE_SESSION`.',
    '',
    '## Rule on the notes',
    '',
    '1. Read the table: `paqad-ai spec pipeline experts context` (request, grounding, notes,',
    '   voice warnings and merge; it records your start).',
    '2. Follow the `expert-synthesis` skill: the host skill, or',
    '   `runtime/base/skills/expert-synthesis/SKILL.md` under the install directory that',
    '   `.paqad/framework-path.txt` names.',
    '3. Write the synthesis in the skill format as `.paqad/tmp/high-table/synthesis.json`.',
    '4. Record it: `paqad-ai spec pipeline experts synthesis .paqad/tmp/high-table/synthesis.json`.',
    '   Each conflict becomes a decision packet for the owner. On a refusal, fix what it names',
    '   and run the verb again.',
    '',
    ...SEAT_RULES,
    '',
    ...reportSection(
      'the recorded `.paqad/tmp/high-table/synthesis.json`',
      CHIEF_DEF().maxTurns,
      'Return one line: your verdict and the counts of accepted, declined, conflicts and gaps.',
    ),
  ].join('\n');
}

export function buildHighTableAgentBody(def: HighTableAgentDef): string {
  return def.agentName === CHIEF_ARCHITECT_AGENT_NAME
    ? buildChiefArchitectAgentBody()
    : buildExpertAgentBody();
}

export const STAGE_AGENT_HARD_RULES: readonly string[] = [
  '- Never ask the human. On a decision pause, run `paqad-ai decision create …` and return',
  '  `paused: D-<id>` at once; the orchestrator asks the human and then resumes you with the answer.',
  '- Never write into a feature bundle directory by hand; only the stage verbs write there.',
  '- Never skip a CLI verb because "the orchestrator will do it". It will not.',
];

const STAGES_THAT_RAISE_DEBT: ReadonlySet<string> = new Set(['review', 'documentation_sync']);

function outOfScopeSection(ledgerStage: string): string[] {
  return STAGES_THAT_RAISE_DEBT.has(ledgerStage) ? [OUT_OF_SCOPE_FINDINGS_INSTRUCTION, ''] : [];
}

const LOAD_FRAMEWORK_SECTION: readonly string[] = [
  '## Load the framework first',
  '',
  '1. Resolve `.paqad/framework-path.txt` to the paqad install directory.',
  '2. Load and follow `AGENT-BOOTSTRAP.md` then `AGENT-ROUTER.md` from there, write the',
  '   `.paqad/.agent-entry-loaded` sentinel, and run `paqad-ai rules load`.',
  '3. If the entry gate blocks your first edit, create the per-agent marker it names under',
  '   `.paqad/session/agent-entry/` (or write `.paqad/.agent-entry-loaded`) and retry.',
];

export const STAGE_BRIEF_FALLBACK_LINE =
  'Your stage brief was added to your context when you started. If it is missing, resolve ' +
  '`.paqad/framework-path.txt` and load `AGENT-BOOTSTRAP.md` and `AGENT-ROUTER.md` as before.';

export const AGENT_ENTRY_MARKER_FALLBACK: readonly string[] = [
  'You run in your own subagent context, so the entry gate tracks your load separately from',
  'the orchestrator. If the entry gate blocks an edit, it names the files that changed. Read only',
  'those, write the marker it names, and retry.',
];

const STAGE_BRIEF_SECTION: readonly string[] = [
  '## Your stage brief',
  '',
  STAGE_BRIEF_FALLBACK_LINE,
  '',
  ...AGENT_ENTRY_MARKER_FALLBACK,
];

export const WORK_QUICKLY_LINE =
  "Work quickly: skip anything this stage doesn't need, and return as soon as the result is correct.";

export const SPEC_FOREGROUND_START_LINE =
  'Run `spec pipeline start` in the foreground. It returns within 20 seconds. Never background it and never poll `status`.';

export const DEVELOPMENT_RESUME_LINE =
  "You may be resumed with a follow-up task for the same change. Keep working from what you already know; don't re-read files you have read unless they changed.";

const STAGE_NOTES: Readonly<Record<string, readonly string[]>> = {
  specification: [SPEC_FOREGROUND_START_LINE],
  development: [DEVELOPMENT_RESUME_LINE],
  review: [REVIEW_DIGEST_REFRESH_INSTRUCTION],
};

export function stageNoteLines(ledgerStage: string): string[] {
  return [...(STAGE_NOTES[ledgerStage] ?? [])];
}

function stageNoteSection(ledgerStage: string): string[] {
  const lines = stageNoteLines(ledgerStage);
  return lines.length === 0 ? [] : [...lines, ''];
}

const QUICK_STAGES: ReadonlySet<string> = new Set(['checks', 'documentation_sync']);

function workQuicklySection(ledgerStage: string): string[] {
  return QUICK_STAGES.has(ledgerStage) ? [WORK_QUICKLY_LINE, ''] : [];
}

export function buildStageAgentBody(def: StageAgentDef, host = 'claude-code'): string {
  return [
    `You are the paqad **${def.ledgerStage}** stage agent. You run one stage of one`,
    `feature-development change in your own context and then return. Your job: ${def.role}.`,
    '',
    ...(host === 'claude-code' ? STAGE_BRIEF_SECTION : LOAD_FRAMEWORK_SECTION),
    '',
    '## What you were dispatched with',
    '',
    'The orchestrator passes the change ref, the lane, the previous stage pillar file(s) and',
    "`SE_SESSION`, the orchestrator's session id. Export `SE_SESSION` for every command you run,",
    'so every row and artifact you write is recorded under the one change.',
    '',
    ...workQuicklySection(def.ledgerStage),
    ...stageNoteSection(def.ledgerStage),
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
    ...outOfScopeSection(def.ledgerStage),
    ...(host === 'claude-code' ? [] : ['## Hard rules', '', ...STAGE_AGENT_HARD_RULES, '']),
    ...reportSection(
      def.artifact,
      def.maxTurns,
      'Return the pillar file path and at most five lines of summary.',
    ),
  ].join('\n');
}

export { isSubagentCapableAdapter };

export interface StageReportReading {
  status: StageReportStatus;
  advance: boolean;
  decision: string | null;
  stated: boolean;
}

const STATUS_LINE = /\bStatus:\s*`?(DONE_WITH_CONCERNS|DONE|NEEDS_CONTEXT|BLOCKED)\b/gu;
const PAUSED_DECISION = /\bpaused:\s*(D-[A-Za-z0-9]+)/u;

export function readStageReportStatus(text: string): StageReportReading {
  const statuses = [...text.matchAll(STATUS_LINE)].map((match) => match[1] as StageReportStatus);
  const status = statuses.at(-1) ?? 'BLOCKED';
  return {
    status,
    advance: status === 'DONE' || status === 'DONE_WITH_CONCERNS',
    decision: PAUSED_DECISION.exec(text)?.[1] ?? null,
    stated: statuses.length > 0,
  };
}
