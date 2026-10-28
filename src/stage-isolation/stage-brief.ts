import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PAQAD_STAGE_HELPER_MATCHER } from '@/adapters/shared/paqad-hooks.js';
import { readTextIfExistsSync } from '@/core/fs/read-if-exists.js';
import type { FeatureDevelopmentStageName } from '@/core/types/feature-development-policy.js';
import { splitFrontMatter } from '@/feature-evidence/envelope.js';
import { readFeatureRecord } from '@/feature-evidence/feature-record.js';
import { featureFilePath, type FeatureBundleFile } from '@/feature-evidence/paths.js';
import { currentFeature, recordedLaneOrFull } from '@/feature-evidence/stage-ledger.js';
import { extractCandidates } from '@/module-decisions/extractor.js';
import { loadFeatureDevelopmentPolicy } from '@/pipeline/feature-development-policy.js';
import {
  keepingLedgerSessionCache,
  resolveHookSession,
  type HookSessionPayload,
} from '@/rag-ledger/session.js';

import {
  MANDATORY_STAGE_AGENTS,
  STAGE_AGENT_HARD_RULES,
  type StageAgentDef,
} from './stage-agents.js';
import { isSafeSessionId } from './stage-settings.js';
import { stageFromAgentType } from './subagent-completion.js';

export { isSafeSessionId, SAFE_SESSION_ID } from './stage-settings.js';

export const STAGE_BRIEF_MAX_CHARS = 9000;

export const STAGE_BRIEF_ENTRY_LINE =
  'paqad records your entry check when you start; if an edit is blocked, create the marker it names.';

export const STAGE_BRIEF_NO_CHANGE_LINE =
  'No active change was found; ask nothing, use the change ref the orchestrator gave you.';

export const STAGE_BRIEF_MORE_LINE =
  'More instructions for this stage are in docs/instructions/workflows/feature-development.yaml.';

const PREVIOUS_PILLARS: Readonly<Record<string, readonly FeatureBundleFile[]>> = {
  planning: [],
  specification: ['plan'],
  development: ['plan', 'specification'],
  review: ['specification'],
  checks: ['review'],
  documentation_sync: ['review', 'checks'],
};

const CODE_EDITING_STAGES: ReadonlySet<string> = new Set(['development']);

const STAGE_HELPER_PATTERN = new RegExp(PAQAD_STAGE_HELPER_MATCHER);

export function stageHelperStage(agentType: unknown): string | null {
  if (typeof agentType !== 'string' || !STAGE_HELPER_PATTERN.test(agentType)) {
    return null;
  }
  return stageFromAgentType(agentType);
}

function stageDef(stage: string): StageAgentDef {
  const def = MANDATORY_STAGE_AGENTS.find((candidate) => candidate.ledgerStage === stage);
  if (!def) {
    throw new Error(`unknown stage "${stage}"`);
  }
  return def;
}

function existingPillars(projectRoot: string, dirName: string, stage: string): string[] {
  return PREVIOUS_PILLARS[stage]!.map((file) => featureFilePath(dirName, file)).filter((path) =>
    existsSync(join(projectRoot, path)),
  );
}

function changeSection(projectRoot: string, sessionId: string, stage: string): string[] {
  const dirName = currentFeature(projectRoot, sessionId);
  if (!dirName) {
    return ['## Your change', '', STAGE_BRIEF_NO_CHANGE_LINE, ''];
  }
  const pillars = existingPillars(projectRoot, dirName, stage);
  return [
    '## Your change',
    '',
    `- Change: \`${dirName}\``,
    `- Lane: ${recordedLaneOrFull(projectRoot, sessionId, dirName)}`,
    pillars.length === 0 ? '- Previous pillar files: none' : '- Previous pillar files:',
    ...pillars.map((path) => `  - \`${path}\``),
    '',
  ];
}

