// Issue #121 — shared verdict → severity/outcome mappings so OCSF, ECS, and CEF
// grade the same verdict identically. A failing or blocked check is a finding a
// SOC wants surfaced; a pass is informational.

import type { SiemEvent } from './types.js';

/** OCSF `severity_id` (0 Unknown, 1 Informational, 3 Medium, 4 High). */
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
      return 1;
    default:
      return 0;
  }
}

/** OCSF `status_id` (0 Unknown, 1 Success, 2 Failure). */
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

/** ECS `event.outcome` (success | failure | unknown). */
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

/** CEF severity on its 0–10 scale. */
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
    default:
      return 0;
  }
}

/** Epoch milliseconds for an ISO timestamp; 0 when absent/unparseable. */
export function epochMs(ts: string): number {
  const parsed = Date.parse(ts);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** A short, human-readable headline shared by the OCSF/ECS `message` field. */
export function eventMessage(event: SiemEvent): string {
  if (event.kind === 'attestation') {
    const seal = event.sealed ? 'sealed' : 'BROKEN-chain';
    return `receipt ${event.verdict} (${seal}, ${event.signing_mode ?? 'unsigned'})`;
  }
  const engine = event.engine ? `${event.engine} ` : '';
  const grade = event.strength_class ? ` [${event.strength_class}]` : '';
  return `${engine}${event.code}: ${event.verdict}${grade}`;
}
