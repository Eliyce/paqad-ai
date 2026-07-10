// Decision-pause self-arm (RCA Step 5c — closing the "nothing mints the packet" gap).
//
// The Decision Pause Contract has teeth: decision-pause-gate.mjs BLOCKS a mutating edit
// while a pending D-*.json exists. But nothing ever MINTED one from a live edit — the
// packet had to be written out of band. This is the narrow, opt-in minter: when the
// recent prompt shows a create-vs-reuse fork at high confidence and no decision is
// pending or already made, it script-writes ONE pending packet so the gate then blocks
// the NEXT edit and the human is asked before more is built on an un-made choice.
//
// Deliberately conservative (a false block interrupts real work):
//   - OFF by default. Opt in via `PAQAD_DECISION_SELFARM` (or `decision_selfarm` in the
//     local .paqad/.config). Disabled → an instant NO_OP, no transcript read, no cost.
//   - Two high-confidence forks ONLY (#300): create-vs-reuse at 0.92, and the TIGHT
//     architecture-path `explicit-path-fork` at 0.9 (two distinct file paths offered as
//     alternatives). The broad 0.64 architecture-path signals ("or", two paths merely
//     mentioned) and the lower-confidence component-reuse signal never clear the bar, so
//     a stray "or" in a prompt cannot mint a pause.
//   - Never mints when a packet is already pending, or when this fork was already
//     resolved (findReusableDecision). It MINTS; it never blocks — the block is the
//     existing decision-pause gate's job on the following edit.

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

/**
 * The forks self-arm is allowed to mint on, each with the minimum detector confidence
 * required to arm. create-vs-reuse arms on its 0.92 reuse-vs-create signal;
 * architecture-path arms ONLY at 0.9, which only the tight `explicit-path-fork` signal
 * reaches — the broad 0.64 architecture-path signals stay below the bar (#300).
 */
const ARMED_CATEGORIES: ReadonlyArray<{ category: DecisionCategory; minConfidence: number }> = [
  { category: 'create-vs-reuse', minConfidence: 0.92 },
  { category: 'architecture-path', minConfidence: 0.9 },
];
const TTL_DAYS = 30;

/** A non-blocking capability outcome — structurally a kernel `CapabilityOutcome`. */
interface SelfArmOutcome {
  ran: boolean;
  blocking: boolean;
  summary: string;
}

const NO_OP: SelfArmOutcome = { ran: false, blocking: false, summary: '' };

function isTruthy(value: string | undefined): boolean {
  return value !== undefined && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/**
 * Whether the self-arm minter is enabled. Resolution order (first match wins):
 *   1. `PAQAD_DECISION_SELFARM` (env) — an explicit force, either direction.
 *   2. `.paqad/.config` `decision_selfarm` — the local per-developer force.
 *   3. Default (issue #345 G5): ON when the session routed to feature-development, OFF
 *      everywhere else. The Decision Pause Contract is a feature-development obligation, so
 *      the conservative minter is armed by default there — and never outside it — while an
 *      env/config value can still force it on or off. A false `featureDevelopment` (a
 *      question / pentest / docs / RCA / small-talk turn) keeps the pre-#345 OFF default.
 */
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

/**
 * Whether this session is on the feature-development route (active OR paused), read from the
 * per-session workflow-state — the same signal the rule-scripts capability uses. Absent
 * state (no route recorded) is not feature-development, so the self-arm default stays OFF.
 */
export function sessionOnFeatureDevelopment(
  projectRoot: string,
  sessionId: string | null,
): boolean {
  if (!sessionId) return false;
  const state = readWorkflowState(projectRoot, resolveSessionId(projectRoot, sessionId));
  if (state.active && isFeatureDevelopmentRoute(state.active.workflow)) return true;
  return state.paused.some((entry) => isFeatureDevelopmentRoute(entry.workflow));
}

/**
 * The text of the LAST user message in a Claude transcript (JSONL), or '' when it cannot
 * be found. Best-effort and tolerant: unparseable lines are skipped, and both the
 * `{message:{role,content}}` and flatter shapes are handled.
 */
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

/** Flatten a transcript message `content` (string, or an array of `{type:'text',text}`). */
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
  /** Injectable for tests; defaults to a real DecisionStore on the project root. */
  store?: DecisionStore;
  now?: () => Date;
}

export interface SelfArmResult {
  minted: string | null;
  reason:
    'minted' | 'no-fork' | 'no-session' | 'pending-exists' | 'already-decided' | 'write-failed';
  /** The armed fork's category once a fork cleared the confidence bar; null otherwise. */
  category: DecisionCategory | null;
}

/**
 * Detect an armed fork (create-vs-reuse or the tight architecture-path explicit-path-fork)
 * in the prompt and, if it clears every guard, mint ONE pending decision packet. Returns
 * the minted id, the fork category, or the reason it declined. Pure of the host seam —
 * the capability wraps this; tests drive it directly with an injected store.
 */
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

  // Dedupe 1 — never pile a second pause on top of an open one.
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

  // Dedupe 2 — this exact fork was already resolved; do not re-ask.
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
    // Cap reached, a task-level conflict, or any store error → decline silently.
    return { minted: null, reason: 'write-failed', category };
  }
}

/** The one-line packet context, worded for the fork the minter armed on. */
function contextForCategory(category: DecisionCategory, targetFile: string): string {
  return category === 'architecture-path'
    ? `This looks like a which-path choice that affects ${targetFile}. Pick the path before more is built on it.`
    : `This looks like a reuse-or-create choice that affects ${targetFile}. Pick the path before more is built on it.`;
}

/** The non-blocking advisory shown when a packet is minted, worded for the fork. */
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
  /** Injectable transcript reader for tests; defaults to reading the file from disk. */
  readTranscript?: (path: string) => string;
}

/**
 * The full self-arm capability behaviour, transcript reader injected for tests. Only
 * runs at the pre-mutation seam and only when opted in; every guard failure is a clean
 * NO_OP so a disabled or non-matching turn pays nothing and is never interrupted.
 */
export function runDecisionSelfArm(input: RunSelfArmInput): SelfArmOutcome {
  if (input.seam !== 'pre-mutation') return NO_OP;
  // #345 G5 — default-on within feature-development only. Resolve the route from the same
  // per-session workflow-state the rule-scripts capability reads; an env/config value still
  // overrides. Outside feature-development this is false, so the self-arm stays OFF.
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
