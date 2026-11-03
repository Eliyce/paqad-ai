import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';

import type { DeliveryShell } from '@/delivery/runner.js';
import {
  applyAnswers,
  classifySubject,
  commitTypeFor,
  gatherSignals,
  GitReadError,
  proposeFromSignals,
  readCiTargets,
  starterChoices,
  type PrRecord,
  type SetupSignals,
} from '@/git-workflow/setup.js';

type Route = (command: string, args: string[]) => { stdout?: string; exitCode?: number } | null;

function fakeShell(routes: Route[]): DeliveryShell {
  return {
    async run(command, args) {
      for (const route of routes) {
        const hit = route(command, args);
        if (hit) return { stdout: hit.stdout ?? '', stderr: '', exitCode: hit.exitCode ?? 0 };
      }
      return { stdout: '', stderr: 'not found', exitCode: 1 };
    },
  };
}

function signals(over: Partial<SetupSignals> = {}): SetupSignals {
  return {
    remote: 'git@github.com:acme/shop.git',
    defaultBranch: 'main',
    branches: ['main'],
    mainline: [],
    prs: null,
    mergeMethods: null,
    rules: null,
    ciTargets: [],
    codeowners: null,
    prTemplate: null,
    unknown: [],
    ...over,
  };
}

function repeat<T>(n: number, make: (i: number) => T): T[] {
  return Array.from({ length: n }, (_, i) => make(i));
}

function pr(over: Partial<PrRecord> = {}): PrRecord {
  return {
    number: 1,
    title: 'PROJ-1: show it',
    baseRefName: 'main',
    headRefName: 'feature/PROJ-1-show-it',
    labels: [],
    isDraft: false,
    ...over,
  };
}

function history(over: Partial<SetupSignals> = {}): SetupSignals {
  return signals({
    branches: ['main', ...repeat(10, (i) => `feature/PROJ-${i}-x`)],
    mainline: repeat(25, (i) => ({ subject: `PROJ-${i}: show it`, body: '' })),
    ...over,
  });
}

