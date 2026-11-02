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
  '- Never edit source, docs or config: write only your artifact under `.paqad/tmp/high-table/`, with a shell heredoc. Never write into a feature bundle directory; only the verb writes there.',
  '- Never ask the human. A question only a person can answer goes into your artifact; the orchestrator asks it.',
  '- Do not load the paqad router or rules; your brief has what a seat needs.',
];

const SEAT_SESSION_STEP = '1. Export the `SE_SESSION` you were given for every `paqad-ai` command.';

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
    '3. Follow the `expert-notes` skill for your role: the host skill, or `runtime/base/skills/expert-notes/SKILL.md` under the install directory that `.paqad/framework-path.txt` names, with your lens in its `references/lenses/`.',
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
    '3. Follow the `expert-synthesis` skill: the host skill, or `runtime/base/skills/expert-synthesis/SKILL.md` under the install directory that `.paqad/framework-path.txt` names.',
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
  '- Never ask the human. On a decision pause, run `paqad-ai decision create …` and return',
  '  `paused: D-<id>` at once; the orchestrator asks the human and then resumes you with the answer.',
  '- Never write into a feature bundle directory by hand; only the stage verbs write there.',
  '- Never skip a CLI verb because "the orchestrator will do it". It will not.',
];

const HOOK_ENFORCED_DO_NOT: readonly string[] = [
  '- Do not ask the human. The SubagentStop check holds a stage that asked; on a decision pause run `paqad-ai decision create …` and return `paused: D-<id>` at once, and the orchestrator asks and resumes you with the answer.',
  '- Do not write into a feature bundle directory by hand. The SubagentStop check holds a stage that did; only the stage verbs write there.',
  '- Do not skip a stage verb because the orchestrator will run it. It will not, and the completion check judges a stage without its verb rows as unfinished.',
];

export const READ_ONLY_DO_NOT =
  '- Do not edit project files. Write only your stage input (the plan template, the spec input or the review template) under `.paqad/tmp/`, with a shell heredoc. The write guard blocks every other file write from Bash, and the SubagentStop check holds a stage that edited.';

const STAGES_THAT_RAISE_DEBT: ReadonlySet<string> = new Set(['review', 'documentation_sync']);

const LOAD_FRAMEWORK_STEPS = (step: number): string[] => [
  `${step}. Resolve \`.paqad/framework-path.txt\` to the paqad install directory, load and follow \`AGENT-BOOTSTRAP.md\` then \`AGENT-ROUTER.md\` from there, write the \`.paqad/.agent-entry-loaded\` sentinel, and run \`paqad-ai rules load\`.`,
  `${step + 1}. If the entry gate blocks your first edit, create the per-agent marker it names under \`.paqad/session/agent-entry/\` (or write \`.paqad/.agent-entry-loaded\`) and retry.`,
];

export const STAGE_BRIEF_FALLBACK_LINE =
  'Your stage brief was added to your context when you started. If it is missing, resolve ' +
  '`.paqad/framework-path.txt` and load `AGENT-BOOTSTRAP.md` and `AGENT-ROUTER.md` as before.';

export const AGENT_ENTRY_MARKER_FALLBACK: readonly string[] = [
  'You run in your own subagent context, so the entry gate tracks your load separately from',
  'the orchestrator. If the entry gate blocks an edit, it names the files that changed. Read only',
  'those, write the marker it names, and retry.',
];

