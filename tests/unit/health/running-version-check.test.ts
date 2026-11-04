import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HealthChecker } from '@/health/checker.js';
import { runningFromPlugin, runningVersionHealth } from '@/health/running-version-check.js';
import { VERSION } from '@/index.js';
import { FrameworkUpdater } from '@/update/index.js';

const NPM_ROOT = '/usr/local/lib/node_modules/paqad-ai';
const PLUGIN_ROOT = '/opt/tools/plugins/cache/eliyce/paqad/1.118.0';

describe('doctor when the running CLI is older than the repo', () => {
  let root: string;
  const versionFile = () => join(root, '.paqad/framework-version.txt');
  const record = (text: string) => writeFileSync(versionFile(), text);
  const stamped = (version: string) => `version=${version}\nupdated_at=2020-01-01T00:00:00.000Z\n`;
  const run = (running: string, packageRoot = NPM_ROOT) =>
    runningVersionHealth(root, { running, packageRoot });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-running-version-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('AC-30: gives one warning with the npm command when an npm binary is older', () => {
    record(stamped('1.119.0'));
    expect(run('1.118.0')).toEqual([
      {
        name: 'paqad-ai version',
        status: 'warning',
        detail:
          'This paqad-ai is 1.118.0, but this repo was last updated with 1.119.0 on this machine. Run npm i -g paqad-ai@latest.',
        remediation: 'Run npm i -g paqad-ai@latest.',
      },
    ]);
  });

  it('AC-30: names the plugin command and a new session when the plugin binary is older', () => {
    record(stamped('1.119.0'));
    const [result] = run('1.118.0', PLUGIN_ROOT);
    expect(result!.remediation).toBe(
      "Run claude plugin update paqad@eliyce, then start a new session, because this session's PATH still points at the old one.",
    );
  });

  it('AC-14: picks the command from the running binary, and the warning clears once it is updated', () => {
    expect(runningFromPlugin(PLUGIN_ROOT)).toBe(true);
    expect(runningFromPlugin('D:\\tools\\plugins\\cache\\eliyce\\paqad\\1.0.0')).toBe(true);
    expect(runningFromPlugin(NPM_ROOT)).toBe(false);
    record(stamped('1.119.0'));
    expect(run('1.118.0')).toHaveLength(1);
    expect(run('1.119.0')).toEqual([]);
  });

  it.each([
    ['equal', '1.119.0', '1.119.0', 0],
    ['newer CLI', '1.119.0', '1.120.0', 0],
    ['older CLI on a prerelease', '1.120.0-beta.1', '1.119.0', 1],
    ['same core as a prerelease', '1.120.0-beta.1', '1.120.0', 0],
    ['newer CLI than a prerelease', '1.120.0-beta.1', '1.121.0', 0],
    ['malformed', 'banana', '1.0.0', 0],
    ['empty', '', '1.0.0', 0],
  ])('AC-29: %s gives %#', (_name, repo, running, count) => {
    record(stamped(repo));
    expect(run(running)).toHaveLength(count);
  });

  it('AC-29: a file that is missing or holds no fields gives no warning', () => {
    expect(run('1.0.0')).toEqual([]);
    record('');
    expect(run('1.0.0')).toEqual([]);
    record('version-without-equals\n');
    expect(run('1.0.0')).toEqual([]);
  });

  it('AC-29: a mismatch never fails doctor', async () => {
    record(stamped('999.0.0'));
    const report = await new HealthChecker().run(root);
    const rows = report.checks.filter((check) => check.name === 'paqad-ai version');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('warning');
  });

  it('FR-55: update never lowers the recorded version, and raises a lower one', async () => {
    record(stamped('999.0.0'));
    const updater = new FrameworkUpdater({ generateCandidates: async () => [] });
    await updater.run(root);
    expect(readFileSync(versionFile(), 'utf8')).toBe(stamped('999.0.0'));
    record(stamped('0.0.1'));
    await updater.run(root);
    expect(readFileSync(versionFile(), 'utf8')).toContain(`version=${VERSION}\n`);
  });
});
