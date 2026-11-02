import {
  detectDelivery,
  detectBranchTemplate,
  detectCommitConvention,
  detectBase,
  detectHost,
  gatherGitSnapshot,
  hasDetection,
  summarizeDetection,
  type GitSnapshot,
} from '@/git-workflow/setup.js';
import type { DeliveryShell } from '@/delivery/runner.js';

const EMPTY: GitSnapshot = {
  remoteUrl: null,
  defaultBranch: null,
  branchNames: [],
  recentCommitSubjects: [],
};

describe('detection — pure inference', () => {
  it('detects the github host from the remote', () => {
    expect(detectHost('git@github.com:o/r.git')?.value).toBe('github');
    expect(detectHost('https://gitlab.com/o/r.git')?.value).toBe('gitlab');
    expect(detectHost(null)).toBe(null);
  });

  it('detects the base branch from the remote default, then from known names', () => {
    expect(detectBase({ ...EMPTY, defaultBranch: 'origin/develop' })?.value).toBe('develop');
    expect(detectBase({ ...EMPTY, branchNames: ['feature/x', 'main'] })?.value).toBe('main');
    expect(detectBase(EMPTY)).toBe(null);
  });

  it('detects a typed branch template and reports evidence', () => {
    const d = detectBranchTemplate({
      ...EMPTY,
      branchNames: ['main', 'feat/a', 'feat/b', 'fix/c', 'chore/d'],
    });
    expect(d?.value).toBe('{prefix}/{ticket}-{title_slug}');
    expect(d?.evidence).toContain('4/4');
  });

  it('detects a ticket-first branch template', () => {
    const d = detectBranchTemplate({
      ...EMPTY,
      branchNames: ['main', 'PQD-1-foo', 'PQD-2-bar'],
    });
    expect(d?.value).toBe('{ticket}-{title_slug}');
  });

  it('detects conventional commits by majority', () => {
    const conv = detectCommitConvention({
      ...EMPTY,
      recentCommitSubjects: ['feat: a', 'fix(x): b', 'random thing', 'chore: c'],
    });
    expect(conv?.value).toBe(true);
    const free = detectCommitConvention({
      ...EMPTY,
      recentCommitSubjects: ['did a thing', 'another thing', 'feat: only one'],
    });
    expect(free?.value).toBe(false);
  });

  it('hasDetection is false for an empty repo snapshot', () => {
    expect(hasDetection(detectDelivery(EMPTY))).toBe(false);
  });
});

describe('detection — summary', () => {
  it('summarizeDetection produces human lines', () => {
    const lines = summarizeDetection(
      detectDelivery({
        remoteUrl: 'git@github.com:o/r.git',
        defaultBranch: 'origin/develop',
        branchNames: ['PQD-1-x', 'PQD-2-y'],
        recentCommitSubjects: ['plain commit', 'another plain one'],
      }),
    );
    expect(lines.some((l) => l.includes('github'))).toBe(true);
    expect(lines.some((l) => l.includes('base'))).toBe(true);
  });
});

describe('detect-run with a fake shell', () => {
  function shellFor(map: Record<string, string>): DeliveryShell {
    return {
      async run(_command, args) {
        const key = args.join(' ');
        const match = Object.entries(map).find(([k]) => key.startsWith(k));
        return { stdout: match ? match[1] : '', stderr: '', exitCode: match ? 0 : 1 };
      },
    };
  }

  it('gathers a snapshot from git output', async () => {
    const shell = shellFor({
      'remote get-url': 'git@github.com:o/r.git',
      'symbolic-ref': 'origin/main',
      'branch --all': 'main\nfeat/a\norigin/feat/a',
      'log -n': 'feat: a\nfix: b',
    });
    const snap = await gatherGitSnapshot(shell);
    expect(snap.remoteUrl).toBe('git@github.com:o/r.git');
    expect(snap.defaultBranch).toBe('origin/main');
    expect(snap.recentCommitSubjects).toEqual(['feat: a', 'fix: b']);
  });
});
