import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { exportAuditEvents } from '@/audit/export';
import type { SiemFormat } from '@/audit/types';
import { appendEvidenceRows, buildEvidenceRow } from '@/evidence/ledger';
import { recordDecisionOpened } from '@/planning/decision-ledger';

function row(code: string, ts: string, detail?: string) {
  return buildEvidenceRow({
    ts,
    engine: 'verification-gate',
    code,
    subject_digest: 'subj',
    verdict: 'pass',
    strength_class: 'deterministic',
    ...(detail !== undefined ? { detail } : {}),
  });
}

describe('exportAuditEvents', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-audit-export-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns an empty, count-0 result when there is nothing to export', () => {
    const result = exportAuditEvents(root, { format: 'ocsf', productVersion: '1.0.0' });
    expect(result.count).toBe(0);
    expect(result.output).toBe('');
  });

  it('emits one line per event in every format', () => {
    appendEvidenceRows(root, [
      row('a', '2026-06-10T00:00:00.000Z'),
      row('b', '2026-06-10T01:00:00.000Z'),
    ]);
    for (const format of ['ocsf', 'ecs', 'cef', 'jsonl'] as SiemFormat[]) {
      const result = exportAuditEvents(root, { format, productVersion: '1.0.0' });
      expect(result.count).toBe(2);
      expect(result.output.split('\n')).toHaveLength(2);
      expect(result.output.endsWith('\n')).toBe(false); // no trailing newline
    }
  });

  it('jsonl is a canonical passthrough of the normalized event', () => {
    appendEvidenceRows(root, [row('mutation-testing', '2026-06-10T00:00:00.000Z', 'd')]);
    const result = exportAuditEvents(root, { format: 'jsonl', productVersion: '1.0.0' });
    const parsed = JSON.parse(result.output) as Record<string, unknown>;
    expect(parsed.kind).toBe('evidence');
    expect(parsed.code).toBe('mutation-testing');
    expect(parsed.detail).toBe('d');
  });

  it('exports a #249 session-ledger event with its doc type + session id (jsonl)', () => {
    recordDecisionOpened(root, {
      decisionId: 'D-1',
      category: 'scope',
      title: 'Reuse?',
      createdAt: '2026-06-20T00:00:00.000Z',
    });
    const result = exportAuditEvents(root, { format: 'jsonl', productVersion: '1.0.0' });
    const events = result.output
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const opened = events.find((e) => e.kind === 'session' && e.verdict === 'opened');
    expect(opened?.doc_type).toBe('decision-evidence');
    expect(opened?.session_id).toBe('_project');
    expect(opened?.detail).toBe('opened D-1');
  });

  it('--redact blanks a session event detail too', () => {
    recordDecisionOpened(root, {
      decisionId: 'D-secret',
      category: 'scope',
      title: 'Reuse?',
      createdAt: '2026-06-20T00:00:00.000Z',
    });
    const result = exportAuditEvents(root, {
      format: 'jsonl',
      redact: true,
      productVersion: '1.0.0',
    });
    expect(result.output).not.toContain('D-secret');
    const opened = result.output
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((e) => e.kind === 'session' && e.verdict === 'opened');
    expect(opened?.detail).toBe('[REDACTED]');
  });

  it('--since keeps only events at or after the cutoff and drops undated ones', () => {
    appendEvidenceRows(root, [
      row('old', '2026-06-01T00:00:00.000Z'),
      row('new', '2026-06-10T00:00:00.000Z'),
    ]);
    const result = exportAuditEvents(root, {
      format: 'jsonl',
      since: '2026-06-05T00:00:00.000Z',
      productVersion: '1.0.0',
    });
    expect(result.count).toBe(1);
    expect((JSON.parse(result.output) as Record<string, unknown>).code).toBe('new');
  });

  it('--redact blanks free-text detail before formatting', () => {
    appendEvidenceRows(root, [row('mutation-testing', '2026-06-10T00:00:00.000Z', 'token=secret')]);
    const result = exportAuditEvents(root, {
      format: 'jsonl',
      redact: true,
      productVersion: '1.0.0',
    });
    expect(result.output).not.toContain('secret');
    expect((JSON.parse(result.output) as Record<string, unknown>).detail).toBe('[REDACTED]');
  });
});