describe('git-workflow setup: reading files from the repository', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-setup-signals-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('returns no CI targets when there is no workflows folder', () => {
    expect(readCiTargets(root)).toEqual([]);
  });

  it('collects pull_request branches across workflows and skips unreadable or unrelated files', () => {
    const dir = join(root, '.github/workflows');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'ci.yml'), 'on:\n  pull_request:\n    branches: [main, qa, 7]\n');
    writeFileSync(join(dir, 'other.yaml'), 'on:\n  pull_request:\n    branches: [develop, main]\n');
    writeFileSync(join(dir, 'push.yaml'), 'on: push\n');
    writeFileSync(join(dir, 'nobranches.yaml'), 'on:\n  pull_request: {}\n');
    writeFileSync(join(dir, 'empty.yaml'), '');
    writeFileSync(join(dir, 'broken.yaml'), 'on: [unclosed\n');
    writeFileSync(join(dir, 'README.md'), 'on:\n  pull_request:\n    branches: [ignored]\n');
    expect(readCiTargets(root)).toEqual(['develop', 'main', 'qa']);
  });

  const gitOk: Route = (command, args) => {
    if (command !== 'git') return null;
    if (args[0] === 'rev-parse') return { stdout: '.git' };
    return null;
  };

  it('throws a GitReadError naming git when the folder is not a repository', async () => {
    const shell = fakeShell([
      (command) => (command === 'git' ? { stdout: 'not a git repo', exitCode: 128 } : null),
    ]);
    await expect(gatherSignals(shell, root)).rejects.toThrow(GitReadError);
    await expect(gatherSignals(shell, root)).rejects.toThrow('not a git repo');
  });

  it('falls back to main, no branches and no main line when git commands after rev-parse fail', async () => {
    const read = await gatherSignals(fakeShell([gitOk]), root);
    expect(read.remote).toBeNull();
    expect(read.defaultBranch).toBe('main');
    expect(read.branches).toEqual([]);
    expect(read.mainline).toEqual([]);
    expect(read.codeowners).toBeNull();
    expect(read.prTemplate).toBeNull();
  });

  it('treats an empty remote URL as no remote and an empty origin HEAD as main', async () => {
    const shell = fakeShell([
      gitOk,
      (command, args) =>
        command === 'git' && (args[0] === 'remote' || args[0] === 'symbolic-ref')
          ? { stdout: '  \n' }
          : null,
    ]);
    const read = await gatherSignals(shell, root);
    expect(read.remote).toBeNull();
    expect(read.defaultBranch).toBe('main');
  });

  it('reads PRs, merge methods, branch rules, CODEOWNERS and the PR template from gh and the tree', async () => {
    mkdirSync(join(root, '.github'), { recursive: true });
    writeFileSync(join(root, '.github/CODEOWNERS'), '* @acme/devs\n');
    writeFileSync(join(root, 'pull_request_template.md'), '## Why\n');
    const shell = fakeShell([
      gitOk,
      (command, args) => {
        if (command !== 'git') return null;
        if (args[0] === 'symbolic-ref') return { stdout: 'origin/develop\n' };
        if (args[0] === 'log') {
          return { stdout: 'PROJ-1: one\x1fbody\nSigned-off-by: a\x1e\nnot a record\x1e' };
        }
        return null;
      },
      (command, args) => {
        if (command !== 'gh') return null;
        if (args[0] === 'pr') {
          return {
            stdout: JSON.stringify([
              {
                number: 7,
                title: 'PROJ-7: x',
                baseRefName: 'develop',
                headRefName: 'feature/PROJ-7',
                labels: [{ name: 'team' }, { name: '' }, {}],
                isDraft: true,
              },
              { number: '8' },
            ]),
          };
        }
        if (args[0] === 'repo') {
          return {
            stdout: JSON.stringify({
              squashMergeAllowed: false,
              mergeCommitAllowed: true,
              rebaseMergeAllowed: true,
              nameWithOwner: 'acme/shop',
            }),
          };
        }
        if (args[0] === 'api') {
          expect(args[1]).toBe('repos/acme/shop/rules/branches/develop');
          return { stdout: '[{},{}]' };
        }
        return null;
      },
    ]);
    const read = await gatherSignals(shell, root);
    expect(read.defaultBranch).toBe('develop');
    expect(read.mainline).toEqual([{ subject: 'PROJ-1: one', body: 'body\nSigned-off-by: a' }]);
    expect(read.prs).toEqual([
      {
        number: 7,
        title: 'PROJ-7: x',
        baseRefName: 'develop',
        headRefName: 'feature/PROJ-7',
        labels: ['team'],
        isDraft: true,
      },
      { number: 8, title: '', baseRefName: '', headRefName: '', labels: [], isDraft: false },
    ]);
    expect(read.mergeMethods).toEqual(['merge', 'rebase']);
    expect(read.rules).toBe(2);
    expect(read.unknown).toEqual([]);
    expect(read.codeowners).toBe('.github/CODEOWNERS');
    expect(read.prTemplate).toBe('pull_request_template.md');
  });

  it('says what it could not read when gh answers with something that is not JSON', async () => {
    mkdirSync(join(root, '.github/PULL_REQUEST_TEMPLATE'), { recursive: true });
    writeFileSync(join(root, '.github/PULL_REQUEST_TEMPLATE/b.md'), 'b');
    writeFileSync(join(root, '.github/PULL_REQUEST_TEMPLATE/a.md'), 'a');
    const shell = fakeShell([
      gitOk,
      (command, args) => {
        if (command !== 'gh') return null;
        if (args[0] === 'pr' || args[0] === 'repo') return { stdout: 'not json' };
        return null;
      },
    ]);
    const read = await gatherSignals(shell, root);
    expect(read.prs).toBeNull();
    expect(read.mergeMethods).toBeNull();
    expect(read.unknown).toEqual([
      "pull requests: gh's answer couldn't be read",
      "merge methods: gh's answer couldn't be read",
      "branch protection: GitHub didn't show it to this account (needs admin)",
    ]);
    expect(read.prTemplate).toBe('.github/PULL_REQUEST_TEMPLATE/a.md');
  });

  it('treats an unreadable rules answer and a missing repository name as unknown protection', async () => {
    const withName = fakeShell([
      gitOk,
      (command, args) => {
        if (command !== 'gh') return null;
        if (args[0] === 'repo') return { stdout: JSON.stringify({ nameWithOwner: 'acme/shop' }) };
        if (args[0] === 'api') return { stdout: '<html>' };
        return null;
      },
    ]);
    const first = await gatherSignals(withName, root);
    expect(first.rules).toBeNull();
    expect(first.mergeMethods).toEqual([]);

    const noName = fakeShell([
      gitOk,
      (command, args) => (command === 'gh' && args[0] === 'repo' ? { stdout: '{}' } : null),
    ]);
    const second = await gatherSignals(noName, root);
    expect(second.rules).toBeNull();
    expect(second.unknown).toContain(
      "branch protection: GitHub didn't show it to this account (needs admin)",
    );
  });

  it('gives no template path for an empty PULL_REQUEST_TEMPLATE folder', async () => {
    mkdirSync(join(root, '.github/PULL_REQUEST_TEMPLATE'), { recursive: true });
    const read = await gatherSignals(fakeShell([gitOk]), root);
    expect(read.prTemplate).toBeNull();
  });
});