function documentedModules(projectRoot: string): string[] {
  try {
    return readdirSync(join(projectRoot, 'docs/modules'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function changeRequestText(projectRoot: string, dirName: string): string {
  const title = (readFeatureRecord(projectRoot, dirName)?.title ?? '').replace(/-/g, ' ');
  const request = readTextIfExistsSync(join(projectRoot, featureFilePath(dirName, 'request')));
  return [title, request === null ? '' : splitFrontMatter(request).body].join('\n');
}

export function attributedModuleReads(projectRoot: string, sessionId: string): string[] {
  const dirName = currentFeature(projectRoot, sessionId);
  if (!dirName) return [];
  const slugs = documentedModules(projectRoot);
  if (slugs.length === 0) return [];
  return extractCandidates({
    prompt: changeRequestText(projectRoot, dirName),
    existingSlugs: slugs,
  })
    .filter((candidate) => candidate.kind === 'exact-match')
    .map((candidate) => `docs/modules/${candidate.slug}/**`);
}

function stageReads(
  stage: string,
  projectRoot: string,
  sessionId: string,
  read: readonly string[],
): string[] {
  if (stage !== 'planning') return [...read];
  return [...new Set([...read, ...attributedModuleReads(projectRoot, sessionId)])];
}

function bulletList(items: readonly string[], empty: string): string[] {
  return items.length === 0 ? [empty] : items.map((item) => `- ${item}`);
}

export interface StageBriefOptions {
  agentId?: unknown;
  resumed?: boolean;
}

export function safeAgentId(agentId: unknown): string | null {
  if (typeof agentId !== 'string') return null;
  const trimmed = agentId.trim();
  return isSafeSessionId(trimmed) ? trimmed : null;
}

function commandsSection(stage: string, sessionId: string, agentId: string | null): string[] {
  const prefix =
    agentId === null
      ? `SE_SESSION=${sessionId} paqad-ai`
      : `SE_SESSION=${sessionId} SE_AGENT_ID=${agentId} paqad-ai`;
  const rulesLoad = CODE_EDITING_STAGES.has(stage)
    ? [`- \`${prefix} rules load\` before your first source edit.`]
    : [];
  return [
    '## Commands',
    '',
    `- \`${prefix} stage start ${stage}\``,
    ...rulesLoad,
    '- Do the stage work, then write its rigid artifact with the stage verb, or make the edits',
    '  for a mutation stage.',
    `- \`${prefix} stage end ${stage} --artifact <the-rigid-file>\` (mutation stages need no artifact).`,
  ];
}

interface BriefParts {
  head: string[];
  read: string[];
  instructions: string[];
  tail: string[];
}

function render(parts: BriefParts, truncated: boolean): string {
  return [
    ...parts.head,
    '## Read first',
    '',
    ...bulletList(parts.read, 'Nothing extra to read for this stage.'),
    '',
    '## Stage instructions',
    '',
    ...bulletList(parts.instructions, 'No extra instructions for this stage.'),
    ...(truncated ? ['', STAGE_BRIEF_MORE_LINE] : []),
    '',
    ...parts.tail,
  ].join('\n');
}

function fitToBudget(parts: BriefParts): string {
  let read = [...parts.read];
  let instructions = [...parts.instructions];
  let truncated = false;
  let text = render(parts, truncated);
  while (text.length > STAGE_BRIEF_MAX_CHARS && (instructions.length > 0 || read.length > 0)) {
    if (instructions.length > 0) {
      instructions = instructions.slice(0, -1);
    } else {
      read = read.slice(0, -1);
    }
    truncated = true;
    text = render({ ...parts, read, instructions }, truncated);
  }
  return text;
}

function introLines(stage: string, role: string, resumed: boolean): string[] {
  if (resumed) {
    return [
      `You are the paqad **${stage}** stage agent, resumed for the same feature-development change.`,
      `Your job: ${role}.`,
      '',
      `This is the ${stage} stage brief, so you do not need to load AGENT-BOOTSTRAP.md or`,
      `AGENT-ROUTER.md. ${STAGE_BRIEF_ENTRY_LINE}`,
    ];
  }
  return [
    `You are the paqad **${stage}** stage agent. You run one stage of one feature-development`,
    `change in your own isolated context and then return. Your job: ${role}.`,
    '',
    'paqad added this stage brief to your context when you started, so you do not need to load',
    `AGENT-BOOTSTRAP.md or AGENT-ROUTER.md. ${STAGE_BRIEF_ENTRY_LINE}`,
  ];
}

function exportLines(sessionId: string, agentId: string | null): string[] {
  const session = [
    `- **Export \`SE_SESSION=${sessionId}\`** for every \`paqad-ai\` command you run, so every row`,
    '  and artifact you write is recorded under the one change.',
  ];
  if (agentId === null) return session;
  return [
    ...session,
    `- **Export \`SE_AGENT_ID=${agentId}\`** with it, so a stage you start for this change is`,
    '  recorded as yours.',
  ];
}

export function buildStageBrief(
  stage: string,
  projectRoot: string,
  sessionId: string,
  options: StageBriefOptions = {},
): string {
  const def = stageDef(stage);
  if (!isSafeSessionId(sessionId)) {
    throw new Error('unsafe session id');
  }
  const agentId = safeAgentId(options.agentId);
  const policy =
    loadFeatureDevelopmentPolicy(projectRoot).policy.stages[stage as FeatureDevelopmentStageName];
  const head = [
    ...introLines(stage, def.role, options.resumed === true),
    '',
    ...changeSection(projectRoot, sessionId, stage),
  ];
  const tail = [
    '## Hard rules',
    '',
    ...STAGE_AGENT_HARD_RULES,
    ...exportLines(sessionId, agentId),
    '',
    ...commandsSection(stage, sessionId, agentId),
  ];
  return fitToBudget({
    head,
    read: stageReads(stage, projectRoot, sessionId, policy.read),
    instructions: policy.instructions,
    tail,
  });
}

export function stageBriefHookOutput(brief: string): string {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: brief },
  });
}

export function resolveBriefSession(
  projectRoot: string,
  payload: HookSessionPayload,
  env: NodeJS.ProcessEnv = process.env,
): string {
  for (const raw of [payload.session_id, env.SE_SESSION, env.CLAUDE_SESSION_ID]) {
    if (typeof raw === 'string' && raw.trim() !== '' && !isSafeSessionId(raw.trim())) {
      throw new Error('unsafe session id');
    }
  }
  return resolveHookSession(projectRoot, payload, env);
}

export function seedStageAgent(
  stage: string,
  projectRoot: string,
  payload: HookSessionPayload & { agent_id?: unknown },
  env: NodeJS.ProcessEnv = process.env,
): string {
  return keepingLedgerSessionCache(projectRoot, () =>
    stageBriefHookOutput(
      buildStageBrief(stage, projectRoot, resolveBriefSession(projectRoot, payload, env), {
        agentId: payload.agent_id,
      }),
    ),
  );
}
