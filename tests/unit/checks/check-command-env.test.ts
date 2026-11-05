import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { projectCommandEnv, runChecks } from '@/checks/run-checks.js';

const GiB = 1024 ** 3;

describe('the project commands checks run starts', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-check-env-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(
      join(root, 'print-env.cjs'),
      "require('node:fs').writeFileSync('seen-env.json', JSON.stringify(process.env));\n",
    );
    writeFileSync(
      join(root, '.paqad/project-profile.yaml'),
      'commands:\n  test: node print-env.cjs\n',
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it('do not inherit the identity of the stage that started them, and keep every other variable', async () => {
    vi.stubEnv('SE_AGENT_ID', 'agent-of-the-checks-stage');
    vi.stubEnv('SE_SESSION', 'session-of-the-orchestrator');
    vi.stubEnv('SE_MANAGER_PATH', '/opt/selenium-manager');
    vi.stubEnv('PROJECT_OWN_SETTING', 'kept');

    await runChecks({
      projectRoot: root,
      reuse: false,
      osFacts: { availableParallelism: 8, totalmem: 64 * GiB },
    });

    const seen = JSON.parse(readFileSync(join(root, 'seen-env.json'), 'utf8')) as Record<
      string,
      string
    >;
    expect(seen.SE_AGENT_ID).toBeUndefined();
    expect(seen.SE_SESSION).toBeUndefined();
    expect(seen.SE_MANAGER_PATH).toBe('/opt/selenium-manager');
    expect(seen.PROJECT_OWN_SETTING).toBe('kept');
    expect(seen.PATH ?? seen.Path).toBeTruthy();
    expect(process.env.SE_AGENT_ID).toBe('agent-of-the-checks-stage');
    expect(process.env.SE_SESSION).toBe('session-of-the-orchestrator');
  });

  it('drops only the two identity variables from the environment it is given', () => {
    expect(
      projectCommandEnv({ SE_AGENT_ID: 'a', SE_SESSION: 's', SE_OTHER: 'o', HOME: '/h' }),
    ).toEqual({
      SE_OTHER: 'o',
      HOME: '/h',
    });
  });
});
