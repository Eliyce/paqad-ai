import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as cliBarrel from '@/cli/index.js';
import * as rootBarrel from '@/index';
import * as ruleScriptsBarrel from '@/rule-scripts/index.js';

// @ts-expect-error -- pure JS helper shared with the runnable check scripts
import { parseSurfaceDoc } from '../../../scripts/lib/surface-doc.mjs';

const markdown = readFileSync(
  fileURLToPath(new URL('../../../docs/extension-surface.md', import.meta.url)),
  'utf8',
);

interface SurfaceDocEntry {
  symbol: string;
  signature: string;
  stability: string;
  engineModule: string;
}

const entries = parseSurfaceDoc(markdown) as SurfaceDocEntry[];

const publicExports = new Set([
  ...Object.keys(rootBarrel),
  ...Object.keys(cliBarrel),
  ...Object.keys(ruleScriptsBarrel),
]);

function isTypeOnly(signature: string): boolean {
  return /^(type|interface)\b/u.test(signature.replaceAll('`', '').trim());
}

describe('docs/extension-surface.md', () => {
  it('parses into a non-empty entry set', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('uses only known stability levels', () => {
    const allowed = new Set(['stable', 'beta', 'alpha', 'internal']);
    for (const entry of entries) {
      expect(allowed.has(entry.stability)).toBe(true);
    }
  });

  it('exports every stable or beta value symbol it lists', () => {
    const valueEntries = entries.filter(
      (entry) =>
        (entry.stability === 'stable' || entry.stability === 'beta') &&
        !isTypeOnly(entry.signature),
    );
    expect(valueEntries.length).toBeGreaterThan(0);

    const missing = valueEntries
      .filter((entry) => !publicExports.has(entry.symbol))
      .map((entry) => entry.symbol);
    expect(missing).toEqual([]);
  });
});
