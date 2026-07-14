import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { HEALTH_RUN_DOC_TYPE, recordHealthRun } from '@/codebase-health/ledger.js';
import { readAllSessionRows } from '@/session-ledger/ledger.js';

function repo(): string {
  return mkdtempSync(join(tmpdir(), 'hl-ledger-'));
}

const summary = {
  report_id: 'HEALTH-2026',
  workflow: 'codebase-health',
  offline: true,
  finding_count: 2,
  blocked_count: 1,
  new_since_baseline: 2,
  pre_existing: 0,
};

describe('recordHealthRun', () => {
  it('writes a codebase-health-run row on the shared session ledger', () => {
    const root = repo();
    const result = recordHealthRun(root, summary, {
      sessionId: 's-1',
      now: () => new Date(2026, 0, 1),
    });
    expect(result).not.toBeNull();
    const rows = readAllSessionRows(root, HEALTH_RUN_DOC_TYPE);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.report_id).toBe('HEALTH-2026');
    expect(rows[0]!.event_status).toBe('findings');
  });

  it('is best-effort and never throws on a bad root', () => {
    expect(() => recordHealthRun('\0not-a-real-path', summary)).not.toThrow();
  });
});
