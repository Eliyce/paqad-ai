import { readProjectProfile } from '@/core/project-profile.js';
import {
  DEFAULT_STABILITY_RERUNS,
  MAX_STABILITY_RERUNS,
  MIN_STABILITY_RERUNS,
  type StabilityJudgement,
  type StabilityRun,
  type StabilityVerdict,
} from '@/core/types/flaky.js';

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
  rerun: (attempt: number) => StabilityRun;
  reruns: number;
}

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

function classifyStability(passes: number, failures: number): StabilityVerdict {
  if (passes > 0 && failures > 0) {
    return 'flaky';
  }
  if (failures > 0) {
    return 'real';
  }
  return 'recovered';
}

export function isAmbiguousFlip(judgement: StabilityJudgement): boolean {
  if (judgement.verdict !== 'flaky') {
    return false;
  }
  return judgement.failures === 1 || judgement.passes === 1;
}
