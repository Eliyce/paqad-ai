import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import fg from 'fast-glob';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

const PATTERNS: readonly RegExp[] = [
  /docs\/instructions\/workflows\/feature-development\.yaml/u,
  /feature-development-view\.sha256/u,
  /configs\/schemas/u,
  /yaml-language-server/u,
  /\bgenerated (?:workflow )?view(?!s)/iu,
  /paqad-ai config view/u,
];

const ALLOWED: readonly string[] = [
  'src/update/generated-files-cleanup.ts',
  'src/update/legacy-schema-line.ts',
  'docs/modules/cli-lifecycle/features/update/technical.md',
  'docs/modules/cli-lifecycle/features/join/business.md',
];

function hits(): string[] {
  const files = fg.sync(['src/**/*', 'runtime/**/*', 'docs/**/*'], {
    cwd: ROOT,
    ignore: ['**/node_modules/**', 'docs/instructions/tech-debt/**', 'docs/instructions/workflows/**'],
    onlyFiles: true,
  });
  const found: string[] = [];
  for (const file of files) {
    if (ALLOWED.includes(file) || !/\.(?:ts|mjs|js|md|ya?ml|json)$/u.test(file)) continue;
    const text = readFileSync(join(ROOT, file), 'utf8');
    for (const pattern of PATTERNS) {
      if (pattern.test(text)) found.push(`${file}: ${pattern.source}`);
    }
  }
  return found;
}

describe('the generated workflow copy and the config schemas', () => {
  it('are named only by the cleanup code that removes them', () => {
    expect(hits()).toEqual([]);
  });
});