describe('git-workflow setup: helpers', () => {
  it('maps branch segments to commit types', () => {
    expect(commitTypeFor('feature')).toBe('feat');
    expect(commitTypeFor('hotfix')).toBe('fix');
    expect(commitTypeFor('bug')).toBe('fix');
    expect(commitTypeFor('chore')).toBe('chore');
  });

  it('classifies ticket-first, plain and summary-only subjects', () => {
    expect(classifySubject('PROJ-1: add it', ['PROJ-\\d+'])).toBe('{ticket}: {summary}');
    expect(classifySubject('PROJ-1 add it', ['PROJ-\\d+'])).toBe('{ticket} {summary}');
    expect(classifySubject('feat: add it', [])).toBe('{type}({scope}): {summary}');
    expect(classifySubject('Add it', ['PROJ-\\d+'])).toBe('{summary}');
  });

  it('builds starter edits for every tracker and target answer', () => {
    const byId = Object.fromEntries(starterChoices().map((c) => [c.id, c]));
    expect(byId['tickets.tracker'].edits('servicenow')[0].value).toEqual({
      servicenow: {
        tracker: 'servicenow',
        pattern: '(INC|RITM|CHG|PRB|TASK)\\d{7}',
        server: '',
        transitions: { on_pr_open: '', on_ci_green: '' },
      },
    });
    expect(byId['tickets.tracker'].edits('github-issues')[0].value).toHaveProperty('github');
    expect(byId['tickets.tracker'].edits('none')[0].value).toEqual({});
    expect(byId['tickets.example'].edits('X-1')).toEqual([]);
    expect(byId['pull_requests.extra_target'].edits('qa')[0].value).toEqual(['qa']);
    expect(byId['pull_requests.extra_target'].edits('no')[0].value).toEqual([]);
    expect(byId['branches.releases'].edits('no')).toEqual([]);
    expect(byId['branches.hotfix'].edits('yes')).toEqual([]);
    expect(byId['commits.template'].edits('{summary}')).toHaveLength(2);
  });
});

