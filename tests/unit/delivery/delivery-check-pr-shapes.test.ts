import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  evaluateDelivery,
  rollupJobs,
  type CommandRun,
  type CommandRunner,
} from '@/delivery/delivery-check.js';
import { defaultGitWorkflow } from '@/git-workflow/defaults.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-delivery-pr-shapes-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function runner(branch: string, gh: CommandRun, log?: CommandRun): CommandRunner {
  return async (command, args) => {
    if (command === 'gh') return gh;
    if (args.includes('--abbrev-ref')) return { stdout: `${branch}\n`, exitCode: 0 };
    if (args.includes('@{upstream}')) return { stdout: '   \n', exitCode: 0 };
    if (args.includes('rev-parse')) return { stdout: 'a'.repeat(40), exitCode: 0 };
    if (args.includes('log')) return log ?? { stdout: '', exitCode: 128 };
    return { stdout: '', exitCode: 0 };
  };
}

describe('delivery check: unusual PR answers', () => {
  it('reads a PR with no number, labels that are not a list and red CI', async () => {
    const policy = defaultGitWorkflow();
    const gh = {
      stdout: JSON.stringify({
        state: 'OPEN',
        labels: 'team',
        statusCheckRollup: [{ conclusion: 'FAILURE' }],
      }),
      exitCode: 0,
    };
    const result = await evaluateDelivery({
      projectRoot: root,
      policy,
      run: runner('feature/add-login', gh),
    });
    expect(result.upstream).toBeNull();
    expect(result.pr?.number).toBeNull();
    expect(result.findings).toContainEqual({
      code: 'ci-red',
      message: 'CI is red — the delivery policy gates merge on green (`wait_for_green`).',
    });
  });

  it('skips the commit check for a branch whose base is a glob, and when git log fails on both refs', async () => {
    const policy = defaultGitWorkflow();
    policy.branches.types.feature.base_branch = 'release/*';
    const noPr = { stdout: '', stderr: 'no pull requests found', exitCode: 1 };
    const glob = await evaluateDelivery({
      projectRoot: root,
      policy,
      run: runner('feature/add-login', noPr, { stdout: 'fix\x1f\x1e', exitCode: 0 }),
    });
    expect(glob.findings.filter((f) => f.code.startsWith('commit'))).toEqual([]);
    const failing = await evaluateDelivery({
      projectRoot: root,
      policy: defaultGitWorkflow(),
      run: runner('bugfix/x', noPr),
    });
    expect(failing.findings.filter((f) => f.code.startsWith('commit'))).toEqual([]);
    expect(failing.ci).toMatchObject({ reason: 'no pull request for this branch' });
  });

  it('reads no jobs from a rollup that is not a list', () => {
    expect(rollupJobs(null)).toEqual([]);
    expect(rollupJobs([{ state: 'SUCCESS' }])).toEqual([
      { status: 'SUCCESS', conclusion: null, started_at: null, completed_at: null },
    ]);
  });
});
