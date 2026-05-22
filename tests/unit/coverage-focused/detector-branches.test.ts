import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Detector } from '@/detection/detector';

describe('Detector branch coverage', () => {
  let root: string;
  let detector: Detector;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-detector-branches-'));
    detector = new Detector();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns medium confidence when multiple applications exist but one wins clearly', async () => {
    seedFiles(root, {
      'backend/artisan': '',
      'backend/composer.json': JSON.stringify({
        require: {
          'laravel/framework': '^12.0',
          'laravel/sail': '^1.0',
        },
      }),
      'backend/app/.gitkeep': '',
      'backend/routes/.gitkeep': '',
      'backend/compose.yaml': 'services:\n  app:\n    image: sail\n',
      'worker/package.json': JSON.stringify({
        scripts: { start: 'node dist/server.js' },
      }),
      'worker/src/server.ts': 'export const server = true;\n',
    });

    const report = await detector.detect(root);

    expect(report.detected_domain).toBe('coding');
    expect(report.detected_stack).toBe('laravel');
    expect(report.confidence).toBe('medium');
    expect(report.matched_packs).toEqual(['laravel', 'node-service']);
    expect(report.detected_capabilities).toContain('compose');
    expect(report.detected_capabilities).toContain('sail');
  });

  it('falls back to heuristic detection when manifest JSON is invalid', async () => {
    seedFiles(root, {
      'invalid-library/package.json': '{"main": "dist/index.js",',
      'invalid-library/src/index.ts': 'export const version = "1.0.0";\n',
    });

    const report = await detector.detect(join(root, 'invalid-library'));

    expect(report.detected_domain).toBe('coding');
    expect(report.detected_stack).toBe('node-library');
    expect(report.detection_phase).toBe('archetype');
    expect(report.confidence).toBe('low');
    expect(report.signals).toEqual([
      expect.objectContaining({
        implies: 'node-library',
        confidence: 'medium',
        file: 'src/index.ts',
      }),
    ]);
  });
});

function seedFiles(root: string, fixtures: Record<string, string>): void {
  for (const [relativePath, content] of Object.entries(fixtures)) {
    const absolutePath = join(root, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
}
