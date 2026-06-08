import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  measureStrictness,
  measureStrictnessFromOptions,
  parseTsconfig,
} from '@/quality-ratchet/strictness.js';

describe('strictness measure', () => {
  it('counts every tracked flag off when nothing is configured', () => {
    const { looseness, considered } = measureStrictnessFromOptions({});
    // 8 strict-family flags off + 7 extra flags off.
    expect(considered).toBe(15);
    expect(looseness).toBe(15);
  });

  it('treats strict:true as enabling the strict family', () => {
    const { looseness } = measureStrictnessFromOptions({ strict: true });
    // Only the 7 extra (non-strict-implied) flags remain off.
    expect(looseness).toBe(7);
  });

  it('counts an explicitly-disabled strict-family flag as loose even under strict:true', () => {
    const withFlag = measureStrictnessFromOptions({ strict: true, strictNullChecks: false });
    const withoutFlag = measureStrictnessFromOptions({ strict: true });
    expect(withFlag.looseness).toBe(withoutFlag.looseness + 1);
  });

  it('rewards enabling the extra strict flags', () => {
    const value = measureStrictnessFromOptions({
      strict: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      noImplicitReturns: true,
      noFallthroughCasesInSwitch: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      noImplicitOverride: true,
    });
    expect(value.looseness).toBe(0);
  });

  it('parses a tsconfig with comments and trailing commas', () => {
    const raw = `{
      // project config
      "compilerOptions": {
        "strict": true, /* umbrella */
      },
    }`;
    const parsed = parseTsconfig(raw);
    expect(parsed?.compilerOptions?.strict).toBe(true);
  });

  it('returns null for unparseable tsconfig content', () => {
    expect(parseTsconfig('{ this is not json')).toBeNull();
  });

  it('reads tsconfig.json from disk and measures it', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-strictness-'));
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true } }),
    );
    expect(measureStrictness(root)?.looseness).toBe(7);
  });

  it('returns null when there is no tsconfig (not a TS project)', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-strictness-none-'));
    expect(measureStrictness(root)).toBeNull();
  });

  it('returns null when tsconfig cannot be parsed even after stripping comments', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-strictness-bad-'));
    writeFileSync(join(root, 'tsconfig.json'), '{ "compilerOptions": { broken');
    expect(measureStrictness(root)).toBeNull();
  });
});
