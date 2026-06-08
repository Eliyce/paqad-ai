import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  readTraceabilityMap,
  writeTraceabilityMap,
  traceabilityMapPath,
} from '@/traceability/writer.js';
import { buildTraceabilityMap } from '@/traceability/map-builder.js';
import { rmSync } from 'node:fs';

describe('traceability writer', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-traceability-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes and reads back the map round-trip', async () => {
    const map = buildTraceabilityMap({
      lane: 'graduated',
      now: () => '2026-06-08T00:00:00.000Z',
      promises: [{ promise_id: 'AC-1', description: 'x', source: 'acceptance-criterion' }],
      delivery: [{ promise_id: 'AC-1', files: ['src/x.ts'] }],
      proofs: [{ promise_id: 'AC-1', checks: ['tests/x.test.ts'] }],
      edges: [],
      codeUniverse: ['src/x.ts'],
    });

    const path = await writeTraceabilityMap(root, map);
    expect(path).toBe(traceabilityMapPath(root));

    const read = await readTraceabilityMap(root);
    expect(read).toEqual(map);
  });

  it('returns null when no map exists', async () => {
    expect(await readTraceabilityMap(root)).toBeNull();
  });

  it('returns null on a corrupt map file', async () => {
    const path = join(root, PATHS.TRACEABILITY_MAP);
    mkdirSync(join(root, PATHS.TRACEABILITY_DIR), { recursive: true });
    writeFileSync(path, '{ not json', 'utf8');
    expect(await readTraceabilityMap(root)).toBeNull();
  });
});
