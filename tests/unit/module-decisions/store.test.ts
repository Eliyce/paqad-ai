import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  expireStaleDecisions,
  listDecisionIds,
  listDecisions,
  listDecisionsByState,
  nextDecisionId,
  readDecision,
  writeDecision,
} from '@/module-decisions/store.js';
import type { ModuleDecision } from '@/module-decisions/schema.js';

function makeDecision(over: Partial<ModuleDecision> = {}): ModuleDecision {
  return {
    id: 'MD-0001',
    state: 'proposed',
    proposed_slug: 'payments',
    proposed_name: 'Payments',
    proposed_layer: null,
    proposed_features: [],
    source_of_decision: {
      type: 'pasted-ticket',
      prompt_excerpt: 'foo',
      detected_at: '2026-05-28T00:00:00.000Z',
    },
    confidence: 'medium',
    reasoning: '',
    disposition: { collision_with: null, alternatives_offered: [] },
    created_at: '2026-05-28T00:00:00.000Z',
    updated_at: '2026-05-28T00:00:00.000Z',
    expires_at: '2026-06-04T00:00:00.000Z',
    approved_by: null,
    applied_to_map_at: null,
    applied_to_map_commit: null,
    events_log_ref: null,
    ...over,
  };
}

describe('module-decisions/store', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-store-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('nextDecisionId returns MD-0001 on empty directory', () => {
    expect(nextDecisionId(root)).toBe('MD-0001');
    expect(listDecisionIds(root)).toEqual([]);
  });

  it('writes, lists, and reads decisions round-trip', () => {
    const d = makeDecision({ id: 'MD-0001' });
    writeDecision(root, d);
    expect(listDecisionIds(root)).toEqual(['MD-0001']);
    const read = readDecision(root, 'MD-0001');
    expect(read?.id).toBe('MD-0001');
    expect(read?.proposed_slug).toBe('payments');
  });

  it('nextDecisionId increments past the highest existing ordinal', () => {
    writeDecision(root, makeDecision({ id: 'MD-0001' }));
    writeDecision(root, makeDecision({ id: 'MD-0005' }));
    writeDecision(root, makeDecision({ id: 'MD-0003' }));
    expect(nextDecisionId(root)).toBe('MD-0006');
  });

  it('listDecisionsByState filters correctly', () => {
    writeDecision(root, makeDecision({ id: 'MD-0001', state: 'proposed' }));
    writeDecision(root, makeDecision({ id: 'MD-0002', state: 'accepted' }));
    writeDecision(root, makeDecision({ id: 'MD-0003', state: 'rejected' }));
    expect(listDecisionsByState(root, 'proposed').map((d) => d.id)).toEqual(['MD-0001']);
    expect(listDecisionsByState(root, 'accepted').map((d) => d.id)).toEqual(['MD-0002']);
  });

  it('readDecision returns null when missing', () => {
    expect(readDecision(root, 'MD-9999')).toBeNull();
  });

  it('expireStaleDecisions moves only past-TTL proposed records', () => {
    writeDecision(
      root,
      makeDecision({ id: 'MD-0001', state: 'proposed', expires_at: '2026-05-01T00:00:00.000Z' }),
    );
    writeDecision(
      root,
      makeDecision({ id: 'MD-0002', state: 'proposed', expires_at: '2026-12-01T00:00:00.000Z' }),
    );
    writeDecision(
      root,
      makeDecision({ id: 'MD-0003', state: 'accepted', expires_at: '2026-05-01T00:00:00.000Z' }),
    );

    const moved = expireStaleDecisions(root, new Date('2026-06-01T00:00:00.000Z'));
    expect(moved).toEqual(['MD-0001']);

    expect(readDecision(root, 'MD-0001')?.state).toBe('expired');
    expect(readDecision(root, 'MD-0002')?.state).toBe('proposed');
    expect(readDecision(root, 'MD-0003')?.state).toBe('accepted');
  });

  it('rejects invalid ids', () => {
    expect(() => writeDecision(root, makeDecision({ id: 'not-an-id' }))).toThrow();
  });

  it('listDecisions returns all decisions parsed from disk', () => {
    writeDecision(root, makeDecision({ id: 'MD-0001' }));
    writeDecision(root, makeDecision({ id: 'MD-0002' }));
    expect(listDecisions(root).map((d) => d.id)).toEqual(['MD-0001', 'MD-0002']);
  });
});