describe('git-workflow setup: proposing from PRs and repository settings', () => {
  it('picks a release/* base, drafts, and global and per-type labels', () => {
    const prs = [
      ...repeat(6, (i) =>
        pr({
          number: i,
          headRefName: `feature/PROJ-${i}`,
          baseRefName: 'release/1.0',
          labels: ['team', 'feature'],
          isDraft: true,
        }),
      ),
      ...repeat(4, (i) =>
        pr({
          number: 10 + i,
          headRefName: `PROJ-${i}`,
          baseRefName: 'main',
          labels: ['team'],
        }),
      ),
    ];
    const built = proposeFromSignals(history({ prs }));
    const branches = YAML.parse(built.proposal.files['branches.yaml']);
    expect(branches.base_branch).toBe('release/*');
    expect(branches.types.feature.labels).toEqual(['feature']);
    const pulls = YAML.parse(built.proposal.files['pull-requests.yaml']);
    expect(pulls.draft).toBe(true);
    expect(pulls.labels).toEqual(['team']);
    expect(built.proposal.evidence).toContainEqual(
      expect.objectContaining({ key: 'base_branch', value: 'release/*' }),
    );
  });

  it('asks whether every change also gets a PR to a second branch most heads also target', () => {
    const prs = [
      ...repeat(5, (i) => pr({ number: i, headRefName: `feature/PROJ-${i}`, baseRefName: 'main' })),
      ...repeat(5, (i) =>
        pr({ number: 10 + i, headRefName: `feature/PROJ-${i}`, baseRefName: 'qa' }),
      ),
      pr({ number: 99, headRefName: 'other', baseRefName: 'develop' }),
    ];
    const built = proposeFromSignals(history({ prs }));
    const choice = built.proposal.choices.find((c) => c.id === 'pull_requests.also_open_against');
    expect(choice?.question).toBe('Should every change also get a PR to qa?');
    const internal = built.choices.find((c) => c.id === 'pull_requests.also_open_against')!;
    expect(internal.edits('qa')[0].value).toEqual(['qa']);
    expect(internal.edits('no')[0].value).toEqual([]);
    const applied = applyAnswers(built, { 'pull_requests.also_open_against': 'qa' });
    expect(YAML.parse(applied.contents['pull-requests.yaml']!).also_open_against).toEqual(['qa']);
  });

  it('uses all PRs as the pool when none come from a typed branch and keeps the default base', () => {
    const prs = repeat(4, (i) => pr({ number: i, headRefName: `PROJ-${i}`, baseRefName: 'main' }));
    const built = proposeFromSignals(history({ prs }));
    expect(YAML.parse(built.proposal.files['branches.yaml']).base_branch).toBe('main');
    expect(built.proposal.evidence).toContainEqual(
      expect.objectContaining({ key: 'base_branch', because: '4 of 4 PRs went to main' }),
    );
  });

  it('switches the base branch when most PRs target another branch', () => {
    const prs = repeat(4, (i) => pr({ number: i, baseRefName: 'develop' }));
    const built = proposeFromSignals(history({ prs }));
    expect(YAML.parse(built.proposal.files['branches.yaml']).base_branch).toBe('develop');
  });

  it('records squash-only merging, branch rules, CI targets, CODEOWNERS, sign-off and the PR template as evidence', () => {
    const built = proposeFromSignals(
      history({
        mainline: repeat(25, (i) => ({
          subject: `PROJ-${i}: show it (#${i})`,
          body: 'Signed-off-by: dev <dev@acme.test>',
        })),
        mergeMethods: ['squash'],
        rules: 3,
        ciTargets: ['main', 'qa'],
        codeowners: 'CODEOWNERS',
        prTemplate: '.github/pull_request_template.md',
      }),
    );
    const because = built.proposal.evidence.map((e) => e.because);
    expect(because).toContain('PRs are squash-merged: only the PR title lands on main');
    expect(because).toContain('3 branch rules protect main');
    expect(because).toContain('CI runs on PRs to main, qa');
    expect(because).toContain(
      'CODEOWNERS already asks code owners to review, so no reviewers are added',
    );
    expect(because).toContain('25 of 25 commits carry Signed-off-by');
    const commits = YAML.parse(built.proposal.files['commits.yaml']);
    expect(commits.sign_off).toBe(true);
    const pulls = YAML.parse(built.proposal.files['pull-requests.yaml']);
    expect(pulls.body_template).toBe('.github/pull_request_template.md');
  });

  it('adds a GitHub issues source when commit subjects name issues often enough', () => {
    const built = proposeFromSignals(
      history({
        mainline: repeat(25, (i) => ({ subject: `Fix the list for #${i + 1}`, body: '' })),
      }),
    );
    const tickets = YAML.parse(built.proposal.files['tickets.yaml']);
    expect(tickets.sources.github.tracker).toBe('github-issues');
  });

  it('asks how branch names start when typed and ticket-first branches are split', () => {
    const built = proposeFromSignals(
      signals({
        branches: [
          'main',
          ...repeat(6, (i) => `feature/PROJ-${i}-x`),
          ...repeat(5, (i) => `PROJ-${i + 10}-y`),
          'revert-12-thing',
          'renovate/lodash',
        ],
        mainline: repeat(25, (i) => ({ subject: `PROJ-${i}: show it`, body: '' })),
      }),
    );
    const choice = built.proposal.choices.find((c) => c.id === 'branches.template');
    expect(choice?.options.map((o) => o.id)).toEqual([
      '{prefix}/{ticket}-{title_slug}',
      '{ticket}-{title_slug}',
    ]);
    const internal = built.choices.find((c) => c.id === 'branches.template')!;
    expect(internal.edits('{ticket}-{title_slug}')[0].value).toBe('{ticket}-{title_slug}');
  });

  it('asks a separate PR title question when titles are split differently from commits', () => {
    const prs = [
      ...repeat(5, (i) => pr({ number: i, title: `PROJ-${i}: a` })),
      ...repeat(5, (i) => pr({ number: 10 + i, title: `Plain title ${i}` })),
    ];
    const built = proposeFromSignals(history({ prs }));
    const title = built.choices.find((c) => c.id === 'pull_requests.title_template')!;
    expect(title).toBeDefined();
    expect(title.edits('{summary}')).toEqual([
      { file: 'pull-requests.yaml', path: ['title_template'], value: '{summary}' },
    ]);
    const commits = YAML.parse(built.proposal.files['commits.yaml']);
    expect(commits.template).toBe('{ticket}: {summary}');
  });

  it('decides the PR title template from PR titles when one format clearly wins', () => {
    const prs = repeat(5, (i) => pr({ number: i, title: `Plain title ${i}` }));
    const built = proposeFromSignals(history({ prs }));
    const pulls = YAML.parse(built.proposal.files['pull-requests.yaml']);
    expect(pulls.title_template).toBe('{summary}');
  });

  it('folds the PR title into the commit question when there are no PRs and commits are split', () => {
    const built = proposeFromSignals(
      history({
        mainline: [
          ...repeat(13, (i) => ({ subject: `PROJ-${i}: show it`, body: '' })),
          ...repeat(12, (i) => ({ subject: `Show it ${i}`, body: '' })),
        ],
      }),
    );
    const commit = built.choices.find((c) => c.id === 'commits.template')!;
    expect(built.choices.some((c) => c.id === 'pull_requests.title_template')).toBe(false);
    expect(commit.edits('{summary}')).toEqual([
      { file: 'commits.yaml', path: ['template'], value: '{summary}' },
      { file: 'pull-requests.yaml', path: ['title_template'], value: '{summary}' },
    ]);
  });

  it('proposes nothing about commits when every main-line subject is a merge or revert', () => {
    const built = proposeFromSignals(
      history({
        mainline: repeat(25, (i) => ({ subject: `Merge pull request #${i}`, body: '' })),
      }),
    );
    expect(built.decided.some((e) => e.file === 'commits.yaml')).toBe(false);
  });
});

