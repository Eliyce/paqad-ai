import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { DetectionReport } from '@/core/types/health.js';
import { toStackDetectionResource } from '@/detection/types';

function reportFixture(overrides: Partial<DetectionReport> = {}): DetectionReport {
  return {
    detected_domain: 'coding',
    detected_stack: 'react',
    detected_capabilities: [],
    matched_packs: ['react'],
    detected_traits: [],
    recommended_capabilities: ['content', 'coding', 'security'],
    detection_phase: 'framework',
    confidence: 'high',
    confidence_score: 0.92,
    primary_language: 'JavaScript/TypeScript',
    source: 'static',
    signals: [],
    timestamp: '2026-06-09T09:52:23.000Z',
    ...overrides,
  };
}

describe('toStackDetectionResource', () => {
  it('populates all seven ModelResource envelope fields', () => {
    const resource = toStackDetectionResource(reportFixture(), { projectRoot: '/tmp/app' });

    expect(resource.type).toBe('stack_detection');
    expect(resource.id).toMatch(/^[0-9a-f]{64}$/u);
    expect(resource.created_at).toBe('2026-06-09T09:52:23.000Z');
    expect(resource.updated_at).toBe('2026-06-09T09:52:23.000Z');
    expect(resource.created_at_human).toBe('2026-06-09 09:52 UTC');
    expect(resource.updated_at_human).toBe('2026-06-09 09:52 UTC');
    expect(resource.permissions).toEqual({ can_view: true, can_edit: false, can_delete: false });
    expect(resource.report.detected_stack).toBe('react');
  });

  it('derives a deterministic id from projectRoot + timestamp', () => {
    const report = reportFixture();
    const a = toStackDetectionResource(report, { projectRoot: '/tmp/app' });
    const b = toStackDetectionResource(report, { projectRoot: '/tmp/app' });
    const expected = createHash('sha256')
      .update('/tmp/app::2026-06-09T09:52:23.000Z')
      .digest('hex');

    expect(a.id).toBe(expected);
    expect(b.id).toBe(a.id);
    expect(toStackDetectionResource(report, { projectRoot: '/other' }).id).not.toBe(a.id);
  });

  it('defaults projectRoot to empty and merges permission overrides', () => {
    const resource = toStackDetectionResource(reportFixture(), {
      permissions: { can_edit: true },
    });

    expect(resource.id).toBe(
      createHash('sha256').update('::2026-06-09T09:52:23.000Z').digest('hex'),
    );
    expect(resource.permissions).toEqual({ can_view: true, can_edit: true, can_delete: false });
  });

  it('falls back to the raw timestamp when it is not a parseable date', () => {
    const resource = toStackDetectionResource(reportFixture({ timestamp: 'not-a-date' }));

    expect(resource.created_at_human).toBe('not-a-date');
    expect(resource.updated_at_human).toBe('not-a-date');
  });
});
