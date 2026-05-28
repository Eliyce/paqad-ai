import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectModuleDecisions } from '@/dashboard/collectors/module-decisions';
import { writeDecision } from '@/module-decisions/store';
import { formatDecisionId, ttlExpiresAt } from '@/module-decisions/schema';
import type { ModuleDecision } from '@/module-decisions/schema';

function makeDecision(
  ord: number,
  state: ModuleDecision['state'],
  opts: { createdAt?: Date; expiresAt?: string } = {},
): ModuleDecision {
  const created = opts.createdAt ?? new Date('2026-05-20T00:00:00Z');
  return {
    id: formatDecisionId(ord),
    state,
    proposed_slug: `mod-${ord}`,
    proposed_name: `Module ${ord}`,
    proposed_layer: 'cli-commands',
    proposed_features: [],
    source_of_decision: {
      type: 'inferred-from-prompt',
      prompt_excerpt: '',
      detected_at: created.toISOString(),
    },
    confidence: 'medium',
    reasoning: '',
    disposition: { collision_with: null, alternatives_offered: [] },
    created_at: created.toISOString(),
    updated_at: created.toISOString(),
    expires_at: opts.expiresAt ?? ttlExpiresAt(created),
    approved_by: null,
    applied_to_map_at: null,
    applied_to_map_commit: null,
    events_log_ref: null,
  };
}

describe('collectModuleDecisions', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-md-coll-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns unknown band when no decisions exist', () => {
    const result = collectModuleDecisions(root);
    expect(result.section.band).toBe('unknown');
    expect(result.section.score).toBeNull();
    expect(result.attention).toEqual([]);
    expect(result.expiredIds).toEqual([]);
  });

  it('treats TTL-passed proposed entries as expired even before sweep', () => {
    writeDecision(
      root,
      makeDecision(1, 'proposed', {
        createdAt: new Date('2026-05-01T00:00:00Z'),
      }),
    );
    // 2026-05-28 is well past the 7-day TTL from May 1.
    const result = collectModuleDecisions(root, Date.parse('2026-05-28T00:00:00Z'));
    expect(result.expiredIds).toEqual(['MD-0001']);
    expect(result.section.score).toBe(88);
  });

  it('counts pending separately from expired and produces an attention item per expired entry', () => {
    writeDecision(
      root,
      makeDecision(1, 'proposed', { createdAt: new Date('2026-05-27T00:00:00Z') }),
    );
    writeDecision(
      root,
      makeDecision(2, 'proposed', { createdAt: new Date('2026-05-01T00:00:00Z') }),
    );
    writeDecision(
      root,
      makeDecision(3, 'accepted', { createdAt: new Date('2026-05-15T00:00:00Z') }),
    );

    const result = collectModuleDecisions(root, Date.parse('2026-05-28T00:00:00Z'));
    expect(result.section.metrics).toEqual([
      { label: 'pending', value: '1' },
      { label: 'expired', value: '1' },
      { label: 'accepted', value: '1' },
    ]);
    expect(result.expiredIds).toEqual(['MD-0002']);
    const expiredMsg = result.attention.find((a) => a.message.includes('MD-0002'));
    expect(expiredMsg).toBeDefined();
    expect(expiredMsg?.severity).toBe('warn');
  });

  it('flat-lines at 100 when only accepted decisions are on disk', () => {
    writeDecision(root, makeDecision(1, 'accepted'));
    const result = collectModuleDecisions(root, Date.parse('2026-05-28T00:00:00Z'));
    expect(result.section.score).toBe(100);
    expect(result.section.band).toBe('green');
    expect(result.expiredIds).toEqual([]);
  });
});
