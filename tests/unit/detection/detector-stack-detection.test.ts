import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InferenceProvider } from '@/context/inference-provider.js';
import { AIDetector } from '@/detection/ai-detector';
import { Detector } from '@/detection/detector';

function seedReactProject(root: string): string {
  const projectRoot = join(root, 'react-app');
  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      dependencies: {
        react: '^19.0.0',
        'react-dom': '^19.0.0',
        '@vitejs/plugin-react': '^5.0.0',
        vite: '^7.0.0',
      },
    }),
    'src/App.tsx': 'export default function App() { return null; }',
    'vite.config.ts':
      'import react from "@vitejs/plugin-react"; export default { plugins: [react()] };',
    'tsconfig.json': JSON.stringify({ compilerOptions: { jsx: 'react-jsx' } }),
  };
  for (const [relative, content] of Object.entries(files)) {
    const absolute = join(projectRoot, relative);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return projectRoot;
}

describe('Detector — PQD-423 stack detection surface', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-ai-detector-pqd423-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it('reports primary_language, a numeric confidence_score, and a static source (AC1)', async () => {
    const projectRoot = seedReactProject(root);
    const report = await new Detector().detect(projectRoot);

    expect(report.detected_stack).toBe('react');
    expect(report.primary_language).toBe('JavaScript/TypeScript');
    expect(typeof report.confidence_score).toBe('number');
    expect(report.confidence_score).toBeGreaterThan(0);
    expect(report.confidence_score).toBeLessThanOrEqual(1);
    expect(report.source).toBe('static');
  });

  it('returns a structured unknown result with confidence_score 0 and no throw (AC3)', async () => {
    const empty = join(root, 'empty');
    mkdirSync(empty, { recursive: true });

    const report = await new Detector().detect(empty);

    expect(report.detected_stack).toBeNull();
    expect(report.primary_language).toBeNull();
    expect(report.confidence_score).toBe(0);
    expect(report.source).toBe('static');
  });

  it('uses the AI path and labels the report source "ai" when it is confident (AC2)', async () => {
    const projectRoot = seedReactProject(root);
    const provider: InferenceProvider = {
      complete: vi
        .fn()
        .mockResolvedValue(
          '{"domain":"coding","stack":"react","ecosystem":"node","confidence_score":0.95}',
        ),
    };
    const detector = new Detector({ aiDetector: new AIDetector({ provider }) });

    const report = await detector.detect(projectRoot);

    expect(report.source).toBe('ai');
    expect(report.confidence_score).toBe(0.95);
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });

  it('falls back to static detection when the AI path returns low confidence (AC2)', async () => {
    const projectRoot = seedReactProject(root);
    const provider: InferenceProvider = {
      complete: vi
        .fn()
        .mockResolvedValue(
          '{"domain":"coding","stack":"react","ecosystem":"node","confidence_score":0.2}',
        ),
    };
    const detector = new Detector({ aiDetector: new AIDetector({ provider }) });

    const report = await detector.detect(projectRoot);

    expect(report.source).toBe('static');
    expect(report.detected_stack).toBe('react');
  });

  it('deduplicates concurrent detections on the same folder into one identical result (AC4)', async () => {
    const projectRoot = seedReactProject(root);
    const detector = new Detector();

    const [a, b] = await Promise.all([detector.detect(projectRoot), detector.detect(projectRoot)]);

    // Same in-flight promise → referentially identical, so every field matches.
    expect(a).toBe(b);
    expect(a.detected_stack).toBe(b.detected_stack);
    expect(a.primary_language).toBe(b.primary_language);
    expect(a.confidence_score).toBe(b.confidence_score);
    expect(a.source).toBe(b.source);
  });

  it('clears the in-flight entry so a later detection runs fresh', async () => {
    const projectRoot = seedReactProject(root);
    const detector = new Detector();

    const first = await detector.detect(projectRoot);
    const second = await detector.detect(projectRoot);

    // Sequential calls are not deduplicated (the first settled and cleared).
    expect(second).not.toBe(first);
    expect(second.detected_stack).toBe(first.detected_stack);
  });
});
