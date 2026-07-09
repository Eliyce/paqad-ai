import { describe, expect, it } from 'vitest';

import { parsePackManifest } from '../shared/pack-manifest.js';

// Regression coverage for issue #332: npm 12 changed the `npm pack --json`
// output shape from a top-level array to an object keyed by package name. The
// publish-time E2E crashed because it assumed the array shape. These tests
// prove both shapes parse identically without needing npm 12 installed in CI.

const npm11Output = JSON.stringify([
  {
    id: 'paqad-ai@1.48.0',
    name: 'paqad-ai',
    files: [{ path: 'runtime/index.js' }, { path: 'dist/cli/index.js' }],
  },
]);

const npm12Output = JSON.stringify({
  'paqad-ai': {
    id: 'paqad-ai@1.48.0',
    name: 'paqad-ai',
    files: [{ path: 'runtime/index.js' }, { path: 'dist/cli/index.js' }],
  },
});

describe('parsePackManifest', () => {
  it('parses the npm <= 11 array shape', () => {
    const manifest = parsePackManifest(npm11Output);
    expect(manifest.id).toBe('paqad-ai@1.48.0');
    expect(manifest.files.map((f) => f.path)).toContain('runtime/index.js');
  });

  it('parses the npm >= 12 object shape', () => {
    const manifest = parsePackManifest(npm12Output);
    expect(manifest.id).toBe('paqad-ai@1.48.0');
    expect(manifest.files.map((f) => f.path)).toContain('runtime/index.js');
  });

  it('produces the same manifest for both npm shapes', () => {
    expect(parsePackManifest(npm11Output)).toEqual(parsePackManifest(npm12Output));
  });

  it('throws a clear error on an unexpected shape', () => {
    expect(() => parsePackManifest('[]')).toThrow(/Unexpected/);
    expect(() => parsePackManifest('{}')).toThrow(/Unexpected/);
    expect(() => parsePackManifest('{"paqad-ai":{"id":"x"}}')).toThrow(/Unexpected/);
  });
});
