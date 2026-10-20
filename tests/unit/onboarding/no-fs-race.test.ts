import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ONBOARDING_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../src/onboarding');

const TOCTOU_PATTERN = /existsSync\([^)]*\)\s*\?\s*(?:readFileSync|writeFileSync)/;

function listTypeScriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(full);
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('onboarding has no TOCTOU file-system-race idiom', () => {
  it('never uses `existsSync(p) ? readFileSync/writeFileSync` in src/onboarding', () => {
    const offenders: string[] = [];
    for (const file of listTypeScriptFiles(ONBOARDING_DIR)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      code.split('\n').forEach((line, index) => {
        if (TOCTOU_PATTERN.test(line)) {
          offenders.push(`${file}:${index + 1}`);
        }
      });
    }

    expect(
      offenders,
      `Use a single read in try/catch (ENOENT → default) instead of existsSync-then-read/write. Offenders:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
