import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { HealthFinding } from '@/core/types/codebase-health.js';
import {
  assignHealthFindingIds,
  findingFingerprint,
  sortFindings,
  toHealthReportId,
  toHealthTimestamp,
  writeJsonFile,
} from '@/codebase-health/shared.js';

function candidate(overrides: Partial<Omit<HealthFinding, 'id'>> = {}): Omit<HealthFinding, 'id'> {
  return {
    title: 'Unused dependency: left-pad',
    description: 'why',
    category: 'unused-dependency',
    severity: 'low',
    tier: 'deterministic',
    confidence: 0.85,
    evidence: ['e1'],
    suggestion: { action: 'remove', detail: 'drop it' },
    affected_files: [],
    affected_packages: ['left-pad'],
    requires_network: false,
    baseline_status: 'unknown',
    status: 'open',
    ...overrides,
  };
}

describe('toHealthTimestamp / toHealthReportId', () => {
  it('zero-pads every field', () => {
    const ts = toHealthTimestamp(new Date(2026, 0, 2, 3, 4, 5));
    expect(ts).toBe('2026-01-02-03-04-05');
  });

  it('prefixes the report id', () => {
    const date = new Date(2026, 6, 14, 9, 0, 0);
    expect(toHealthReportId('HEALTH', date)).toBe(`HEALTH-${toHealthTimestamp(date)}`);
    expect(toHealthReportId('RETEST', date)).toBe(`RETEST-${toHealthTimestamp(date)}`);
  });
});

describe('findingFingerprint / assignHealthFindingIds', () => {
  it('is stable for identical identity fields', () => {
    expect(findingFingerprint(candidate())).toBe(findingFingerprint(candidate()));
  });

  it('sorts affected files/packages so order does not change the fingerprint', () => {
    const a = findingFingerprint(candidate({ affected_files: ['a', 'b'] }));
    const b = findingFingerprint(candidate({ affected_files: ['b', 'a'] }));
    expect(a).toBe(b);
  });

  it('assigns HL- ids and suffixes collisions', () => {
    const withIds = assignHealthFindingIds([candidate(), candidate(), candidate({ title: 'x' })]);
    expect(withIds[0]!.id).toMatch(/^HL-[0-9A-F]{8}$/);
    expect(withIds[1]!.id).toMatch(/^HL-[0-9A-F]{8}-02$/);
    expect(withIds[2]!.id).not.toBe(withIds[0]!.id);
  });
});

describe('sortFindings', () => {
  it('orders high before medium before low, then by id', () => {
    const findings = assignHealthFindingIds([
      candidate({ severity: 'low', title: 'z-low' }),
      candidate({ severity: 'high', title: 'a-high' }),
      candidate({ severity: 'medium', title: 'm-med' }),
    ]).map((finding) => finding as HealthFinding);
    const sorted = sortFindings(findings);
    expect(sorted.map((f) => f.severity)).toEqual(['high', 'medium', 'low']);
  });

  it('breaks severity ties by id', () => {
    const findings = assignHealthFindingIds([
      candidate({ severity: 'low', title: 'one' }),
      candidate({ severity: 'low', title: 'two' }),
    ]).map((finding) => finding as HealthFinding);
    const sorted = sortFindings(findings);
    expect(sorted[0]!.id.localeCompare(sorted[1]!.id)).toBeLessThan(0);
  });
});

describe('writeJsonFile', () => {
  it('creates parent dirs and writes pretty JSON with a trailing newline', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hl-shared-'));
    const target = join(dir, 'nested', 'out.json');
    await writeJsonFile(target, { a: 1 });
    const raw = readFileSync(target, 'utf8');
    expect(raw).toBe('{\n  "a": 1\n}\n');
  });
});
