import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InferenceProvider } from '@/context/inference-provider.js';
import { AIDetector } from '@/detection/ai-detector';

function providerReturning(response: string): InferenceProvider {
  return { complete: vi.fn().mockResolvedValue(response) };
}

describe('AIDetector', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-ai-aidetect-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { react: '^19' } }));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns null when no provider is configured (AI path unavailable)', async () => {
    expect(await new AIDetector().detect(root)).toBeNull();
  });

  it('returns null when the folder has no sampled manifests', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'paqad-ai-aidetect-empty-'));
    try {
      const detector = new AIDetector({ provider: providerReturning('{}') });
      expect(await detector.detect(empty)).toBeNull();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('skips an unreadable manifest and returns null when none remain', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'paqad-ai-aidetect-bad-'));
    try {
      // A directory named like a manifest: existsSync is true but readFileSync throws.
      mkdirSync(join(dir, 'package.json'));
      const detector = new AIDetector({ provider: providerReturning('{}') });
      expect(await detector.detect(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns an ai-sourced report on a confident response', async () => {
    const provider = providerReturning(
      '{"domain":"coding","stack":"react","ecosystem":"node","confidence_score":0.92}',
    );
    const report = await new AIDetector({ provider }).detect(root);

    expect(report).not.toBeNull();
    expect(report?.source).toBe('ai');
    expect(report?.detected_stack).toBe('react');
    expect(report?.detected_domain).toBe('coding');
    expect(report?.primary_language).toBe('JavaScript/TypeScript');
    expect(report?.confidence_score).toBe(0.92);
    expect(report?.confidence).toBe('high');
    expect(report?.detection_phase).toBe('framework');
    expect(report?.recommended_capabilities).toEqual(['content', 'coding', 'security']);
  });

  it('extracts the JSON object even when the model wraps it in prose', async () => {
    const provider = providerReturning(
      'Here is the result:\n{"domain":"coding","stack":"flask","ecosystem":"python","confidence_score":0.8}\nDone.',
    );
    const report = await new AIDetector({ provider }).detect(root);

    expect(report?.detected_stack).toBe('flask');
    expect(report?.primary_language).toBe('Python');
    expect(report?.confidence).toBe('medium');
  });

  it('clamps an out-of-range confidence into [0,1]', async () => {
    const provider = providerReturning(
      '{"domain":"coding","stack":"react","ecosystem":"node","confidence_score":1.5}',
    );
    const report = await new AIDetector({ provider }).detect(root);

    expect(report?.confidence_score).toBe(1);
  });

  it('nullifies unknown domain, stack, and ecosystem values', async () => {
    const provider = providerReturning(
      '{"domain":"banking","stack":"cobol-web","ecosystem":"cobol","confidence_score":0.9}',
    );
    const report = await new AIDetector({ provider }).detect(root);

    expect(report).not.toBeNull();
    expect(report?.detected_domain).toBeNull();
    expect(report?.detected_stack).toBeNull();
    expect(report?.primary_language).toBeNull();
    expect(report?.detection_phase).toBe('none');
    expect(report?.recommended_capabilities).toEqual(['content']);
  });

  it('keeps the low categorical band when a low score is explicitly accepted', async () => {
    const provider = providerReturning(
      '{"domain":"coding","stack":"react","ecosystem":"node","confidence_score":0.5}',
    );
    const report = await new AIDetector({ provider, minConfidence: 0.1 }).detect(root);

    expect(report?.confidence).toBe('low');
  });

  it('returns null when confidence is below the minimum threshold', async () => {
    const provider = providerReturning(
      '{"domain":"coding","stack":"react","ecosystem":"node","confidence_score":0.3}',
    );
    expect(await new AIDetector({ provider }).detect(root)).toBeNull();
  });

  it('returns null when the response carries no JSON object', async () => {
    expect(
      await new AIDetector({ provider: providerReturning('no json here') }).detect(root),
    ).toBeNull();
  });

  it('returns null on malformed JSON', async () => {
    expect(
      await new AIDetector({ provider: providerReturning('{ not: valid }') }).detect(root),
    ).toBeNull();
  });

  it('returns null when the JSON is an array, not an object', async () => {
    expect(
      await new AIDetector({ provider: providerReturning('[1, 2, 3]') }).detect(root),
    ).toBeNull();
  });

  it('returns null when confidence_score is not a finite number', async () => {
    expect(
      await new AIDetector({
        provider: providerReturning('{"stack":"react","confidence_score":"high"}'),
      }).detect(root),
    ).toBeNull();
  });

  it('returns null when the provider throws', async () => {
    const provider: InferenceProvider = {
      complete: vi.fn().mockRejectedValue(new Error('boom')),
    };
    expect(await new AIDetector({ provider }).detect(root)).toBeNull();
  });

  it('returns null when the provider rejects with a non-Error value', async () => {
    const provider: InferenceProvider = {
      complete: vi.fn().mockRejectedValue('string failure'),
    };
    expect(await new AIDetector({ provider }).detect(root)).toBeNull();
  });

  it('enforces a hard timeout when the provider never resolves', async () => {
    const provider: InferenceProvider = {
      complete: vi.fn().mockReturnValue(new Promise<string>(() => {})),
    };
    const report = await new AIDetector({ provider, timeoutMs: 20 }).detect(root);

    expect(report).toBeNull();
    const signal = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0][1].signal;
    expect(signal.aborted).toBe(true);
  });
});
