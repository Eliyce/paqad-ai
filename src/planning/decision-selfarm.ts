import { readFileSync } from 'node:fs';

import { readDotConfig } from '@/core/framework-config.js';
import type { CapabilityPayload, CapabilitySeam } from '@/kernel/registry.js';
import { isFeatureDevelopmentRoute } from '@/pipeline/routed-workflow.js';
import { readWorkflowState } from '@/pipeline/workflow-state.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

import { detectDecisionForks } from './decision-detector.js';
import { computeDecisionFingerprint } from './decision-fingerprint.js';
import {
  decisionOptionsForCategory,
  decisionQuestionForCategory,
} from './decision-packet-builder.js';
import type { DecisionCategory, DecisionPacket } from './decision-packet.js';
import { DecisionStore } from './decision-store.js';

const ARMED_CATEGORIES: ReadonlyArray<{ category: DecisionCategory; minConfidence: number }> = [
  { category: 'create-vs-reuse', minConfidence: 0.92 },
  { category: 'architecture-path', minConfidence: 0.9 },
];
const TTL_DAYS = 30;

interface SelfArmOutcome {
  ran: boolean;
  blocking: boolean;
  summary: string;
}

const NO_OP: SelfArmOutcome = { ran: false, blocking: false, summary: '' };

function isTruthy(value: string | undefined): boolean {
  return value !== undefined && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export function isSelfArmEnabled(
  projectRoot: string,
  env: NodeJS.ProcessEnv,
  opts: { featureDevelopment?: boolean } = {},
): boolean {
  const envValue = env.PAQAD_DECISION_SELFARM;
  if (envValue !== undefined && envValue !== '') {
    return isTruthy(envValue);
  }
  const configValue = readDotConfig(projectRoot).get('decision_selfarm');
  if (configValue !== undefined && configValue !== '') {
    return isTruthy(configValue);
  }
  return opts.featureDevelopment === true;
}

export function sessionOnFeatureDevelopment(
  projectRoot: string,
  sessionId: string | null,
): boolean {
  if (!sessionId) return false;
  const state = readWorkflowState(projectRoot, resolveSessionId(projectRoot, sessionId));
  if (state.active && isFeatureDevelopmentRoute(state.active.workflow)) return true;
  return state.paused.some((entry) => isFeatureDevelopmentRoute(entry.workflow));
}

export function lastUserPromptFromTranscript(transcriptText: string): string {
  const lines = transcriptText.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const record = entry as {
      type?: unknown;
      role?: unknown;
      message?: { role?: unknown; content?: unknown };
    };
    const role = record.message?.role ?? record.role ?? record.type;
    if (role === 'user') {
      const text = extractText(
        record.message?.content ?? (record as { content?: unknown }).content,
      );
      if (text) return text;
    }
  }
  return '';
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const block = part as { type?: unknown; text?: unknown };
        return block.type === 'text' && typeof block.text === 'string' ? block.text : '';
      })
      .join(' ')
      .trim();
  }
  return '';
}

export interface SelfArmInput {
  projectRoot: string;
  promptText: string;
  sessionId: string | null;
  targetPath?: string | null;
  store?: DecisionStore;
  now?: () => Date;
}

export interface SelfArmResult {
  minted: string | null;
  reason:
    'minted' | 'no-fork' | 'no-session' | 'pending-exists' | 'already-decided' | 'write-failed';
  category: DecisionCategory | null;
}

export function selfArmDecision(input: SelfArmInput): SelfArmResult {
  const armedFork = detectDecisionForks(input.promptText).find((fork) =>
    ARMED_CATEGORIES.some(
      (armed) => armed.category === fork.category && fork.confidence >= armed.minConfidence,
    ),
  );
  if (!armedFork) {
    return { minted: null, reason: 'no-fork', category: null };
  }
  if (!input.sessionId) {
    return { minted: null, reason: 'no-session', category: null };
  }

  const category = armedFork.category;
  const store = input.store ?? new DecisionStore(input.projectRoot);
  store.initialize();

  if (store.listPendingDecisionIds().length > 0) {
    return { minted: null, reason: 'pending-exists', category };
  }

  const targetFile = input.targetPath || 'src/unknown.ts';
  const options = decisionOptionsForCategory(input.projectRoot, category, targetFile).options;
  const question = decisionQuestionForCategory(category);
  const fingerprint = computeDecisionFingerprint({
    category,
    question,
    option_keys: options.map((option) => option.option_key),
    repo_state: { active_capabilities: ['coding'] },
  });

  if (store.findReusableDecision({ fingerprint, category, options })) {
    return { minted: null, reason: 'already-decided', category };
  }

  const now = input.now?.() ?? new Date();
  const packet: DecisionPacket = {
    decision_id: store.nextDecisionId(),
    fingerprint,
    category,
    question,
    context: contextForCategory(category, targetFile),
    options,
    confidence: armedFork.confidence,
    requested_by: 'paqad',
    task_session_id: input.sessionId,
    created_at: now.toISOString(),
    status: 'pending',
    ttl_until: new Date(now.getTime() + TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    invalidation_watch: [targetFile],
  };

  try {
    store.writePending(packet);
    return { minted: packet.decision_id, reason: 'minted', category };
  } catch {
    return { minted: null, reason: 'write-failed', category };
  }
}

function contextForCategory(category: DecisionCategory, targetFile: string): string {
  return category === 'architecture-path'
    ? `This looks like a which-path choice that affects ${targetFile}. Pick the path before more is built on it.`
    : `This looks like a reuse-or-create choice that affects ${targetFile}. Pick the path before more is built on it.`;
}

function mintedSummary(category: DecisionCategory): string {
  const headline =
    category === 'architecture-path'
      ? `I hit a which-path choice that's yours to make`
      : `I hit a reuse-or-create choice that's yours to make`;
  return (
    `**▸ paqad** · ${headline}\n` +
    `> I paused and wrote it up so you can pick the path — answer the decision, then I'll continue.`
  );
}

export interface RunSelfArmInput {
  projectRoot: string;
  seam: CapabilitySeam;
  env: NodeJS.ProcessEnv;
  payload?: CapabilityPayload;
  readTranscript?: (path: string) => string;
}

export function runDecisionSelfArm(input: RunSelfArmInput): SelfArmOutcome {
  if (input.seam !== 'pre-mutation') return NO_OP;
  const featureDevelopment = sessionOnFeatureDevelopment(
    input.projectRoot,
    input.payload?.sessionId ?? input.env.CLAUDE_SESSION_ID ?? null,
  );
  if (!isSelfArmEnabled(input.projectRoot, input.env, { featureDevelopment })) return NO_OP;

  const transcriptPath = input.payload?.transcriptPath;
  const sessionId = input.payload?.sessionId ?? null;
  if (!transcriptPath || !sessionId) return NO_OP;

  let promptText: string;
  try {
    const read = input.readTranscript ?? ((path: string) => readFileSync(path, 'utf8'));
    promptText = lastUserPromptFromTranscript(read(transcriptPath));
  } catch {
    return NO_OP;
  }
  if (!promptText) return NO_OP;

  const result = selfArmDecision({
    projectRoot: input.projectRoot,
    promptText,
    sessionId,
    targetPath: input.payload?.targetPath ?? null,
  });
  /* v8 ignore next 3 -- the `&& result.category` guard is defensive: a minted result
     always carries its category, so the minted-without-category branch is unreachable. */
  return result.minted && result.category
    ? { ran: true, blocking: false, summary: mintedSummary(result.category) }
    : NO_OP;
}
