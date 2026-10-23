export class EvalResultError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EvalResultError';
  }
}

const mean = (values) =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

const MAX_TURNS_STOP = /Reached maximum number of turns/;

function isGradedMaxTurnsStop(run) {
  return (
    typeof run.error === 'string' &&
    MAX_TURNS_STOP.test(run.error) &&
    Array.isArray(run.graders) &&
    run.graders.length > 0
  );
}

function runScore(run, where) {
  if (run === null || typeof run !== 'object') {
    throw new EvalResultError(`${where} is not a run object`);
  }
  if (
    run.error !== null &&
    run.error !== undefined &&
    run.error !== '' &&
    !isGradedMaxTurnsStop(run)
  ) {
    return 0;
  }
  if (typeof run.score !== 'number') {
    throw new EvalResultError(`${where} has no numeric "score"`);
  }
  return run.score;
}

function countGraders(runs, arm, counts) {
  for (const run of runs) {
    for (const grader of Array.isArray(run.graders) ? run.graders : []) {
      const entry = (counts[grader.name] ??= {
        with: { passed: 0, total: 0 },
        without: { passed: 0, total: 0 },
      });
      entry[arm].total += 1;
      if (grader.passed === true) entry[arm].passed += 1;
    }
  }
}

export function suiteScore(result) {
  if (result === null || typeof result !== 'object') {
    throw new EvalResultError('the result is not a JSON object');
  }
  if (typeof result.partial !== 'boolean') {
    throw new EvalResultError('the result has no boolean "partial" field');
  }
  if (!Array.isArray(result.cases)) {
    throw new EvalResultError('the result has no "cases" array');
  }
  const graders = {};
  const cases = result.cases.map((item, index) => {
    const name = typeof item?.name === 'string' ? item.name : `cases[${index}]`;
    const withRuns = item?.arms?.with;
    if (!Array.isArray(withRuns)) {
      throw new EvalResultError(`${name} has no "arms.with" array`);
    }
    const withoutRuns = Array.isArray(item.arms.without) ? item.arms.without : [];
    countGraders(withRuns, 'with', graders);
    countGraders(withoutRuns, 'without', graders);
    return {
      name,
      withMean: mean(withRuns.map((run, i) => runScore(run, `${name} arms.with[${i}]`))) ?? 0,
      withoutMean: mean(withoutRuns.map((run, i) => runScore(run, `${name} arms.without[${i}]`))),
    };
  });
  const withoutMeans = cases.map((item) => item.withoutMean).filter((value) => value !== null);
  return {
    partial: result.partial,
    partialReason: typeof result.partialReason === 'string' ? result.partialReason : null,
    cases,
    graders,
    withMean: mean(cases.map((item) => item.withMean)),
    withoutMean: withoutMeans.length === cases.length ? mean(withoutMeans) : null,
  };
}

export function judgeSuite(score, min) {
  if (score.partial) {
    return {
      ok: false,
      reason: `partial result${score.partialReason ? `: ${score.partialReason}` : ''}`,
    };
  }
  if (score.cases.length === 0 || score.withMean === null) {
    return { ok: false, reason: 'no cases' };
  }
  if (score.withMean < min - 1e-9) {
    return { ok: false, reason: `with-plugin mean is under ${min}` };
  }
  return { ok: true, reason: null };
}

const fixed = (value) => (value === null ? 'n/a' : value.toFixed(2));

export function formatSuite(suite, score, verdict, gated) {
  const state = !gated ? 'REPORTED' : verdict.ok ? 'PASS' : 'FAIL';
  const lines = [
    `${suite}: with ${fixed(score.withMean)}, without ${fixed(score.withoutMean)} over ${score.cases.length} cases, ${state}${verdict.reason ? ` (${verdict.reason})` : ''}`,
  ];
  for (const [name, counts] of Object.entries(score.graders)) {
    lines.push(
      `  grader ${name}: with ${counts.with.passed}/${counts.with.total}, without ${counts.without.passed}/${counts.without.total}`,
    );
  }
  for (const item of score.cases) {
    if (item.withMean < 1) {
      lines.push(
        `  below 1.0: ${item.name} with ${fixed(item.withMean)}, without ${fixed(item.withoutMean)}`,
      );
    }
  }
  return lines;
}
