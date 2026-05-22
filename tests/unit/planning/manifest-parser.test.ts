import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';

import {
  computeManifestHash,
  listManifestSlugs,
  loadManifest,
  manifestExists,
} from '@/planning/manifest-parser.js';

import { createManifest } from './fixtures.js';

describe('manifest-parser', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'planning-parser-'));
    mkdirSync(join(root, '.paqad/specs'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('loads manifests, lists slugs, and checks existence', async () => {
    const manifest = createManifest();
    writeFileSync(join(root, '.paqad/specs/planning-manifest.yaml'), YAML.stringify(manifest));
    writeFileSync(join(root, '.paqad/specs/second.yaml'), YAML.stringify(manifest));

    await expect(loadManifest(root, 'planning-manifest')).resolves.toMatchObject({
      feature_id: 'feat-planning-manifest',
    });
    await expect(manifestExists(root, 'planning-manifest')).resolves.toBe(true);
    await expect(manifestExists(root, 'missing')).resolves.toBe(false);
    await expect(listManifestSlugs(root)).resolves.toEqual(['planning-manifest', 'second']);
  });

  it('computes stable hashes for equivalent manifests', () => {
    const left = createManifest();
    const right = createManifest({
      verification_matrix: [...createManifest().verification_matrix],
    });

    expect(computeManifestHash(left)).toBe(computeManifestHash(right));
  });

  it('returns an empty slug list when the specs directory is missing', async () => {
    await expect(listManifestSlugs(join(root, 'missing-root'))).resolves.toEqual([]);
  });
});
