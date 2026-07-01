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
//   - create-vs-reuse ONLY, at the detector's 0.92 confidence (decision D3) — never the
//     lower-confidence component-reuse / architecture-path signals.
//   - Never mints when a packet is already pending, or when this fork was already
//     resolved (findReusableDecision). It MINTS; it never blocks — the block is the
//     existing decision-pause gate's job on the following edit.

import { readFileSync } from 'node:fs';

import { readDotConfig } from '@/core/framework-config.js';
import type { CapabilityPayload, CapabilitySeam } from '@/kernel/registry.js';

import { detectDecisionForks } from './decision-detector.js';
import { computeDecisionFingerprint } from './decision-fingerprint.js';
import {
  decisionOptionsForCategory,
  decisionQuestionForCategory,
} from './decision-packet-builder.js';
import type { DecisionCategory, DecisionPacket } from './decision-packet.js';
import { DecisionStore } from './decision-store.js';

const CATEGORY: DecisionCategory = 'create-vs-reuse';
/** The detector's confidence for the reuse-vs-create signal; the D3 arming threshold. */
const MIN_CONFIDENCE = 0.92;
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
 * Whether the self-arm minter is enabled. OFF by default. `PAQAD_DECISION_SELFARM`
 * (env) wins; otherwise the local `.paqad/.config` `decision_selfarm` line. Read from
 * the local dev config only (never a tracked team file) so turning it on is an explicit,
 * per-developer opt-in while its precision is still being proven.
 */
export function isSelfArmEnabled(projectRoot: string, env: NodeJS.ProcessEnv): boolean {
  const envValue = env.PAQAD_DECISION_SELFARM;
  if (envValue !== undefined && envValue !== '') {
    return isTruthy(envValue);
  }
  return isTruthy(readDotConfig(projectRoot).get('decision_selfarm'));
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
    | 'minted'
    | 'no-fork'
    | 'no-session'
    | 'pending-exists'
    | 'already-decided'
    | 'write-failed';
}

/**
 * Detect a create-vs-reuse fork in the prompt and, if it clears every guard, mint ONE
 * pending decision packet. Returns the minted id or the reason it declined. Pure of the
 * host seam — the capability wraps this; tests drive it directly with an injected store.
 */
export function selfArmDecision(input: SelfArmInput): SelfArmResult {
  const armed = detectDecisionForks(input.promptText).some(
    (fork) => fork.category === CATEGORY && fork.confidence >= MIN_CONFIDENCE,
  );
  if (!armed) {
    return { minted: null, reason: 'no-fork' };
  }
  if (!input.sessionId) {
    return { minted: null, reason: 'no-session' };
  }

  const store = input.store ?? new DecisionStore(input.projectRoot);
  store.initialize();

  // Dedupe 1 — never pile a second pause on top of an open one.
  if (store.listPendingDecisionIds().length > 0) {
    return { minted: null, reason: 'pending-exists' };
  }

  const targetFile = input.targetPath || 'src/unknown.ts';
  const options = decisionOptionsForCategory(input.projectRoot, CATEGORY, targetFile).options;
  const question = decisionQuestionForCategory(CATEGORY);
  const fingerprint = computeDecisionFingerprint({
    category: CATEGORY,
    question,
    option_keys: options.map((option) => option.option_key),
    repo_state: { active_capabilities: ['coding'] },
  });

  // Dedupe 2 — this exact fork was already resolved; do not re-ask.
  if (store.findReusableDecision({ fingerprint, category: CATEGORY, options })) {
    return { minted: null, reason: 'already-decided' };
  }

  const now = input.now?.() ?? new Date();
  const packet: DecisionPacket = {
    decision_id: store.nextDecisionId(),
    fingerprint,
    category: CATEGORY,
    question,
    context: `This looks like a reuse-or-create choice that affects ${targetFile}. Pick the path before more is built on it.`,
    options,
    confidence: MIN_CONFIDENCE,
    requested_by: 'paqad',
    task_session_id: input.sessionId,
    created_at: now.toISOString(),
    status: 'pending',
    ttl_until: new Date(now.getTime() + TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    invalidation_watch: [targetFile],
  };

  try {
    store.writePending(packet);
    return { minted: packet.decision_id, reason: 'minted' };
  } catch {
    // Cap reached, a task-level conflict, or any store error → decline silently.
    return { minted: null, reason: 'write-failed' };
  }
}

const MINTED_SUMMARY =
  `**▸ paqad** · I hit a reuse-or-create choice that's yours to make\n` +
  `> I paused and wrote it up so you can pick the path — answer the decision, then I'll continue.`;

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
  if (!isSelfArmEnabled(input.projectRoot, input.env)) return NO_OP;

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
  return result.minted ? { ran: true, blocking: false, summary: MINTED_SUMMARY } : NO_OP;
}
