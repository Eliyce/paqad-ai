import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { visualEvidenceGate, type VisualEvidenceGateInput } from '@/verification/gates/visual-evidence.js';
import type { VisualEvidenceManifest } from '@/visual-evidence/types.js';

let root: string;
const roots: string[] = [];
const DIR = '551-visual-evidence-01JABCDEFGHJKMNPQRSTVWXYZ0';

function bundleDir(): string {
  return join(root, '.paqad', 'ledger', 'feature-evidence', DIR);
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Write a captured screenshot and return its {bytes, sha256}. */
function writeShot(dir: string, content: string): { bytes: number; sha256: string } {
  const abs = join(bundleDir(), 'screenshots', dir);
  mkdirSync(abs, { recursive: true });
  const buf = Buffer.from(content);
  writeFileSync(join(abs, 'image.png'), buf);
  writeFileSync(join(abs, 'caption.txt'), 'cap\n');
  return { bytes: buf.length, sha256: sha256(buf) };
}

function writeManifest(m: VisualEvidenceManifest): void {
  mkdirSync(bundleDir(), { recursive: true });
  writeFileSync(join(bundleDir(), 'visual-evidence.json'), JSON.stringify(m), 'utf8');
}

function baseManifest(): VisualEvidenceManifest {
  return {
    schema_version: 1,
    doc_type: 'paqad.visual-evidence',
    generated_at: '2026-09-11T00:00:00.000Z',
    content_hash: 'x',
    trigger: { changed_files: ['src/a.tsx'], matched_globs: ['src/**/*.{jsx,tsx}'], packs: ['react'] },
    plan: [{ journey_id: 'j', capture_script: 'docs/site-map/journeys/j.capture.yaml', matched_by: [] }],
    steps: [],
    gif: null,
    skips: [],
    result: 'captured',
  };
}

function input(overrides: Partial<VisualEvidenceGateInput> = {}): VisualEvidenceGateInput {
  return {
    projectRoot: root,
    dirName: DIR,
    mode: 'warn',
    origin: 'hook-completion',
    isFeatureDev: true,
    flagOn: true,
    frontendTriggered: true,
    ...overrides,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-vegate-'));
  roots.push(root);
});
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('visualEvidenceGate — applicability', () => {
  it('returns null when not feature-dev or no active bundle', () => {
    expect(visualEvidenceGate(input({ isFeatureDev: false }))).toBeNull();
    expect(visualEvidenceGate(input({ dirName: null }))).toBeNull();
  });

  it('is skipped when the flag is off', () => {
    const gate = visualEvidenceGate(input({ flagOn: false }))!;
    expect(gate.status).toBe('skipped');
    expect(gate.detail).toContain('off');
  });

  it('is skipped (informational) on a non-local origin', () => {
    const gate = visualEvidenceGate(input({ origin: 'ci-backstop' }))!;
    expect(gate.status).toBe('skipped');
  });

  it('is skipped with not-frontend when the change is not frontend-triggering', () => {
    const gate = visualEvidenceGate(input({ frontendTriggered: false }))!;
    expect(gate.status).toBe('skipped');
    expect(gate.detail).toContain('not-frontend');
  });
});

describe('visualEvidenceGate — manifest outcomes', () => {
  it('is inconclusive under warn and fail under strict when the manifest is absent on a frontend change', () => {
    expect(visualEvidenceGate(input({ mode: 'warn' }))!.status).toBe('inconclusive');
    expect(visualEvidenceGate(input({ mode: 'strict' }))!.status).toBe('fail');
  });

  it('is environmental when the manifest fails its schema', () => {
    writeManifest({ ...baseManifest(), result: 'nope' } as unknown as VisualEvidenceManifest);
    expect(visualEvidenceGate(input({ mode: 'warn' }))!.status).toBe('inconclusive');
    expect(visualEvidenceGate(input({ mode: 'strict' }))!.status).toBe('fail');
  });

  it('passes on a captured run with verified hashes', () => {
    const shot = writeShot('01-open', 'PNGDATA-1');
    const m = baseManifest();
    m.steps = [
      {
        index: 1,
        journey_id: 'j',
        journey_step: 1,
        caption: 'Open',
        dir: 'screenshots/01-open',
        captured_at: '2026-09-11T00:00:01.000Z',
        image_sha256: shot.sha256,
        image_bytes: shot.bytes,
        status: 'captured',
      },
    ];
    writeManifest(m);
    const gate = visualEvidenceGate(input())!;
    expect(gate.status).toBe('pass');
    expect(gate.detail).toContain('1 step(s) captured');
  });

  it('is environmental when a captured file hash does not match', () => {
    writeShot('01-open', 'PNGDATA-1');
    const m = baseManifest();
    m.steps = [
      {
        index: 1,
        journey_id: 'j',
        journey_step: 1,
        caption: 'Open',
        dir: 'screenshots/01-open',
        captured_at: '2026-09-11T00:00:01.000Z',
        image_sha256: 'deadbeef',
        image_bytes: 999,
        status: 'captured',
      },
    ];
    writeManifest(m);
    expect(visualEvidenceGate(input({ mode: 'strict' }))!.status).toBe('fail');
  });

  it('is skipped for a documented-skip-only manifest', () => {
    const m = baseManifest();
    m.result = 'skipped';
    m.plan = [];
    m.skips = [{ reason: 'no-documented-flow', detail: 'x' }];
    writeManifest(m);
    const warn = visualEvidenceGate(input({ mode: 'warn' }))!;
    const strict = visualEvidenceGate(input({ mode: 'strict' }))!;
    expect(warn.status).toBe('skipped');
    expect(strict.status).toBe('skipped');
    expect(warn.detail).toContain('no-documented-flow');
  });

  it('is environmental for a skipped manifest with an environmental reason', () => {
    const m = baseManifest();
    m.result = 'skipped';
    m.skips = [{ reason: 'playwright-not-provisioned', detail: 'x' }];
    writeManifest(m);
    expect(visualEvidenceGate(input({ mode: 'warn' }))!.status).toBe('inconclusive');
    expect(visualEvidenceGate(input({ mode: 'strict' }))!.status).toBe('fail');
  });

  it('is environmental for a partial result (a failed step)', () => {
    const m = baseManifest();
    m.result = 'partial';
    m.steps = [
      {
        index: 1,
        journey_id: 'j',
        journey_step: 1,
        caption: 'Open',
        dir: '',
        captured_at: '2026-09-11T00:00:01.000Z',
        status: 'failed',
        failure: 'selector-not-found',
      },
    ];
    writeManifest(m);
    expect(visualEvidenceGate(input({ mode: 'warn' }))!.status).toBe('inconclusive');
    expect(visualEvidenceGate(input({ mode: 'strict' }))!.status).toBe('fail');
  });

  it('names visual-proof acceptance criteria from the frozen spec', () => {
    const shot = writeShot('01-open', 'PNGDATA-1');
    const m = baseManifest();
    m.steps = [
      {
        index: 1,
        journey_id: 'j',
        journey_step: 1,
        caption: 'Open',
        dir: 'screenshots/01-open',
        captured_at: '2026-09-11T00:00:01.000Z',
        image_sha256: shot.sha256,
        image_bytes: shot.bytes,
        status: 'captured',
      },
    ];
    writeManifest(m);
    writeFileSync(
      join(bundleDir(), 'specification.json'),
      JSON.stringify({ acceptance_criteria: [{ id: 'AC-12', proof_type: 'visual' }, { id: 'AC-1', proof_type: 'automated' }] }),
      'utf8',
    );
    const gate = visualEvidenceGate(input())!;
    expect(gate.detail).toContain('AC-12');
    expect(gate.detail).not.toContain('AC-1,');
  });
});
