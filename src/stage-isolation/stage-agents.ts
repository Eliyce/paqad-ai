import { isSubagentCapableAdapter } from '@/authoring/package/agent-render.js';
import {
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
    artifact: '`plan.json`',
    maxTurns: 100,
  },
  specification: {
    tools: READ_ONLY_TOOLS,
    role: 'write and freeze the feature spec before any code',
    summary: 'drafts acceptance criteria, seats the High Table and freezes specification.json',
    artifact: '`specification.json`',
    maxTurns: 60,
  },
  development: {
    tools: DEVELOPMENT_TOOLS,
    role: 'implement the frozen spec',
    summary: 'implements the frozen spec in source and tests after rules load',
    artifact: 'the source and test edits and `rules-loaded.json`',
    maxTurns: 170,
  },
  review: {
    tools: READ_ONLY_TOOLS,
    role: 'review the change and record the review',
    summary: 'reads the diff against the spec and records review.json findings',
    artifact: '`review.json`',
    maxTurns: 70,
  },
  checks: {
    tools: READ_ONLY_TOOLS,
    role: 'run the project checks and record the result',
    summary: 'runs lint, typecheck and the test suite once into checks.json',
    artifact: '`checks.json`',
    maxTurns: 20,
  },
  documentation_sync: {
    tools: DOC_SYNC_TOOLS,
    role: 'sync the canonical docs the change affects',
    summary: 'updates the canonical docs whose described behaviour the diff changed',
    artifact: 'the synced canonical docs',
    maxTurns: 30,
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

export const BLOCKED_REPORT_LINES: readonly string[] = [
  '```',
  'Status: BLOCKED',
  'Decision needed: <what must be decided>',
  'Options: <2 to 4 options>',
  'paused: D-<id>',
  '```',
];

export function reportSection(artifact: string, maxTurns: number, returnLine: string): string[] {
  return [
    '## Report',
    '',
    `Keep it under ${REPORT_MAX_TOKENS.toLocaleString('en-US')} tokens and finish in at most ${maxTurns} turns. Leave ${artifact}. ${returnLine}`,
    'End with one line: `Status: DONE`, `Status: DONE_WITH_CONCERNS` (name the concerns),',
    '`Status: NEEDS_CONTEXT` (name what you need) or `Status: BLOCKED`. For `Status: BLOCKED`,',
    'end with this block instead, keeping the `paused: D-<id>` line only after a decision pause:',
    '',
    ...BLOCKED_REPORT_LINES,
  ];
}

const SEAT_DO_NOT: readonly string[] = [
  '## Do not',
  '',
  '- Never edit source, docs or config: `stage-agent-write-guard.mjs` blocks it; write only your artifact under `.paqad/tmp/high-table/`, with a shell heredoc. Never write into a feature bundle directory; only `paqad-ai spec pipeline experts` writes there.',
  '- Never ask the human: the AskUserQuestion tool is not available to you. A question only a person can answer goes into your artifact, recorded with `paqad-ai spec pipeline experts`; the orchestrator asks it.',
];

const SEAT_SESSION_STEP =
  '1. Export the `SE_SESSION` you were given for every `paqad-ai` command. Your brief has what a seat needs, so skip the paqad router and rules.';

const EXPERT_DEF = (): HighTableAgentDef =>
  HIGH_TABLE_AGENTS.find((def) => def.agentName === EXPERT_AGENT_NAME)!;
const CHIEF_DEF = (): HighTableAgentDef =>
  HIGH_TABLE_AGENTS.find((def) => def.agentName === CHIEF_ARCHITECT_AGENT_NAME)!;

export function buildExpertAgentBody(): string {
  return [
    '## Objective',
    '',
    'Write the request-time notes for one paqad **High Table** seat on one feature-development change. The orchestrator gives you your role (for example `security-auditor`), the change ref and `SE_SESSION`. Cover your role only.',
    '',
    '## Procedure',
    '',
    SEAT_SESSION_STEP,
    '2. Print your brief: `paqad-ai spec pipeline experts brief <role>` (this records your start).',
    '3. Follow the `expert-notes` skill for your role: the host skill, or `base/skills/expert-notes/SKILL.md` under the install directory that `.paqad/framework-path.txt` names, with your lens in its `references/lenses/`.',
    '4. Write one note for your role in the skill format: one `notes` entry (role, `findings`, `questions`) and your spent tokens under `tokens.<role>`, saved as `.paqad/tmp/high-table/<role>-notes.json`.',
    '5. Record it: `paqad-ai spec pipeline experts notes .paqad/tmp/high-table/<role>-notes.json`. On a refusal, fix what it names and run the verb again.',
    '',
    ...reportSection(
      'your recorded `.paqad/tmp/high-table/<role>-notes.json`',
      EXPERT_DEF().maxTurns,
      'Return one line: your role, the counts of findings and questions, and the tokens spent.',
    ),
    '',
    '## Stop when',
    '',
    '- `experts notes` has recorded your note.',
    '- The brief verb fails or names no request: return `Status: NEEDS_CONTEXT` with its error.',
    '',
    ...SEAT_DO_NOT,
    '',
    '## Example',
    '',
    'Role `security-auditor` on a change that adds file uploads: one `risk` finding on unchecked file types and one question on the size limit, recorded. Return `security-auditor: 1 finding, 1 question, <tokens> tokens` and `Status: DONE`.',
  ].join('\n');
}

export function buildChiefArchitectAgentBody(): string {
  return [
    '## Objective',
    '',
    'Chair the paqad **High Table** for one feature-development change as its **chief architect**, after every seat has recorded its note: rule on each finding and record the synthesis. The orchestrator gives you the change ref and `SE_SESSION`.',
    '',
    '## Procedure',
    '',
    SEAT_SESSION_STEP,
    '2. Read the table: `paqad-ai spec pipeline experts context` (request, grounding, notes, voice warnings and merge; it records your start).',
    '3. Follow the `expert-synthesis` skill: the host skill, or `base/skills/expert-synthesis/SKILL.md` under the install directory that `.paqad/framework-path.txt` names.',
    '4. Write the synthesis in the skill format as `.paqad/tmp/high-table/synthesis.json`.',
    '5. Record it: `paqad-ai spec pipeline experts synthesis .paqad/tmp/high-table/synthesis.json`. Each conflict becomes a decision packet for the owner. On a refusal, fix what it names and run the verb again.',
    '',
    ...reportSection(
      'the recorded `.paqad/tmp/high-table/synthesis.json`',
      CHIEF_DEF().maxTurns,
      'Return one line: your verdict and the counts of accepted, declined, conflicts and gaps.',
    ),
    '',
    '## Stop when',
    '',
    '- `experts synthesis` has recorded your synthesis.',
    '- `experts context` shows a seat with no recorded note: return `Status: NEEDS_CONTEXT` naming the seat.',
    '',
    ...SEAT_DO_NOT,
    '',
    '## Example',
    '',
    'Three seat notes that disagree on where sessions are stored: the synthesis accepts four findings, declines one with a reason and recommends one side of the conflict, which the verb raises as a packet. Return `needs-answers: 4 accepted, 1 declined, 1 conflict, 0 gaps` and `Status: DONE`.',
  ].join('\n');
}

export function buildHighTableAgentBody(def: HighTableAgentDef): string {
  return def.agentName === CHIEF_ARCHITECT_AGENT_NAME
    ? buildChiefArchitectAgentBody()
    : buildExpertAgentBody();
}

export const STAGE_AGENT_HARD_RULES: readonly string[] = [
  '- Do not ask the human. On a decision pause, run `paqad-ai decision create …` and return `paused: D-<id>` at once; the orchestrator asks and resumes you.',
  '- Do not write into a feature bundle directory: the capability gate blocks an edit there. Only the stage commands write there.',
  '- Do not skip a stage command because the orchestrator will run it: it will not, the next `paqad-ai stage start` refuses past an unfinished stage, and the completeness gate reads the end row.',
];

const HOOK_ENFORCED_DO_NOT: readonly string[] = [
  '- Do not ask the human: the AskUserQuestion tool is not available to you. Run `paqad-ai decision create …` and return `paused: D-<id>`.',
  '- Do not write into a feature bundle directory: the capability gate blocks it.',
  '- Do not return a finished report without the `paqad-ai stage end` row: `stage-agent-handback.mjs` refuses it.',
];

export const READ_ONLY_DO_NOT =
  '- Do not edit project files: `stage-agent-write-guard.mjs` blocks it, except your stage input under `.paqad/tmp/`, written with a shell heredoc.';

const LOAD_FRAMEWORK_STEPS = (step: number): string[] => [
  `${step}. Load \`AGENT-ROUTER.md\` from the install in \`.paqad/framework-path.txt\` and write the \`.paqad/.agent-entry-loaded\` sentinel.`,
  `${step + 1}. If the entry gate blocks an edit, write the marker under \`.paqad/session/agent-entry/\` and retry.`,
];

export function stageBriefFallbackLine(stage: string): string {
  return `If your stage brief is missing, run \`paqad-ai stage brief ${stage} --full\`.`;
}

export const AGENT_ENTRY_MARKER_FALLBACK: readonly string[] = [
  'If the entry gate blocks an edit, write the marker it names and retry.',
];

const STAGE_BRIEF_STEPS = (step: number, stage: string): string[] => [
  `${step}. ${stageBriefFallbackLine(stage)}`,
  `${step + 1}. ${AGENT_ENTRY_MARKER_FALLBACK.join(' ')}`,
];

export const WORK_QUICKLY_LINE =
  "Work quickly: skip anything this stage doesn't need, and return as soon as the result is correct.";

export const SPEC_FOREGROUND_START_LINE =
  'Run `spec pipeline start` in the foreground. It returns within 20 seconds. Never background it and never poll `status`.';

export const SPEC_HIGH_TABLE_HANDBACK_LINE =
  'After `spec pipeline experts record` seats experts, return at once with `Status: NEEDS_CONTEXT` naming every seated role: the orchestrator dispatches the seats and resumes you. Do not write the notes or freeze the spec in that turn.';

export const DEVELOPMENT_RESUME_LINE =
  "You may be resumed with a follow-up task for the same change. Keep working from what you already know; don't re-read files you have read unless they changed.";

const STAGE_NOTES: Readonly<Record<string, readonly string[]>> = {
  specification: [SPEC_FOREGROUND_START_LINE, SPEC_HIGH_TABLE_HANDBACK_LINE],
  development: [DEVELOPMENT_RESUME_LINE],
  review: [REVIEW_DIGEST_REFRESH_INSTRUCTION],
};

export function stageNoteLines(ledgerStage: string): string[] {
  return [...(STAGE_NOTES[ledgerStage] ?? [])];
}

interface StageProcedure {
  work: string;
  end: string;
  stop: string;
  example: string;
}

const STAGE_PROCEDURE: Record<string, StageProcedure> = {
  planning: {
    work: 'Follow your recipe, then compile with `paqad-ai plan compile <plan-template.json>`.',
    end: '`paqad-ai stage end planning --agent paqad-planning --artifact <the plan.json path that plan compile printed>`.',
    stop: '`stage end planning` has accepted `plan.json`.',
    example:
      'Compile `plan.json` and end the stage. Return its path, what you reuse and add, and `Status: DONE`.',
  },
  specification: {
    work: 'Follow your recipe, then freeze with `paqad-ai spec freeze`.',
    end: '`paqad-ai stage end specification --agent paqad-specification --artifact <the specification.json path>`.',
    stop: '`stage end specification` has accepted `specification.json`, or you returned the seated experts.',
    example: 'Freeze `specification.json` and end the stage. Return its path and `Status: DONE`.',
  },
  development: {
    work: 'Follow your recipe to make the source and test edits the frozen spec asks for.',
    end: '`paqad-ai stage end development --agent paqad-development`.',
    stop: '`stage end development` has succeeded with every criterion tested.',
    example: 'Edit, test and end the stage. Return the changed files and `Status: DONE`.',
  },
  review: {
    work: 'Follow your recipe, then record with `paqad-ai review record <review-template.json>`.',
    end: '`paqad-ai stage end review --agent paqad-review --artifact <the review.json path>`.',
    stop: '`stage end review` has accepted `review.json`.',
    example:
      'Record `review.json` with one deferred finding. Return its path and `Status: DONE_WITH_CONCERNS`.',
  },
  checks: {
    work: 'Follow your recipe: run the project checks once with `paqad-ai checks run`.',
    end: '`paqad-ai stage end checks --agent paqad-checks --artifact <the checks.json path>`.',
    stop: '`stage end checks` has accepted `checks.json`.',
    example:
      'Run the checks and end the stage. Return one line per failing check and `Status: DONE_WITH_CONCERNS`; return `Status: DONE` only when every check is green.',
  },
  documentation_sync: {
    work: 'Follow your recipe to update the canonical docs whose described behaviour the diff changed.',
    end: '`paqad-ai stage end documentation_sync --agent paqad-documentation-sync`.',
    stop: '`stage end documentation_sync` has succeeded.',
    example: 'Update the stale doc and end the stage. Return its path and `Status: DONE`.',
  },
};

function recipeLines(host: string): string[] {
  return host === 'claude-code'
    ? [
        'No `## Your recipe` heading? Run the brief; still none, continue, reporting its repair.',
        '',
      ]
    : [];
}

function stageDoNot(def: StageAgentDef, host: string): string[] {
  if (host !== 'claude-code') return ['## Do not', '', ...STAGE_AGENT_HARD_RULES];
  const readOnly = !/\bEdit\b/u.test(def.claudeTools);
  return ['## Do not', '', ...HOOK_ENFORCED_DO_NOT, ...(readOnly ? [READ_ONLY_DO_NOT] : [])];
}

export function buildStageAgentBody(def: StageAgentDef, host = 'claude-code'): string {
  const procedure = STAGE_PROCEDURE[def.ledgerStage]!;
  const entry =
    host === 'claude-code' ? STAGE_BRIEF_STEPS(1, def.ledgerStage) : LOAD_FRAMEWORK_STEPS(1);
  return [
    '## Objective',
    '',
    `You are the paqad **${def.ledgerStage}** stage agent. Your job: ${def.role}, for one change, then return.`,
    '',
    '## Procedure',
    '',
    ...entry,
    '3. Export `SE_SESSION` from your dispatch for every command you run.',
    `4. \`paqad-ai stage begin ${def.ledgerStage} --agent ${def.agentName}\`.`,
    `5. ${procedure.work}`,
    `6. ${procedure.end}`,
    '',
    ...recipeLines(host),
    '## Report',
    '',
    `Keep it under ${REPORT_MAX_TOKENS.toLocaleString('en-US')} tokens and finish in at most ${def.maxTurns} turns. Leave ${def.artifact}. Return its path and at most five lines.`,
    'End with one line: `Status: DONE`, `Status: DONE_WITH_CONCERNS` (name the concerns), `Status: NEEDS_CONTEXT` (name what you need) or `Status: BLOCKED`, with `Decision needed:`, `Options:` and, after a decision pause, `paused: D-<id>`.',
    '',
    '## Stop when',
    '',
    `- ${procedure.stop}`,
    '- You opened a decision packet: return `Status: BLOCKED` at once.',
    '- An input is missing: return `Status: NEEDS_CONTEXT` naming it.',
    '',
    ...stageDoNot(def, host),
    '',
    '## Example',
    '',
    procedure.example,
  ].join('\n');
}

export { isSubagentCapableAdapter };

export interface StageReportReading {
  status: StageReportStatus;
  advance: boolean;
  decision: string | null;
  stated: boolean;
}

const STATUS_LINE =
  /^[\s*_`#-]*Status:\s*[*_`]*(DONE_WITH_CONCERNS|DONE|NEEDS_CONTEXT|BLOCKED)\b/gmu;
const PAUSED_DECISION = /^[\s*_`#-]*paused:\s*`?(D-[A-Za-z0-9]+)/gmu;

export function readStageReportStatus(text: string): StageReportReading {
  const statuses = [...text.matchAll(STATUS_LINE)].map((match) => match[1] as StageReportStatus);
  const status = statuses.at(-1) ?? 'BLOCKED';
  const decisions = [...text.matchAll(PAUSED_DECISION)].map((match) => match[1]!);
  return {
    status,
    advance: status === 'DONE' || status === 'DONE_WITH_CONCERNS',
    decision: decisions.at(-1) ?? null,
    stated: statuses.length > 0,
  };
}
