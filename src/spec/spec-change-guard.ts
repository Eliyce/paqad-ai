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

import { splitFrontMatter } from '@/feature-evidence/envelope.js';
import { FEATURE_BUNDLE_FILES, featureFilePath } from '@/feature-evidence/paths.js';
import { readAllFeatureSpecificationEntries } from '@/feature-evidence/projections.js';
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

/**
 * Whether the spec pipeline produced this spec: the `pipeline` section of a record frozen since
 * issue #581, or the `provenance` block of an older one.
 */
function pipelineProduced(spec: FeatureSpec): boolean {
  return spec.pipeline?.produced === true || spec.provenance?.pipeline_produced === true;
}

/** A non-blocking capability outcome — structurally a kernel `CapabilityOutcome`. */
export interface SpecChangeGuardOutcome {
  ran: boolean;
  blocking: boolean;
  summary: string;
}

const NO_OP: SpecChangeGuardOutcome = { ran: false, blocking: false, summary: '' };

/** A frozen spec and the project-relative source file the guard watches for it. */
interface WatchedSpec {
  spec: FeatureSpec;
  /** The bundle that carries the spec, or null for a spec handed in directly. */
  dirName: string | null;
  source: string;
  /** True for the bundle's `spec.md` (issue #581): its front matter is not part of the hash. */
  bundled: boolean;
}

/**
 * The spec's watched source. A record written since issue #581 names the bundle-relative
 * `spec.md`, the signed copy inside its bundle; an older record names its own source path.
 */
function watchedSpec(dirName: string, spec: FeatureSpec): WatchedSpec {
  return spec.spec_file === FEATURE_BUNDLE_FILES.specMd
    ? { spec, dirName, source: featureFilePath(dirName, 'specMd'), bundled: true }
    : { spec, dirName, source: spec.spec_file, bundled: false };
}

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

  const specs: WatchedSpec[] = input.frozenSpecs
    ? input.frozenSpecs.map((spec) => ({
        spec,
        dirName: null,
        source: spec.spec_file,
        bundled: false,
      }))
    : readAllFeatureSpecificationEntries(input.projectRoot).map((entry) =>
        watchedSpec(entry.dirName, entry.spec),
      );
  if (specs.length === 0) return NO_OP;

  const store = input.store ?? new DecisionStore(input.projectRoot);
  store.initialize();

  // Never pile a second pause on top of an open one.
  if (store.listPendingDecisionIds().length > 0) return NO_OP;

  const readMarkdown =
    input.readMarkdown ?? ((specFile) => readFileSync(join(input.projectRoot, specFile), 'utf8'));
  const now = input.now?.() ?? new Date();

  for (const { spec, dirName, source, bundled } of specs) {
    let currentMarkdown: string;
    try {
      const text = readMarkdown(source);
      currentMarkdown = bundled ? splitFrontMatter(text).body : text;
    } catch {
      // Source unreadable this run → skip rather than mint on a transient error.
      continue;
    }
    if (!isFrozenSpecStale(spec, sha256Hex(currentMarkdown))) continue;

    // Which sections moved (issue #547, FR-11.3). Recorded as a `spec-correction` row on the
    // bundle that carries the spec (when the pipeline produced it, issue #581) and carried into
    // the packet so the human sees exactly what changed.
    const changedSections = diffSpecSections(
      spec,
      buildFeatureSpec({
        spec_id: spec.spec_id,
        spec_file: spec.spec_file,
        spec_markdown: currentMarkdown,
      }),
    );
    if (dirName !== null && pipelineProduced(spec)) {
      recordSpecCorrection(input.projectRoot, dirName, {
        spec_id: spec.spec_id,
        changed_sections: changedSections,
        at: now.toISOString(),
      });
    }

    const packet = buildSpecChangePacket({
      decision_id: store.nextDecisionId(),
      spec_id: spec.spec_id,
      spec_file: source,
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
