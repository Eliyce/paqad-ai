// Spec-change guard (#300) — the runtime minter for a mid-build goal change.
//
// Companion to the create-vs-reuse / architecture-path self-arm minter, but for the
// spec-lifecycle fork the #285 build silently missed: a FROZEN spec whose source
// markdown moved mid-build. Unlike self-arm this is DETERMINISTIC — it compares the
// current markdown hash against the hash captured at freeze (`isFrozenSpecStale`), so
// there is no detector to misfire and no opt-in is needed. It is naturally inert: with
// no frozen sidecar persisted (the state today, until the freeze lifecycle runs) it is
// an instant NO_OP.
//
// It only MINTS one `spec.change` pause via the existing `buildSpecChangePacket`; the
// existing decision-pause gate blocks the NEXT edit. Never blocks the current edit.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sha256Hex } from '@/compliance/markdown.js';
import type { CapabilitySeam } from '@/kernel/registry.js';
import { DecisionStore } from '@/planning/decision-store.js';
import type { FeatureSpec } from '@/core/types/feature-spec.js';

import { readAllFeatureSpecifications } from '@/feature-evidence/projections.js';

import { buildSpecChangePacket } from './spec-decisions.js';
import { isFrozenSpecStale } from './spec-freeze.js';

/** A non-blocking capability outcome — structurally a kernel `CapabilityOutcome`. */
export interface SpecChangeGuardOutcome {
  ran: boolean;
  blocking: boolean;
  summary: string;
}

const NO_OP: SpecChangeGuardOutcome = { ran: false, blocking: false, summary: '' };

const STALE_DETAIL =
  'The frozen spec source changed since it was frozen — the goal may have moved. ' +
  'Confirm the new goal before more is built on the old one.';

function mintedSummary(specId: string): string {
  return (
    `**▸ paqad** · the frozen spec ${specId} changed mid-build — that's a goal call that's yours\n` +
    `> I paused and wrote it up so you can update-and-refreeze or hold the line — answer it, then I'll continue.`
  );
}

export interface SpecChangeGuardInput {
  projectRoot: string;
  sessionId: string | null;
  /** Only runs at the pre-mutation seam; other seams NO_OP. Omit to skip the check. */
  seam?: CapabilitySeam;
  /** Injectable for tests; defaults to a real DecisionStore on the project root. */
  store?: DecisionStore;
  /** Injectable for tests; defaults to reading the persisted sidecars from disk. */
  frozenSpecs?: FeatureSpec[];
  /** Injectable for tests; defaults to reading the spec's source markdown from disk. */
  readMarkdown?: (specFile: string) => string;
  now?: () => Date;
}

/**
 * Detect a stale frozen spec and, if one clears every guard, mint ONE `spec.change`
 * packet. Returns a non-blocking advisory on a mint, or NO_OP otherwise. Deterministic,
 * always-on, and inert when no frozen spec is persisted.
 */
export function runSpecChangeGuard(input: SpecChangeGuardInput): SpecChangeGuardOutcome {
  if (input.seam !== undefined && input.seam !== 'pre-mutation') return NO_OP;
  if (!input.sessionId) return NO_OP;

  const specs = input.frozenSpecs ?? readAllFeatureSpecifications(input.projectRoot);
  if (specs.length === 0) return NO_OP;

  const store = input.store ?? new DecisionStore(input.projectRoot);
  store.initialize();

  // Never pile a second pause on top of an open one.
  if (store.listPendingDecisionIds().length > 0) return NO_OP;

  const readMarkdown =
    input.readMarkdown ?? ((specFile) => readFileSync(join(input.projectRoot, specFile), 'utf8'));
  const now = input.now?.() ?? new Date();

  for (const spec of specs) {
    let currentHash: string;
    try {
      currentHash = sha256Hex(readMarkdown(spec.spec_file));
    } catch {
      // Source unreadable this run → skip rather than mint on a transient error.
      continue;
    }
    if (!isFrozenSpecStale(spec, currentHash)) continue;

    const packet = buildSpecChangePacket({
      decision_id: store.nextDecisionId(),
      spec_id: spec.spec_id,
      spec_file: spec.spec_file,
      detail: STALE_DETAIL,
      task_session_id: input.sessionId,
      created_at: now.toISOString(),
    });

    // This exact spec-change was already resolved → do not re-ask.
    if (store.findReusableDecision(packet)) continue;

    try {
      store.writePending(packet);
      return { ran: true, blocking: false, summary: mintedSummary(spec.spec_id) };
    } catch {
      // Cap reached or any store error → decline silently.
      return NO_OP;
    }
  }

  return NO_OP;
}
