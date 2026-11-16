import { rmSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MODULE_MAP_PATH, readModuleUnits } from '@/onboarding/journey/modules.js';

import { tempRoot, writeFile } from './fixtures/journey.js';

describe('FR-26: module units come from the current module-map.yml', () => {
  let root: string;

  beforeEach(() => {
    root = tempRoot('paqad-modules-');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function units(yaml: string) {
    writeFile(root, MODULE_MAP_PATH, yaml);
    return readModuleUnits(root);
  }

  it('reads nothing when the map is missing, empty or has no module list', () => {
    expect(readModuleUnits(root)).toBeNull();
    expect(units('')).toBeNull();
    expect(units('version: 2\nmodules: billing\n')).toBeNull();
  });

  it('skips entries with no slug and hashes modules with no sources the same way', () => {
    const read = units(
      [
        'modules:',
        '  - sources: [src/orphan]',
        '  - slug: bare',
        '  - slug: empty',
        '    sources: []',
      ].join('\n'),
    )!;
    expect(read.map((unit) => unit.slug)).toEqual(['bare', 'empty']);
    expect(read[0]!.source_hash).toBe(read[1]!.source_hash);
  });

  it('changes the hash when a feature or its sources change, and treats missing feature sources as empty', () => {
    const hash = (features: string) =>
      units(`modules:\n  - slug: billing\n    sources: [src/billing]\n${features}`)![0]!
        .source_hash;
    const none = hash('');
    const bare = hash('    features:\n      - slug: invoices\n');
    const empty = hash('    features:\n      - slug: invoices\n        sources: []\n');
    const sourced = hash('    features:\n      - slug: invoices\n        sources: [src/inv]\n');
    expect(bare).toBe(empty);
    expect(new Set([none, bare, sourced]).size).toBe(3);
  });
});
