import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HealthChecker } from '@/health/checker.js';
import {
  HOME_PROJECT_CHECK,
  HOME_PROJECT_WARNING,
  homeProjectHealth,
} from '@/health/home-project-check.js';

let home: string;
let project: string;
let marker: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'home-project-'));
  project = mkdtempSync(join(tmpdir(), 'home-project-repo-'));
  marker = join(home, '.paqad', 'framework-path.txt');
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

function onboardHome(): void {
  mkdirSync(join(home, '.paqad'), { recursive: true });
  writeFileSync(marker, '~/.paqad-ai/current\n', 'utf8');
}

describe('AC-5: doctor warns when the home folder is set up as a paqad project', () => {
  it('warns with the exact wording and leaves the file in place', () => {
    onboardHome();
    expect(homeProjectHealth(home)).toEqual([
      expect.objectContaining({
        name: HOME_PROJECT_CHECK,
        status: 'warning',
        detail:
          'Your home folder is set up as a paqad project. This makes the HUD pick the wrong folder. Remove ~/.paqad/framework-path.txt unless you really work in your home folder.',
      }),
    ]);
    expect(existsSync(marker)).toBe(true);
  });

  it('passes with no warning once the file is removed by hand', () => {
    onboardHome();
    unlinkSync(marker);
    const [row] = homeProjectHealth(home);
    expect(row?.status).toBe('pass');
    expect(row?.detail).not.toBe(HOME_PROJECT_WARNING);
  });

  it('runs inside paqad-ai doctor and never deletes the file', async () => {
    onboardHome();
    const report = await new HealthChecker({ homeDir: home }).run(project);
    const row = report.checks.find((check) => check.name === HOME_PROJECT_CHECK);
    expect(row).toMatchObject({ status: 'warning', detail: HOME_PROJECT_WARNING });
    expect(existsSync(marker)).toBe(true);
    unlinkSync(marker);
    const after = await new HealthChecker({ homeDir: home }).run(project);
    expect(after.checks.some((check) => check.detail === HOME_PROJECT_WARNING)).toBe(false);
  });
});
