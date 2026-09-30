import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { documentHashMatches, rowHashMatches } from '@/feature-evidence/envelope.js';
import { discoveryRunFilePath } from '@/discovery/paths.js';
import { openDiscoveryRun } from '@/discovery/run-store.js';
import { DISCOVERY_DOC_TYPES } from '@/discovery/types.js';
import {
  appendBlocker,
  appendContextReceipt,
  appendContribution,
  appendSource,
  writeBrief,
  writeDecisions,
  writeHandoff,
  writeReadiness,
  writeSynthesis,
  type DiscoveryWriteContext,
} from '@/discovery/writers.js';

const roots: string[] = [];
function ctx(): DiscoveryWriteContext & { root: string } {
  const root = mkdtempSync(join(tmpdir(), 'paqad-discovery-writers-'));
  roots.push(root);
  const { dirName } = openDiscoveryRun(root, {
    sessionId: 'sess-A',
    title: 'idea',
    adapter: 'claude-code',
  });
  return { projectRoot: root, dirName, sessionId: 'sess-A', root };
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function readJson(root: string, path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, path), 'utf8')) as Record<string, unknown>;
}
function readJsonl(root: string, path: string): Record<string, unknown>[] {
  return readFileSync(join(root, path), 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('discovery writers — JSON documents', () => {
  it('writes an envelope-stamped brief whose hash verifies', () => {
    const c = ctx();
    const rec = writeBrief(c, {
      revision: 1,
      intent: 'export invoices in bulk',
      facts: ['finance team asked'],
      interpretations: ['maybe monthly'],
      success: ['under 10s for 1000 rows'],
      constraints: ['read-only'],
      open_questions: ['which format?'],
      assignments: ['research CSV vs XLSX libraries'],
    });
    expect(rec.doc_type).toBe(DISCOVERY_DOC_TYPES.brief);
    const onDisk = readJson(c.root, discoveryRunFilePath(c.dirName, 'brief'));
    expect(documentHashMatches(onDisk)).toBe(true);
    expect(onDisk.intent).toBe('export invoices in bulk');
  });

  it('writes synthesis, decisions, readiness, and handoff with matching hashes', () => {
    const c = ctx();
    writeSynthesis(c, {
      revision: 1,
      summary: 's',
      complementary: [],
      conflicts: [],
      recommendation: 'reuse existing exporter',
      alternatives: ['build new'],
    });
    writeDecisions(c, {
      revision: 1,
      decisions: [{ id: 'D-1', category: 'create-vs-reuse', chosen: 'reuse', rationale: 'exists' }],
    });
    writeReadiness(c, {
      revision: 1,
      outcome: 'development',
      verdict: 'ready',
      blockers: [],
      owners: [],
    });
    writeHandoff(c, {
      revision: 1,
      outcome: 'development',
      value: 'v',
      scope: 'first slice',
      success: ['s'],
      constraints: [],
      scenarios: ['happy path'],
      decisions: ['D-1'],
      open_work: [],
      next_action: 'open a feature',
      authorization: 'owner approved',
    });
    for (const file of ['synthesis', 'decisions', 'readiness', 'handoff'] as const) {
      expect(documentHashMatches(readJson(c.root, discoveryRunFilePath(c.dirName, file)))).toBe(
        true,
      );
    }
  });
});

describe('discovery writers — JSONL rows', () => {
  it('appends source, contribution, context-receipt, and blocker rows whose hashes verify', () => {
    const c = ctx();
    appendSource(c, {
      source_id: 'S1',
      title: 'xlsx docs',
      reference: 'https://example.test/xlsx',
      kind: 'fact',
      retrieved_at: '2026-09-30',
      finding: 'supports streaming',
      uncertainty: null,
      counterevidence: null,
    });
    appendSource(c, {
      source_id: 'S2',
      title: 'internal exporter',
      reference: null,
      kind: 'fact',
      retrieved_at: '2026-09-30',
      finding: 'already exports CSV',
      uncertainty: 'untested at 1000 rows',
      counterevidence: null,
    });
    appendContribution(c, {
      expert_role: 'application-architect',
      expert_version: null,
      assignment: 'reuse vs build',
      findings: ['reuse the exporter'],
      references: ['S2'],
      uncertainty: null,
      conflicts: [],
      status: 'complete',
    });
    appendContextReceipt(c, {
      stage: 'investigate',
      items: ['docs/modules/export.md'],
      mode: 'read',
      reason: null,
    });
    appendBlocker(c, {
      stage: 'check_readiness',
      description: 'perf unverified',
      owner: 'perf-team',
      resolved: false,
    });

    const sources = readJsonl(c.root, discoveryRunFilePath(c.dirName, 'sources'));
    expect(sources).toHaveLength(2);
    expect(sources.every((r) => rowHashMatches(r) === true)).toBe(true);
    expect(sources[0]!.doc_type).toBe(DISCOVERY_DOC_TYPES.source);

    const contribs = readJsonl(c.root, discoveryRunFilePath(c.dirName, 'contributions'));
    expect(contribs).toHaveLength(1);
    expect(rowHashMatches(contribs[0]!)).toBe(true);

    expect(
      rowHashMatches(readJsonl(c.root, discoveryRunFilePath(c.dirName, 'contextReceipts'))[0]!),
    ).toBe(true);
    expect(rowHashMatches(readJsonl(c.root, discoveryRunFilePath(c.dirName, 'blockers'))[0]!)).toBe(
      true,
    );
  });
});
