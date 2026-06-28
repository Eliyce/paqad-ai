import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const adapter = require(resolve(__dirname, '../../../.changeset/changelog-resilient.cjs')) as {
  getReleaseLine: (changeset: unknown, type: unknown, opts: unknown) => Promise<string>;
  getDependencyReleaseLine: (changesets: unknown, deps: unknown, opts: unknown) => Promise<string>;
  _setGithubChangelogForTests: (impl: unknown) => void;
  fallbackReleaseLine: (changeset: { summary: string }) => string;
  fallbackDependencyReleaseLine: (
    changesets: unknown,
    deps: Array<{ name: string; newVersion: string }>,
  ) => string;
};

const CHANGESET = {
  id: 'x',
  summary: 'Fix the thing\nmore detail',
  releases: [],
  commit: 'abc123',
};

afterEach(() => {
  // Restore the real implementation so one test never leaks into another.
  adapter._setGithubChangelogForTests(require('@changesets/changelog-github').default);
});

describe('resilient changelog adapter', () => {
  it('returns the GitHub changelog line when the API succeeds', async () => {
    adapter._setGithubChangelogForTests({
      getReleaseLine: async () => '\n\n- rich GitHub line (#42)',
      getDependencyReleaseLine: async () => '\n\n- deps',
    });
    expect(await adapter.getReleaseLine(CHANGESET, 'patch', { repo: 'Eliyce/paqad-ai' })).toBe(
      '\n\n- rich GitHub line (#42)',
    );
    expect(await adapter.getDependencyReleaseLine([], [], { repo: 'Eliyce/paqad-ai' })).toBe(
      '\n\n- deps',
    );
  });

  it('falls back to a git-style line when the GitHub API throws (the release-flake fix)', async () => {
    adapter._setGithubChangelogForTests({
      getReleaseLine: async () => {
        throw new Error('Invalid response body … Premature close');
      },
      getDependencyReleaseLine: async () => {
        throw new Error('Premature close');
      },
    });
    expect(await adapter.getReleaseLine(CHANGESET, 'patch', { repo: 'Eliyce/paqad-ai' })).toBe(
      '\n\n- Fix the thing\n  more detail',
    );
    expect(
      await adapter.getDependencyReleaseLine([], [{ name: 'a', newVersion: '1.2.3' }], {}),
    ).toBe('\n\n- Updated dependencies:\n  - a@1.2.3');
  });

  it('fallback formatters are pure and shape-correct', () => {
    expect(adapter.fallbackReleaseLine({ summary: 'Single line' })).toBe('\n\n- Single line');
    expect(adapter.fallbackDependencyReleaseLine([], [])).toBe('');
  });
});
