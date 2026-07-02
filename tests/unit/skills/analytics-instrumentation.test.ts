import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SKILL_ROOT = join(process.cwd(), 'runtime/base/skills/analytics-instrumentation');

describe('analytics-instrumentation skill (issue #279)', () => {
  it('SKILL.md declares the analytics-instrumentation skill', () => {
    const md = readFileSync(join(SKILL_ROOT, 'SKILL.md'), 'utf8');
    expect(md).toContain('name: analytics-instrumentation');
    expect(md).toContain('analytics.new_event');
    expect(md).toContain('scripts/instrument.mjs');
  });

  it('instrument.mjs is syntactically valid and prints usage without args', () => {
    const scriptPath = join(SKILL_ROOT, 'scripts/instrument.mjs');

    const check = spawnSync(process.execPath, ['--check', scriptPath], { encoding: 'utf8' });
    expect(check.status).toBe(0);

    const usage = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' });
    expect(usage.status).toBe(1);
    expect(usage.stdout).toContain('Usage: node scripts/instrument.mjs');
  });
});