describe('git-workflow setup: applying answers', () => {
  it('rejects an answer that is not one of the options', () => {
    const built = proposeFromSignals(signals({ remote: null }));
    expect(() => applyAnswers(built, { 'branches.hotfix': 'maybe' })).toThrow(
      'branches.hotfix: "maybe" isn\'t one of the options (yes, no).',
    );
  });

  it('skips the example question without a not-confirmed note when there are no tickets', () => {
    const built = proposeFromSignals(signals({ remote: null }));
    const applied = applyAnswers(built, {
      'tickets.tracker': 'none',
      'tickets.example': 'IGNORED-1',
      'pull_requests.extra_target': 'staging',
      'branches.releases': 'no',
      'branches.hotfix': 'yes',
      'commits.template': '{summary}',
    });
    expect(applied.notConfirmed).toEqual([]);
    expect(YAML.parse(applied.contents['tickets.yaml']!).sources).toEqual({});
    expect(YAML.parse(applied.contents['pull-requests.yaml']!).also_open_against).toEqual([
      'staging',
    ]);
  });

  it('notes the unanswered example question when a tracker was picked', () => {
    const built = proposeFromSignals(signals({ remote: null }));
    const applied = applyAnswers(built, {
      'tickets.tracker': 'servicenow',
      'pull_requests.extra_target': 'no',
      'branches.releases': 'no',
      'branches.hotfix': 'yes',
      'commits.template': '{summary}',
    });
    expect(applied.notConfirmed).toEqual([
      'not confirmed: What does one of your ticket keys look like? (only asked when a tracker was picked)',
    ]);
  });

  it('writes a pattern built from the example key under the picked tracker', () => {
    const built = proposeFromSignals(signals({ remote: null }));
    const applied = applyAnswers(built, {
      'tickets.tracker': 'servicenow',
      'tickets.example': 'INC0012345',
    });
    expect(YAML.parse(applied.contents['tickets.yaml']!).sources.servicenow.pattern).toBe(
      '[A-Z]+\\d+',
    );
  });
});
