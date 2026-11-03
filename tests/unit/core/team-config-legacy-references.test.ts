import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');

const LEGACY =
  /\.config\.(app|rag|models|policy)|CONFIG_GROUP_FILES|setGroupConfigValue|syncGroupConfigs|generateGroupConfig/u;

const ALLOWED = new Set(['src/core/team-config-legacy.ts', 'src/core/team-config-migrate.ts']);

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === '.git') return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe('references to the old team config files', () => {
  it('only the legacy reader and the migration name the old .config.* files or the group config helpers (AC-71)', () => {
    const hits = ['src', 'runtime']
      .flatMap((dir) => filesUnder(join(ROOT, dir)))
      .filter((path) => LEGACY.test(readFileSync(path, 'utf8')))
      .map((path) => relative(ROOT, path).split('\\').join('/'));
    expect(hits.sort()).toEqual([...ALLOWED].sort());
  });
});
