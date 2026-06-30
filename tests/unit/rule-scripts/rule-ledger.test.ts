import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  RULE_EVIDENCE_DOC_TYPE,
  readLatestRuleDrift,
  readLatestRuleFindings,
  recordRuleDrift,
  recordRuleFindings,
} from '@/rule-scripts/rule-ledger.js';
import { recordProjectEvent } from '@/session-ledger/project-ledger.js';

// Buildout F6 — rule-compliance evidence on the session-ledger. Two independent
// project-scoped kinds (findings + drift), each latest-wins.

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-rule-ledger-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe('rule-ledger', () => {
  it('is null for both kinds when nothing has been recorded', () => {
    const root = tempRoot();
    expect(readLatestRuleFindings(root)).toBeNull();
    expect(readLatestRuleDrift(root)).toBeNull();
  });

  it('records and reads back finding counts', () => {
    const root = tempRoot();
    recordRuleFindings(root, {
      counts: { deterministic: 3, heuristic: 1, skipped: 0 },
      blocking: true,
    });
    const ev = readLatestRuleFindings(root);
    expect(ev?.counts.deterministic).toBe(3);
    expect(ev?.blocking).toBe(true);
  });

  it('records and reads back drift state', () => {
    const root = tempRoot();
    recordRuleDrift(root, { blocked: true, counts: { 'RS-SCRIPT-STALE': 2 } });
    const ev = readLatestRuleDrift(root);
    expect(ev?.blocked).toBe(true);
    expect(ev?.counts['RS-SCRIPT-STALE']).toBe(2);
  });

  it('returns the latest row per kind without the kinds interfering', () => {
    const root = tempRoot();
    recordRuleFindings(root, {
      counts: { deterministic: 1, heuristic: 0, skipped: 0 },
      blocking: false,
    });
    recordRuleDrift(root, { blocked: false, counts: {} });
    recordRuleFindings(root, {
      counts: { deterministic: 0, heuristic: 0, skipped: 0 },
      blocking: false,
    });
    // Latest findings = the second findings row; drift unaffected.
    expect(readLatestRuleFindings(root)?.counts.deterministic).toBe(0);
    expect(readLatestRuleDrift(root)?.blocked).toBe(false);
  });

  it('tolerates a drift row with no counts (defensive — never crashes the reader)', () => {
    const root = tempRoot();
    // A corrupt/foreign row missing `counts` must read back as an empty map, not
    // undefined (so the dashboard never throws indexing it).
    recordProjectEvent(root, RULE_EVIDENCE_DOC_TYPE, { kind: 'drift', blocked: false });
    expect(readLatestRuleDrift(root)?.counts).toEqual({});
  });
});
