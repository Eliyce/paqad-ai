import type { PhaseExecutor } from './phase.interface.js';
import type { PhaseResult, PipelineRunContext } from '@/core/types/pipeline.js';
import type { TraceabilityMap } from '@/core/types/traceability.js';
import { PATHS } from '@/core/constants/paths.js';
import {
  buildTraceabilityMap,
  gatherTraceabilityInputs,
  writeTraceabilityMap,
} from '@/traceability/index.js';

/**
 * Issue #109 — wraps a host phase so the bidirectional traceability map is
 * rebuilt from reality on every run, joining the existing obligation/compliance
 * (spec→test), module-map, import-graph, and verification-evidence `ac_id`
 * pieces. It is lane-gated: `fast` builds the cheap change-set subset; the inner
 * builder runs the full two-way map on `graduated`/`full`.
 *
 * Transparent and non-blocking, mirroring the module-map drift channel: the
 * untested-promise / orphan-code findings are *flagged* (surfaced as a warning
 * and written to `.paqad/traceability/map.json`), never used to fail the build.
 * If the inner phase fails, that result is returned unchanged; the map build is
 * always best-effort and never throws into the pipeline.
 */
export class TraceabilityPhase implements PhaseExecutor {
  readonly phase: PhaseExecutor['phase'];

  constructor(
    private readonly inner: PhaseExecutor,
    private readonly options: { now?: () => string } = {},
  ) {
    this.phase = inner.phase;
  }

  async execute(context: PipelineRunContext): Promise<PhaseResult> {
    const innerResult = await this.inner.execute(context);

    let map: TraceabilityMap;
    try {
      const input = await gatherTraceabilityInputs({
        projectRoot: context.project_root,
        lane: context.lane,
        now: this.options.now,
      });
      map = buildTraceabilityMap(input);
      await writeTraceabilityMap(context.project_root, map);
    } catch (error) {
      // The map is a reconciliation artifact; never fail the host phase over an
      // I/O or scan error here (same contract as the #108 rounds log).
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`paqad: could not build traceability map (${message})`);
      return innerResult;
    }

    // Don't override a failing host phase — the run is already blocked.
    if (innerResult.status === 'fail' || map.findings.length === 0) {
      return innerResult;
    }

    const note = summarizeFindings(map);
    return {
      ...innerResult,
      status: 'warning',
      summary: `${innerResult.summary} ${note}`,
      artifacts: [...innerResult.artifacts, PATHS.TRACEABILITY_MAP],
    };
  }
}

function summarizeFindings(map: TraceabilityMap): string {
  const parts: string[] = [];
  if (map.counts.untested_promises > 0) {
    parts.push(`${map.counts.untested_promises} untested promise(s)`);
  }
  if (map.counts.orphan_code > 0) {
    parts.push(`${map.counts.orphan_code} orphan code file(s) (no promise, no user)`);
  }
  const scope = map.mode === 'light' ? ' (fast-lane change-set subset)' : '';
  return `Traceability flagged ${parts.join(' and ')}${scope}; see ${PATHS.TRACEABILITY_MAP}.`;
}
