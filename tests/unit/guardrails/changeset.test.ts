import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO = process.cwd();
const CHANGESET_BIN = join(REPO, 'node_modules/@changesets/cli/bin.js');

function mergeBase(): string | null {
  try {
    return execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

const BASE = mergeBase();
const NO_BASE = 'origin/main is not available in this checkout, so there is no base to compare';
const NO_CHANGE =
  'nothing has changed since origin/main, so there is no unreleased change to check';

interface ChangesetStatus {
  changesets: Array<{ id: string }>;
  releases: Array<{ name: string; type: string }>;
}

describe('the release changeset', { timeout: 60_000 }, () => {
  it('AC-70: changeset status passes and releases paqad-ai as a patch', (ctx) => {
    if (!BASE) return ctx.skip(NO_BASE);
    const dir = mkdtempSync(join(tmpdir(), 'paqad-changeset-status-'));
    try {
      const output = join(dir, 'status.json');
      const result = spawnSync(
        process.execPath,
        [CHANGESET_BIN, 'status', `--since=${BASE}`, `--output=${output}`],
        { cwd: REPO, encoding: 'utf8' },
      );
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const status = JSON.parse(readFileSync(output, 'utf8')) as ChangesetStatus;
      if (status.changesets.length === 0 && status.releases.length === 0) {
        return ctx.skip(NO_CHANGE);
      }
      expect(status.releases).toContainEqual(
        expect.objectContaining({ name: 'paqad-ai', type: 'patch' }),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
