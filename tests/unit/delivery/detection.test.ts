import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  detectDelivery,
  detectBranchTemplate,
  detectCommitConvention,
  detectBase,
  detectHost,
  hasDetection,
  overlayDetection,
  summarizeDetection,
  type GitSnapshot,
} from '@/delivery/detection.js';
import { readDetection, writeDetection } from '@/delivery/detection-store.js';
import {
  buildConnectNudge,
  gatherGitSnapshot,
  runDeliveryDetection,
} from '@/delivery/detect-run.js';
import type { DeliveryShell } from '@/delivery/runner.js';
import { defaultDeliveryProcess, loadDeliveryPolicy } from '@/pipeline/delivery-policy.js';
import { PATHS } from '@/core/constants/paths.js';
import { mkdirSync, writeFileSync } from 'node:fs';

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
    expect(d?.value).toBe('{type}/{ticket}-{title_slug}');
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

describe('detection — overlay respects maintained', () => {
  const detected = detectDelivery({
    remoteUrl: 'git@github.com:o/r.git',
    defaultBranch: 'origin/develop',
    branchNames: ['PQD-1-x', 'PQD-2-y'],
    recentCommitSubjects: ['plain commit', 'another plain one'],
  });

  it('fills auto sections', () => {
    const out = overlayDetection(defaultDeliveryProcess(), detected, () => true);
    expect(out.host.provider).toBe('github');
    expect(out.branch.base).toBe('develop');
    expect(out.branch.template).toBe('{ticket}-{title_slug}');
    // non-conventional commits → freeform template
    expect(out.commit.template).toBe('{summary}\n\nRefs: {ticket}');
  });

  it('skips a section flagged manual', () => {
    const out = overlayDetection(defaultDeliveryProcess(), detected, (s) => s !== 'branch');
    // branch was manual → defaults preserved
    expect(out.branch.base).toBe('main');
    expect(out.branch.template).toBe('{type}/{ticket}-{title_slug}');
    // host still filled
    expect(out.host.provider).toBe('github');
  });

  it('summarizeDetection produces human lines', () => {
    const lines = summarizeDetection(detected);
    expect(lines.some((l) => l.includes('github'))).toBe(true);
    expect(lines.some((l) => l.includes('base'))).toBe(true);
  });
});

describe('detection store + loader overlay', () => {
  it('round-trips the artifact and the loader overlays it onto auto sections', () => {
    const root = mkdtempSync(join(tmpdir(), 'detect-'));
    try {
      const detected = detectDelivery({
        remoteUrl: 'git@github.com:o/r.git',
        defaultBranch: 'origin/main',
        branchNames: ['feat/a', 'feat/b'],
        recentCommitSubjects: ['feat: a', 'fix: b'],
      });
      writeDetection(root, detected);
      expect(readDetection(root)).not.toBe(null);

      const { policy } = loadDeliveryPolicy(root);
      expect(policy.process.host.provider).toBe('github');
      expect(policy.process.branch.template).toBe('{type}/{ticket}-{title_slug}');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('project YAML marking a section manual blocks the overlay for it', () => {
    const root = mkdtempSync(join(tmpdir(), 'detect-'));
    try {
      writeDetection(
        root,
        detectDelivery({
          remoteUrl: 'git@github.com:o/r.git',
          defaultBranch: 'origin/develop',
          branchNames: ['PQD-1-x'],
          recentCommitSubjects: ['plain'],
        }),
      );
      const dir = join(root, PATHS.WORKFLOWS_DIR);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'delivery-policy.yaml'),
        'schema_version: "1"\nprocess:\n  branch:\n    maintained: manual\n',
        'utf8',
      );
      const { policy } = loadDeliveryPolicy(root);
      // branch is manual → default base kept, not the detected develop
      expect(policy.process.branch.base).toBe('main');
      // host is still auto → overlaid
      expect(policy.process.host.provider).toBe('github');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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

  it('runs detection end-to-end, persists, and builds a connect nudge', async () => {
    const root = mkdtempSync(join(tmpdir(), 'detect-run-'));
    try {
      const shell = shellFor({
        'remote get-url': 'git@github.com:o/r.git',
        'symbolic-ref': 'origin/main',
        'branch --all': 'main\nfeat/a\nfeat/b',
        'log -n': 'feat: a\nfix: b\nfeat: c',
      });
      const result = await runDeliveryDetection(root, shell);
      expect(result.filled).toBe(true);
      expect(result.connectNudge).toContain('GitHub');
      expect(result.connectNudge).toContain('Jira');
      expect(readDetection(root)).not.toBe(null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('buildConnectNudge always mentions the tracker', () => {
    expect(buildConnectNudge(detectDelivery(EMPTY))).toContain('Jira');
  });
});