const STAGE_BRIEF_STEPS = (step: number): string[] => [
  `${step}. ${STAGE_BRIEF_FALLBACK_LINE}`,
  `${step + 1}. ${AGENT_ENTRY_MARKER_FALLBACK.join(' ')}`,
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

const QUICK_STAGES: ReadonlySet<string> = new Set(['checks', 'documentation_sync']);

interface StageProcedure {
  work: string;
  end: string;
  stop: string;
  example: string;
}

const STAGE_PROCEDURE: Record<string, StageProcedure> = {
  planning: {
    work: 'Plan the change as the instructions say, then compile it with `paqad-ai plan compile <plan-template.json>`.',
    end: '`paqad-ai stage end planning --artifact <the plan.json path that plan compile printed>`.',
    stop: '`stage end planning` has accepted `plan.json`.',
    example:
      'Dispatched with the change ref and the request, you compile `plan.json` with its reuse section and end the stage against it. Return the `plan.json` path, two lines on what you reuse and what you add, and `Status: DONE`.',
  },
  specification: {
    work: 'Write the spec as the instructions say, then freeze it with `paqad-ai spec freeze`.',
    end: '`paqad-ai stage end specification --artifact <the specification.json path>`.',
    stop: '`stage end specification` has accepted `specification.json`.',
    example:
      'Dispatched with `plan.json`, you run the High Table, freeze `specification.json` and end the stage against it. Return its path, the count of acceptance criteria, and `Status: DONE`.',
  },
  development: {
    work: 'Run `paqad-ai rules load` before your first source edit, then make the source and test edits the frozen spec asks for.',
    end: '`paqad-ai stage end development` (a mutation stage needs no artifact).',
    stop: '`stage end development` has succeeded with every acceptance criterion implemented and tested.',
    example:
      'Dispatched with `specification.json`, you load the rules, edit the source and its tests, and end the stage. Return the changed files in at most five lines and `Status: DONE`.',
  },
  review: {
    work: 'Review the diff against the spec, then record it with `paqad-ai review record <review-template.json>`.',
    end: '`paqad-ai stage end review --artifact <the review.json path>`.',
    stop: '`stage end review` has accepted `review.json`.',
    example:
      'Dispatched after development, you read the digest, re-run it before recording, record `review.json` with one deferred finding that names its TD id, and end the stage. Return the path, the verdict, and `Status: DONE_WITH_CONCERNS` naming the deferred finding.',
  },
  checks: {
    work: 'Run the project checks once with `paqad-ai checks run`.',
    end: '`paqad-ai stage end checks --artifact <the checks.json path>`.',
    stop: '`stage end checks` has accepted `checks.json`.',
    example:
      'Dispatched after review, you run `paqad-ai checks run` once and end the stage against `checks.json`. Return its path, one line per failing check, and `Status: DONE`.',
  },
  documentation_sync: {
    work: 'Update the canonical docs whose described behaviour the diff changed.',
    end: '`paqad-ai stage end documentation_sync` (a mutation stage needs no artifact).',
    stop: '`stage end documentation_sync` has succeeded with every affected canonical doc updated.',
    example:
      'Dispatched with the diff, you update the one canonical doc whose described behaviour changed and end the stage. Return the doc path, one summary line, and `Status: DONE`.',
  },
};

function stageDoNot(def: StageAgentDef, host: string): string[] {
  if (host !== 'claude-code') return ['## Do not', '', ...STAGE_AGENT_HARD_RULES];
  const readOnly = !/\bEdit\b/u.test(def.claudeTools);
  return ['## Do not', '', ...HOOK_ENFORCED_DO_NOT, ...(readOnly ? [READ_ONLY_DO_NOT] : [])];
}

export function buildStageAgentBody(def: StageAgentDef, host = 'claude-code'): string {
  const procedure = STAGE_PROCEDURE[def.ledgerStage]!;
  const entry = host === 'claude-code' ? STAGE_BRIEF_STEPS(1) : LOAD_FRAMEWORK_STEPS(1);
  const notes = [
    ...(QUICK_STAGES.has(def.ledgerStage) ? [WORK_QUICKLY_LINE] : []),
    ...stageNoteLines(def.ledgerStage),
    ...(STAGES_THAT_RAISE_DEBT.has(def.ledgerStage) ? [OUT_OF_SCOPE_FINDINGS_INSTRUCTION] : []),
  ];
  return [
    '## Objective',
    '',
    `You are the paqad **${def.ledgerStage}** stage agent. Your job: ${def.role}, for one feature-development change, in your own context, then return.`,
    '',
    '## Procedure',
    '',
    ...entry,
    "3. Export `SE_SESSION`, the orchestrator's session id from your dispatch, for every command you run, so every row and artifact you write is recorded under the one change.",
    `4. You were dispatched with the change ref, the lane and the previous pillar file(s). Read those files and the \`${def.ledgerStage}\` stage's \`read:\` list and \`instructions\` from \`docs/instructions/workflows/feature-development.yaml\`.`,
    `5. \`paqad-ai stage start ${def.ledgerStage}\`.`,
    `6. ${procedure.work}`,
    `7. ${procedure.end}`,
    '',
    ...notes.flatMap((line) => [line, '']),
    ...reportSection(
      def.artifact,
      def.maxTurns,
      'Return the pillar file path and at most five lines of summary.',
    ),
    '',
    '## Stop when',
    '',
    `- ${procedure.stop}`,
    '- You opened a decision packet: return the BLOCKED report at once.',
    '- An input you were dispatched with is missing: return `Status: NEEDS_CONTEXT` naming it.',
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
