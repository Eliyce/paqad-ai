import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { featureDir, featureFilePath } from '@/feature-evidence/paths.js';
import { visualEvidenceGate } from '@/verification/gates/visual-evidence.js';
import { attachVisualEvidence, VisualEvidenceAttachError } from '@/visual-evidence/attach.js';
import {
  copyAttachedStepDirs,
  mergeAttachedSteps,
  mergedVisualEvidenceResult,
  readAttachedSteps,
  readVisualEvidenceManifest,
  stepDirSlug,
  uniqueSlug,
  writeVisualEvidenceManifest,
} from '@/visual-evidence/manifest.js';
import { runVisualEvidence } from '@/visual-evidence/runner.js';
import type { VeStep, VisualEvidenceManifest } from '@/visual-evidence/types.js';

const DIR = '579-attach-01JABCDEFGHJKMNPQRSTVWXYZ0';
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const AT = '2026-09-24T00:00:00.000Z';
const now = () => AT;

let root: string;
let shots: string;

function png(name: string, body: string): string {
  const path = join(shots, name);
  writeFileSync(path, Buffer.concat([PNG_HEADER, Buffer.from(body)]));
  return path;
}

function sha(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function bundleFile(rel: string): string {
  return join(root, featureDir(DIR), rel);
}

function manifestPath(): string {
  return join(root, featureFilePath(DIR, 'visualEvidence'));
}

function strictGate() {
  return visualEvidenceGate({
    projectRoot: root,
    dirName: DIR,
    mode: 'strict',
    origin: 'hook-completion',
    isFeatureDev: true,
    flagOn: true,
    frontendTriggered: true,
  })!;
}

function documentedSkipManifest(): void {
  writeVisualEvidenceManifest(root, DIR, {
    trigger: { changed_files: ['src/a.tsx'], matched_globs: ['src/**/*.tsx'], packs: ['react'] },
    plan: [],
    steps: [],
    gif: null,
    skips: [{ reason: 'no-documented-flow', detail: 'no journey anchors src/a.tsx' }],
    result: 'skipped',
    now,
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-ve-attach-'));
  shots = mkdtempSync(join(tmpdir(), 'paqad-ve-shots-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(shots, { recursive: true, force: true });
});

describe('attachVisualEvidence (issue #579, FR-11)', () => {
  it('writes a new agent-attached manifest with numbered folders, captions and hashes', () => {
    const first = png('Cart page.png', 'one');
    const second = png('checkout.PNG', 'two');

    const result = attachVisualEvidence({
      projectRoot: root,
      dirName: DIR,
      files: [first, second],
      now,
    });

    const manifest = result.manifest!;
    expect(manifest.result).toBe('captured');
    expect(manifest.source).toBe('agent-attached');
    expect(manifest.steps.map((s) => [s.index, s.dir, s.caption, s.journey_id])).toEqual([
      [1, 'screenshots/01-cart-page', 'Cart page', 'agent-attached'],
      [2, 'screenshots/02-checkout', 'checkout', 'agent-attached'],
    ]);
    expect(manifest.steps[0]!.image_sha256).toBe(sha(first));
    expect(manifest.steps[0]!.image_bytes).toBe(readFileSync(first).length);
    expect(readFileSync(bundleFile('screenshots/01-cart-page/caption.txt'), 'utf8')).toBe(
      'Cart page\n',
    );
    expect(manifest.steps[0]!.ac).toBeUndefined();
    expect(readVisualEvidenceManifest(root, DIR)).toEqual(manifest);
  });

  it('AC-6: turns a strict documented-skip fail into a pass that says agent-attached', () => {
    documentedSkipManifest();
    expect(strictGate().status).toBe('fail');

    attachVisualEvidence({
      projectRoot: root,
      dirName: DIR,
      files: [png('goal.png', 'goal')],
      ac: 'AC-6',
      label: 'Savings goal saved',
      now,
    });

    const manifest = readVisualEvidenceManifest(root, DIR)!;
    expect(manifest.skips).toHaveLength(1); // the documented skip is kept
    expect(manifest.steps[0]!.ac).toBe('AC-6');
    expect(manifest.steps[0]!.dir).toBe('screenshots/01-savings-goal-saved');
    const gate = strictGate();
    expect(gate.status).toBe('pass');
    expect(gate.detail).toContain('1 of them agent-attached (not scripted captures)');
  });

  it('merges after scripted steps as mixed, keeps partial, and never reuses a folder name', () => {
    const scripted = png('scripted.png', 'scripted');
    mkdirSync(bundleFile('screenshots/03-open'), { recursive: true });
    writeFileSync(bundleFile('screenshots/03-open/image.png'), readFileSync(scripted));
    const scriptedStep: VeStep = {
      index: 3,
      journey_id: 'checkout',
      journey_step: 1,
      caption: 'Open',
      dir: 'screenshots/03-open',
      recorded_at: AT,
      image_sha256: sha(scripted),
      image_bytes: readFileSync(scripted).length,
      status: 'captured',
    };
    const failedStep: VeStep = {
      index: 2,
      journey_id: 'checkout',
      journey_step: 2,
      caption: 'Pay',
      dir: 'screenshots/02-pay',
      recorded_at: AT,
      status: 'failed',
      failure: 'selector-not-found',
    };
    writeVisualEvidenceManifest(root, DIR, {
      trigger: { changed_files: [], matched_globs: [], packs: [] },
      plan: [{ journey_id: 'checkout', capture_script: 'x.capture.yaml', matched_by: [] }],
      steps: [failedStep, scriptedStep],
      gif: null,
      skips: [],
      result: 'partial',
      now,
    });

    attachVisualEvidence({
      projectRoot: root,
      dirName: DIR,
      files: [png('a.png', 'a'), png('b.png', 'b')],
      label: 'Open',
      now,
    });

    const manifest = readVisualEvidenceManifest(root, DIR)!;
    expect(manifest.source).toBe('mixed');
    expect(manifest.result).toBe('partial');
    expect(manifest.plan).toHaveLength(1);
    expect(manifest.steps.map((s) => s.dir)).toEqual([
      'screenshots/02-pay',
      'screenshots/03-open',
      'screenshots/04-open-2',
      'screenshots/05-open-3',
    ]);
    expect(manifest.steps.map((s) => s.journey_step)).toEqual([2, 1, 1, 2]);
  });

  it('AC-15: refuses a missing file, a non-png, a fake png and an empty list, writing nothing', () => {
    const good = png('good.png', 'ok');
    const text = join(shots, 'notes.txt');
    writeFileSync(text, 'hello');
    const fake = join(shots, 'fake.png');
    writeFileSync(fake, 'not really a png');

    const cases: Array<[string[], string]> = [
      [[good, join(shots, 'missing.png')], 'does not exist'],
      [[text], 'is not a PNG image'],
      [[fake], 'is not a PNG image'],
      [[], 'at least one .png'],
    ];
    for (const [files, message] of cases) {
      let caught: unknown;
      try {
        attachVisualEvidence({ projectRoot: root, dirName: DIR, files, now });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(VisualEvidenceAttachError);
      expect((caught as Error).message).toContain(message);
      expect((caught as Error).name).toBe('VisualEvidenceAttachError');
    }
    expect(existsSync(manifestPath())).toBe(false);
    expect(existsSync(join(root, featureDir(DIR)))).toBe(false);
  });

  it('defaults the clock', () => {
    const result = attachVisualEvidence({
      projectRoot: root,
      dirName: DIR,
      files: [png('x.png', 'x')],
    });
    expect(result.manifest!.steps[0]!.recorded_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // Issue #581 — the manifest carries the one envelope header.
  it('stamps the envelope header, with the attaching session', () => {
    const result = attachVisualEvidence({
      projectRoot: root,
      dirName: DIR,
      files: [png('x.png', 'x')],
      sessionId: 'ses_attach',
      now,
    });
    const raw = JSON.parse(readFileSync(manifestPath(), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(raw).slice(0, 6)).toEqual([
      'schema_version',
      'doc_type',
      'change',
      'session_id',
      'recorded_at',
      'content_hash',
    ]);
    expect(raw).toMatchObject({
      schema_version: 2,
      doc_type: 'paqad.visual-evidence',
      change: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      session_id: 'ses_attach',
      recorded_at: AT,
    });
    expect(raw).not.toHaveProperty('generated_at');
    expect(result.manifest!.content_hash).toBe(raw.content_hash);
  });

  it('carries the steps of a pre-#581 manifest forward under recorded_at (INV-8)', () => {
    mkdirSync(bundleFile('screenshots/01-old'), { recursive: true });
    writeFileSync(
      manifestPath(),
      JSON.stringify({
        schema_version: 1,
        doc_type: 'paqad.visual-evidence',
        generated_at: AT,
        content_hash: 'a'.repeat(64),
        trigger: { changed_files: [], matched_globs: [], packs: [] },
        plan: [],
        steps: [
          {
            index: 1,
            journey_id: 'agent-attached',
            journey_step: 1,
            caption: 'old',
            dir: 'screenshots/01-old',
            captured_at: AT,
            status: 'captured',
          },
        ],
        gif: null,
        skips: [],
        result: 'captured',
        source: 'agent-attached',
      }),
    );
    expect(readAttachedSteps(root, DIR)[0]).toMatchObject({ recorded_at: AT });
    attachVisualEvidence({ projectRoot: root, dirName: DIR, files: [png('y.png', 'y')], now });
    const raw = JSON.parse(readFileSync(manifestPath(), 'utf8')) as VisualEvidenceManifest;
    expect(raw.schema_version).toBe(2);
    expect(raw.steps).toHaveLength(2);
    expect(raw.steps[0]).toMatchObject({ caption: 'old', recorded_at: AT });
    expect(raw.steps[0]).not.toHaveProperty('captured_at');
  });
});

describe('a later scripted run keeps attached steps (issue #579, FR-13 / AC-16)', () => {
  it('the no-documented-flow path carries the attached steps, files and hashes forward', async () => {
    attachVisualEvidence({
      projectRoot: root,
      dirName: DIR,
      files: [png('kept.png', 'kept')],
      now,
    });
    const before = readVisualEvidenceManifest(root, DIR)!.steps;

    const result = await runVisualEvidence({
      projectRoot: root,
      dirName: DIR,
      profile: null,
      trigger: { changed_files: ['src/a.tsx'], matched_globs: [], packs: [] },
      changedFiles: ['src/a.tsx'],
      now,
    });

    const manifest = result.manifest!;
    expect(manifest.skips.map((s) => s.reason)).toContain('no-documented-flow');
    expect(manifest.steps).toEqual(before);
    expect(manifest.result).toBe('captured');
    expect(manifest.source).toBe('agent-attached');
    expect(existsSync(bundleFile(`${before[0]!.dir}/image.png`))).toBe(true);
    expect(strictGate().status).toBe('pass');
  });

  it('the capture path copies attached folders into the new build and numbers after them', () => {
    attachVisualEvidence({
      projectRoot: root,
      dirName: DIR,
      files: [png('one.png', '1'), png('two.png', '2')],
      now,
    });
    const attached = readAttachedSteps(root, DIR);
    const tmpAbs = join(root, 'build-tmp');
    mkdirSync(tmpAbs, { recursive: true });

    copyAttachedStepDirs(root, DIR, attached, tmpAbs);

    expect(readFileSync(join(tmpAbs, '01-one', 'image.png'))).toEqual(
      readFileSync(bundleFile('screenshots/01-one/image.png')),
    );
    expect(existsSync(join(tmpAbs, '02-two', 'caption.txt'))).toBe(true);
    const used = new Set(attached.map((s) => stepDirSlug(s.dir)));
    expect(uniqueSlug('one', used)).toBe('one-2');
  });

  it('mergeAttachedSteps puts attached steps first and keeps a scripted result', () => {
    const attachedStep = {
      index: 1,
      journey_id: 'agent-attached',
      journey_step: 1,
      caption: 'a',
      dir: 'screenshots/01-a',
      recorded_at: AT,
      status: 'captured',
    } as VeStep;
    const scriptedStep = {
      ...attachedStep,
      index: 2,
      journey_id: 'j',
      dir: 'screenshots/02-b',
      status: 'failed',
    } as VeStep;
    const input = {
      trigger: { changed_files: [], matched_globs: [], packs: [] },
      plan: [],
      steps: [scriptedStep],
      gif: null,
      skips: [],
      result: 'partial' as const,
      now,
    };
    expect(mergeAttachedSteps([], input)).toBe(input);
    const merged = mergeAttachedSteps([attachedStep], input);
    expect(merged.steps).toEqual([attachedStep, scriptedStep]);
    expect(merged.result).toBe('partial');
    expect(readAttachedSteps(root, DIR)).toEqual([]);
  });

  it('an attach after an all-failed scripted run reads partial, so strict fails', () => {
    // What runner.ts writes when every scripted step failed: result skipped, failed steps kept.
    writeVisualEvidenceManifest(root, DIR, {
      trigger: { changed_files: ['src/a.tsx'], matched_globs: [], packs: [] },
      plan: [{ journey_id: 'checkout', capture_script: 'x.capture.yaml', matched_by: [] }],
      steps: [
        {
          index: 1,
          journey_id: 'checkout',
          journey_step: 1,
          caption: 'pay',
          dir: 'screenshots/01-pay',
          recorded_at: AT,
          status: 'failed',
          failure: 'selector-not-found',
        },
      ],
      gif: null,
      skips: [],
      result: 'skipped',
      now,
    });

    attachVisualEvidence({ projectRoot: root, dirName: DIR, files: [png('a.png', 'a')], now });

    const manifest = readVisualEvidenceManifest(root, DIR)!;
    expect(manifest.steps.map((s) => s.status)).toEqual(['failed', 'captured']);
    expect(manifest.result).toBe('partial');
    expect(strictGate().status).toBe('fail');
  });

  it('a clean attach with no scripted run reads captured, so strict passes', () => {
    attachVisualEvidence({ projectRoot: root, dirName: DIR, files: [png('a.png', 'a')], now });
    expect(readVisualEvidenceManifest(root, DIR)!.result).toBe('captured');
    expect(strictGate().status).toBe('pass');
  });

  it('mergedVisualEvidenceResult: failed wins, then captured, else skipped', () => {
    const step = (status: VeStep['status']) => ({ status }) as VeStep;
    expect(mergedVisualEvidenceResult([step('captured'), step('failed')])).toBe('partial');
    expect(mergedVisualEvidenceResult([step('failed')])).toBe('partial');
    expect(mergedVisualEvidenceResult([step('captured')])).toBe('captured');
    expect(mergedVisualEvidenceResult([])).toBe('skipped');
  });

  it('an all-failed scripted run after an attach reads partial, so strict fails', () => {
    attachVisualEvidence({ projectRoot: root, dirName: DIR, files: [png('one.png', '1')], now });
    const attached = readAttachedSteps(root, DIR);
    const failedStep = {
      index: 2,
      journey_id: 'checkout',
      journey_step: 1,
      caption: 'pay',
      dir: 'screenshots/02-pay',
      recorded_at: AT,
      status: 'failed',
      failure: 'selector-not-found',
    } as VeStep;
    const merged = mergeAttachedSteps(attached, {
      trigger: { changed_files: ['src/a.tsx'], matched_globs: [], packs: [] },
      plan: [],
      steps: [failedStep],
      gif: null,
      skips: [],
      result: 'skipped',
      now,
    });

    expect(merged.result).toBe('partial');
    writeVisualEvidenceManifest(root, DIR, merged);
    expect(readVisualEvidenceManifest(root, DIR)!.result).toBe('partial');
    expect(strictGate().status).toBe('fail');
  });

  it('attached steps lift a skipped scripted run with no failed step to captured', () => {
    const attachedStep = {
      index: 1,
      journey_id: 'agent-attached',
      journey_step: 1,
      caption: 'a',
      dir: 'screenshots/01-a',
      recorded_at: AT,
      status: 'captured',
    } as VeStep;
    const merged = mergeAttachedSteps([attachedStep], {
      trigger: { changed_files: [], matched_globs: [], packs: [] },
      plan: [],
      steps: [],
      gif: null,
      skips: [],
      result: 'skipped',
      now,
    });
    expect(merged.result).toBe('captured');
  });

  it('refuses to write a manifest that fails its own schema', () => {
    expect(() =>
      writeVisualEvidenceManifest(root, DIR, {
        trigger: { changed_files: [], matched_globs: [], packs: [] },
        plan: [],
        steps: [],
        gif: null,
        skips: [],
        result: 'bogus' as VisualEvidenceManifest['result'],
        now,
      }),
    ).toThrow('failed its own schema');
  });
});
