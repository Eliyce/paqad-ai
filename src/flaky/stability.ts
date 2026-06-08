import { readProjectProfile } from '@/core/project-profile.js';
import {
  DEFAULT_STABILITY_RERUNS,
  MAX_STABILITY_RERUNS,
  MIN_STABILITY_RERUNS,
  type StabilityJudgement,
  type StabilityRun,
  type StabilityVerdict,
} from '@/core/types/flaky.js';

/**
 * Resolves the bounded re-run count used to judge stability. Defaults small
 * (issue #106 open decision #1) and is project-tunable via
 * `custom.flaky.rerun_count`, clamped so a misconfiguration cannot blow up CI
 * time or make a single run "prove" stability.
 */
export function resolveRerunCount(projectRoot: string): number {
  const configured = readProjectProfile(projectRoot)?.custom?.flaky?.rerun_count;
  return clampRerunCount(configured ?? DEFAULT_STABILITY_RERUNS);
}

export function clampRerunCount(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_STABILITY_RERUNS;
  }
  const rounded = Math.round(value);
  return Math.min(MAX_STABILITY_RERUNS, Math.max(MIN_STABILITY_RERUNS, rounded));
}

export interface JudgeStabilityInput {
  test_id: string;
  /**
   * Re-runs the suspect test on the SAME tree with NO code change and returns
   * whether it passed. Called up to `reruns` times. The caller owns actually
   * invoking the test runner; this keeps the judge deterministic and testable.
   */
  rerun: (attempt: number) => StabilityRun;
  /** Bounded number of re-runs (see `resolveRerunCount`). */
  reruns: number;
}

/**
 * Judges whether a failure is genuinely flaky by re-running it on an unchanged
 * tree. This is the **assume-real-first** rule made concrete: a failure is only
 * called flaky once a re-run actually flips it (a pass appears) — failing every
 * time is treated as `real`, never dismissed as "probably flaky". A clean
 * recovery is reported as `recovered` rather than silently dropped, so the
 * original failure is still visible.
 *
 * The flip is detected the same way the rest of the suite reasons about
 * pass↔fail transitions — by comparing per-run pass/fail status (the model
 * behind `test-output/service.ts` delta projection) — so there is no parallel
 * notion of "did it change".
 */
export function judgeStability(input: JudgeStabilityInput): StabilityJudgement {
  const total = clampRerunCount(input.reruns);
  let passes = 0;
  let failures = 0;

  for (let attempt = 0; attempt < total; attempt += 1) {
    if (input.rerun(attempt).passed) {
      passes += 1;
    } else {
      failures += 1;
    }
  }

  const verdict = classifyStability(passes, failures);

  return {
    test_id: input.test_id,
    verdict,
    reruns: total,
    passes,
    failures,
  };
}

/**
 * A test is flaky only if it both passed and failed across the re-runs (it
 * flipped). All-fail is `real`; all-pass is `recovered`. Assume-real-first means
 * the `real` and ambiguous cases are never auto-labelled flaky here.
 */
function classifyStability(passes: number, failures: number): StabilityVerdict {
  if (passes > 0 && failures > 0) {
    return 'flaky';
  }
  if (failures > 0) {
    return 'real';
  }
  return 'recovered';
}

/**
 * Whether a stability judgement is genuinely ambiguous — a rare flip that could
 * be a real intermittent fault rather than test flakiness. The caller routes
 * these to the `test.flaky_judgement` Decision Pause instead of auto-quarantining
 * (issue #106 open decision #2). A clear flip (passed and failed in roughly equal
 * measure) is unambiguous; a single failure among many passes is the ambiguous case.
 */
export function isAmbiguousFlip(judgement: StabilityJudgement): boolean {
  if (judgement.verdict !== 'flaky') {
    return false;
  }
  // One lone failure (or one lone pass) among the re-runs is the rare-intermittent
  // case worth a human judgement; a balanced flip is clearly flaky.
  return judgement.failures === 1 || judgement.passes === 1;
}
