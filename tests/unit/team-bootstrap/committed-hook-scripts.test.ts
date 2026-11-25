import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO = process.cwd();
const FROZEN = JSON.parse(
  readFileSync(join(REPO, 'tests/fixtures/team-bootstrap/committed-hook-scripts.json'), 'utf8'),
) as { scripts: string[] };

describe('hook scripts a committed chain may name', () => {
  it('every script a committed chain has ever named still ships in runtime/hooks', () => {
    expect(FROZEN.scripts.length).toBeGreaterThan(10);
    for (const script of FROZEN.scripts) {
      expect(existsSync(join(REPO, 'runtime', 'hooks', script)), script).toBe(true);
    }
  });
});
