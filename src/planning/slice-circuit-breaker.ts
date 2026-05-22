import type { SliceGateDetail } from './slice-gate.js';

const DEFAULT_THRESHOLD = 3;

export class SliceCircuitBreaker {
  private lastSignature: string | null = null;
  private consecutive = 0;

  constructor(private readonly threshold = DEFAULT_THRESHOLD) {}

  observe(gate: SliceGateDetail): boolean {
    const signature = failureSignature(gate);
    if (signature === null) {
      this.reset();
      return false;
    }

    if (signature === this.lastSignature) {
      this.consecutive += 1;
    } else {
      this.lastSignature = signature;
      this.consecutive = 1;
    }

    return this.consecutive >= this.threshold;
  }

  reset(): void {
    this.lastSignature = null;
    this.consecutive = 0;
  }
}

function failureSignature(gate: SliceGateDetail): string | null {
  const failingCriteria = gate.criteria_checks
    .filter((check) => !check.passed)
    .map((check) => check.criterion_id);
  const failingRegression = gate.regression_checks
    .filter((check) => !check.passed)
    .map((check) => check.entry_id);
  const scope = gate.scope_check.violations.map(
    (violation) => `${violation.type}:${violation.file}`,
  );
  const suite = gate.full_suite_check.new_failures;
  const parts = [...failingCriteria, ...failingRegression, ...scope, ...suite].sort();
  return parts.length > 0 ? parts.join('|') : null;
}
