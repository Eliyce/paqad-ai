import type { SiemEvent } from './types.js';

export function ocsfSeverityId(verdict: string): number {
  switch (verdict) {
    case 'fail':
    case 'FAILED':
      return 4;
    case 'blocked':
    case 'inconclusive':
      return 3;
    case 'pass':
    case 'PASSED':
    case 'skipped':
      return 1;
    default:
      return 0;
  }
}

export function ocsfStatusId(verdict: string): number {
  switch (verdict) {
    case 'pass':
    case 'PASSED':
      return 1;
    case 'fail':
    case 'FAILED':
      return 2;
    default:
      return 0;
  }
}

export function ecsOutcome(verdict: string): 'success' | 'failure' | 'unknown' {
  switch (verdict) {
    case 'pass':
    case 'PASSED':
      return 'success';
    case 'fail':
    case 'FAILED':
      return 'failure';
    default:
      return 'unknown';
  }
}

export function cefSeverity(verdict: string): number {
  switch (verdict) {
    case 'fail':
    case 'FAILED':
      return 8;
    case 'blocked':
    case 'inconclusive':
      return 5;
    case 'pass':
    case 'PASSED':
      return 2;
    case 'skipped':
      return 1;
    default:
      return 0;
  }
}

export function epochMs(ts: string): number {
  const parsed = Date.parse(ts);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function eventMessage(event: SiemEvent): string {
  if (event.kind === 'attestation') {
    const seal = event.sealed ? 'sealed' : 'BROKEN-chain';
    return `receipt ${event.verdict} (${seal}, ${event.signing_mode ?? 'unsigned'})`;
  }
  if (event.kind === 'session') {
    const source = event.doc_type ?? event.code;
    return event.detail !== undefined
      ? `${source}: ${event.detail}`
      : `${source}: ${event.verdict}`;
  }
  const engine = event.engine ? `${event.engine} ` : '';
  const grade = event.strength_class ? ` [${event.strength_class}]` : '';
  return `${engine}${event.code}: ${event.verdict}${grade}`;
}
