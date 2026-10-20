import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sha256Hex } from '@/compliance/markdown.js';
import type { CapabilitySeam } from '@/kernel/registry.js';
import { DecisionStore } from '@/planning/decision-store.js';
import type { FeatureSpec } from '@/core/types/feature-spec.js';

import { splitFrontMatter } from '@/feature-evidence/envelope.js';
import { FEATURE_BUNDLE_FILES, featureFilePath } from '@/feature-evidence/paths.js';
import { readAllFeatureSpecificationEntries } from '@/feature-evidence/projections.js';
import { recordSpecCorrection } from '@/spec-pipeline/metrics.js';
import { buildFeatureSpec } from './feature-spec-builder.js';

import { buildSpecChangePacket } from './spec-decisions.js';
import { isFrozenSpecStale } from './spec-freeze.js';

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

function pipelineProduced(spec: FeatureSpec): boolean {
  return spec.pipeline?.produced === true || spec.provenance?.pipeline_produced === true;
}

export interface SpecChangeGuardOutcome {
  ran: boolean;
  blocking: boolean;
  summary: string;
}

const NO_OP: SpecChangeGuardOutcome = { ran: false, blocking: false, summary: '' };

interface WatchedSpec {
  spec: FeatureSpec;
  dirName: string | null;
  source: string;
  bundled: boolean;
}

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
  seam?: CapabilitySeam;
  store?: DecisionStore;
  frozenSpecs?: FeatureSpec[];
  readMarkdown?: (specFile: string) => string;
  now?: () => Date;
}

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
      continue;
    }
    if (!isFrozenSpecStale(spec, sha256Hex(currentMarkdown))) continue;

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

    if (store.findReusableDecision(packet)) continue;

    try {
      store.writePending(packet);
      return { ran: true, blocking: false, summary: mintedSummary(spec.spec_id) };
    } catch {
      return NO_OP;
    }
  }

  return NO_OP;
}
