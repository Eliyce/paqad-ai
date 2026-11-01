import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildTeamHookChain } from '@/adapters/claude/team-settings.js';

const REPO = process.cwd();
const FROZEN = JSON.parse(
  readFileSync(join(REPO, 'tests/fixtures/team-bootstrap/committed-hook-scripts.json'), 'utf8'),
) as { scripts: string[] };

function scriptOf(command: string): string {
  return command.replace(/^node "\$CLAUDE_PROJECT_DIR\/\.paqad\/hook\.mjs" /, '').split(' ')[0]!;
}

describe('hook scripts a committed chain may name', () => {
  it('every script a committed chain has ever named still ships in runtime/hooks', () => {
    expect(FROZEN.scripts.length).toBeGreaterThan(10);
    for (const script of FROZEN.scripts) {
      expect(existsSync(join(REPO, 'runtime', 'hooks', script)), script).toBe(true);
    }
  });

  it('the frozen list names every script the current committed chain uses', () => {
    for (const hook of buildTeamHookChain()) {
      expect(FROZEN.scripts).toContain(scriptOf(hook.command));
    }
  });
});
