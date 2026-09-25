// The test suite must never write into the developer's real home (tests/shared/isolate-home.ts).
// A run that did repointed `~/.paqad-ai/current` at this checkout and overwrote the user-scope
// stage agents, so every project on the machine ran unreleased code.

import { existsSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';

import { join } from 'pathe';
import { describe, expect, it } from 'vitest';

import { bootstrapFrameworkHome } from '@/install/bootstrap.js';

describe('the test run is isolated from the real home directory', () => {
  it('points os.homedir() at a throwaway directory', () => {
    const realHome = process.env.PAQAD_TEST_REAL_HOME;
    expect(realHome).toBeTruthy();
    expect(homedir()).not.toBe(realHome);
    expect(homedir()).toContain('paqad-test-home-');
    // A Windows 8.3 short name (`RUNNER~1`) would leak a `~` into every absolute path.
    expect(homedir()).not.toContain('~');
  });

  it('keeps the framework symlink and the stage agents inside the throwaway home', () => {
    const previous = process.env.PAQAD_FRAMEWORK_HOME;
    delete process.env.PAQAD_FRAMEWORK_HOME;
    try {
      const { framework_home } = bootstrapFrameworkHome();
      expect(framework_home).toBe(join(homedir(), '.paqad-ai/current'));
      expect(lstatSync(framework_home).isSymbolicLink()).toBe(true);
      expect(existsSync(join(homedir(), '.claude', 'agents', 'paqad-development.md'))).toBe(true);
    } finally {
      if (previous !== undefined) process.env.PAQAD_FRAMEWORK_HOME = previous;
    }
  });
});
