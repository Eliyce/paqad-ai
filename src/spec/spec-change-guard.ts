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
// src/spec/** is outside the FR-11 import ban, so the guard may reach the pipeline's corrections
// writer (issue #547, FR-11.3). It stays deterministic and still mints exactly one pause.
import { recordSpecCorrection } from '@/spec-pipeline/metrics.js';
import { buildFeatureSpec } from './feature-spec-builder.js';

import { buildSpecChangePacket } from './spec-decisions.js';
import { isFrozenSpecStale } from './spec-freeze.js';

/** The frozen-spec sections the guard diffs when a spec's source moves (issue #547, FR-11.3). */
function diffSpecSections(frozen: FeatureSpec, current: FeatureSpec): string[] {
  const changed: string[] = [];
  const differs = (a: unknown, b: unknown): boolean => JSON.stringify(a) !== JSON.stringify(b);
  if (differs(frozen.behaviour, current.behaviour)) changed.push('behaviour');
  if (differs(frozen.acceptance_criteria, current.acceptance_criteria)) {
    changed.push('acceptance_criteria');
  }
  if (differs(frozen.invariants, current.invariants)) changed.push('invariants');
  if (differs(frozen.non_goals ?? [], current.non_goals ?? [])) changed.push('non_goals');
  return changed;
}

/** Derive the run scratch dir name from a spec's provenance run_dir, or null when non-pipeline. */
function runDirNameFor(spec: FeatureSpec): string | null {
  const runDir = spec.provenance?.run_dir;
  return runDir ? (/_specs\/([^/]+)\/pipeline/.exec(runDir)?.[1] ?? null) : null;
}

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
    let currentMarkdown: string;
    try {
      currentMarkdown = readMarkdown(spec.spec_file);
    } catch {
      // Source unreadable this run → skip rather than mint on a transient error.
      continue;
    }
    if (!isFrozenSpecStale(spec, sha256Hex(currentMarkdown))) continue;

    // Which sections moved (issue #547, FR-11.3). Recorded as a correction (when the spec came
    // from a pipeline run) and carried into the packet so the human sees exactly what changed.
    const changedSections = diffSpecSections(
      spec,
      buildFeatureSpec({
        spec_id: spec.spec_id,
        spec_file: spec.spec_file,
        spec_markdown: currentMarkdown,
      }),
    );
    const runDirName = runDirNameFor(spec);
    if (runDirName) {
      recordSpecCorrection(input.projectRoot, runDirName, {
        spec_id: spec.spec_id,
        changed_sections: changedSections,
        at: now.toISOString(),
      });
    }

    const packet = buildSpecChangePacket({
      decision_id: store.nextDecisionId(),
      spec_id: spec.spec_id,
      spec_file: spec.spec_file,
      detail:
        changedSections.length > 0
          ? `${STALE_DETAIL} Changed sections: ${changedSections.join(', ')}.`
          : STALE_DETAIL,
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
