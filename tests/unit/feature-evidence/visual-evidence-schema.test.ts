import { describe, expect, it } from 'vitest';

import {
  VISUAL_EVIDENCE_SCHEMA,
  validateVisualEvidenceRecord,
} from '@/feature-evidence/schema.js';
import type { VisualEvidenceManifest } from '@/visual-evidence/types.js';

function validManifest(): VisualEvidenceManifest {
  return {
    schema_version: 1,
    doc_type: 'paqad.visual-evidence',
    generated_at: '2026-09-11T10:00:00.000Z',
    content_hash: 'abc123',
    trigger: {
      changed_files: ['src/pages/Goals.tsx'],
      matched_globs: ['src/**/*.{jsx,tsx}'],
      packs: ['react'],
    },
    plan: [
      {
        journey_id: 'checkout',
        capture_script: 'docs/site-map/journeys/checkout.capture.yaml',
        matched_by: [{ file: 'src/pages/Goals.tsx', surface: 'goals', module: 'goals' }],
      },
    ],
    steps: [
      {
        index: 1,
        journey_id: 'checkout',
        journey_step: 1,
        caption: 'Open the cart',
        dir: 'screenshots/01-open-the-cart',
        route: '/cart',
        captured_at: '2026-09-11T10:00:01.000Z',
        image_sha256: 'deadbeef',
        image_bytes: 1234,
        status: 'captured',
      },
    ],
    gif: {
      file: 'screenshots/overview.gif',
      frames: 1,
      frame_ms: 2000,
      sha256: 'cafef00d',
      bytes: 999,
    },
    skips: [],
    result: 'captured',
  };
}

describe('validateVisualEvidenceRecord', () => {
  it('has the expected $id', () => {
    expect(VISUAL_EVIDENCE_SCHEMA.$id).toBe('paqad://schemas/visual-evidence.json');
  });

  it('accepts a well-formed manifest', () => {
    expect(validateVisualEvidenceRecord(validManifest())).toEqual([]);
  });

  it('accepts a null gif and a failed step with a failure detail', () => {
    const m = validManifest();
    m.gif = null;
    m.result = 'partial';
    m.steps[0]!.status = 'failed';
    m.steps[0]!.failure = 'selector #cart not found';
    delete m.steps[0]!.image_sha256;
    delete m.steps[0]!.image_bytes;
    expect(validateVisualEvidenceRecord(m)).toEqual([]);
  });

  it('accepts a skip-only manifest', () => {
    const m = validManifest();
    m.plan = [];
    m.steps = [];
    m.gif = null;
    m.skips = [{ reason: 'no-documented-flow', detail: 'no confirmed journey matched' }];
    m.result = 'skipped';
    expect(validateVisualEvidenceRecord(m)).toEqual([]);
  });

  it('rejects an unknown skip reason', () => {
    const m = validManifest() as unknown as { skips: Array<{ reason: string; detail: string }> };
    m.skips = [{ reason: 'made-up', detail: 'x' }];
    expect(validateVisualEvidenceRecord(m).length).toBeGreaterThan(0);
  });

  it('rejects an unknown top-level key', () => {
    const m = { ...validManifest(), surprise: true };
    expect(validateVisualEvidenceRecord(m).length).toBeGreaterThan(0);
  });

  it('rejects a wrong doc_type and a wrong schema_version', () => {
    expect(validateVisualEvidenceRecord({ ...validManifest(), doc_type: 'nope' }).length).toBeGreaterThan(0);
    expect(validateVisualEvidenceRecord({ ...validManifest(), schema_version: 2 }).length).toBeGreaterThan(0);
  });

  it('rejects a step with an unknown status', () => {
    const m = validManifest() as unknown as { steps: Array<{ status: string }> };
    m.steps[0]!.status = 'weird';
    expect(validateVisualEvidenceRecord(m).length).toBeGreaterThan(0);
  });
});
