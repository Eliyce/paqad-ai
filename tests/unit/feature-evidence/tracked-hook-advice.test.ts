import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  GIT_WORKFLOW_HOOK_MARKER,
  installGitHooks,
  trackedWorkflowHookAdvice,
  workflowHookBlock,
  workflowHooksInstalled,
} from '@/feature-evidence/git-hooks.js';
import { stampLastApplied } from '@/git-workflow/last-applied.js';
import { gitWorkflowHealth } from '@/health/git-workflow-check.js';

const roots: string[] = [];
const COMMIT_LINE =
  'if command -v paqad-ai >/dev/null 2>&1; then paqad-ai git-workflow check-commit "$1" || exit 1; fi';
const PUSH_LINE =
  'if command -v paqad-ai >/dev/null 2>&1; then paqad-ai git-workflow check-push || exit 1; fi';

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function write(root: string, rel: string, text: string): void {
  const path = join(root, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

function trackedRepo(hooksPath: string, tracked: Record<string, string>, people = 'warn'): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-tracked-hooks-'));
  roots.push(root);
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'h@example.test');
  git(root, 'config', 'user.name', 'Hooks');
  git(root, 'config', 'core.hooksPath', hooksPath);
  for (const [rel, text] of Object.entries(tracked)) write(root, rel, text);
  git(root, 'add', '-f', '.');
  git(root, 'commit', '-q', '-m', 'ship hooks', '--no-verify');
  write(root, '.paqad/configs/git-workflow/enforcement.yaml', `people: ${people}\n`);
  stampLastApplied(root);
  return root;
}

function husky(root = '.husky'): Record<string, string> {
  return {
    [`${root}/_/h`]: '#!/usr/bin/env sh\nexit 0\n',
    [`${root}/_/commit-msg`]: '#!/usr/bin/env sh\n. "$(dirname "$0")/h"\n',
    [`${root}/_/pre-push`]: '#!/usr/bin/env sh\n. "$(dirname "$0")/h"\n',
  };
}

function gitWorkflowWarnings(root: string): string[] {
  return gitWorkflowHealth(root)
    .filter((result) => result.status === 'warning')
    .map((result) => result.detail);
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('advice for a tracked hooks folder', () => {
  it('AC-12: keeps the wording and prints each hook file on its own with its own line', () => {
    const root = trackedRepo('.githooks', {
      '.githooks/commit-msg': '#!/bin/sh\necho team\n',
      '.githooks/pre-push': '#!/bin/sh\necho team\n',
    });
    expect(trackedWorkflowHookAdvice(root)).toBe(
      [
        "Your git hooks are in .githooks, which your repo tracks, so paqad didn't change them.",
        'Add these lines to commit-msg and pre-push so people get the workflow check:',
        '.githooks/commit-msg:',
        GIT_WORKFLOW_HOOK_MARKER,
        COMMIT_LINE,
        '.githooks/pre-push:',
        GIT_WORKFLOW_HOOK_MARKER,
        PUSH_LINE,
        'The check is skipped in a terminal where paqad-ai is not on the PATH.',
      ].join('\n'),
    );
  });

  it('never writes to the tracked folder', () => {
    const root = trackedRepo('.githooks', { '.githooks/commit-msg': '#!/bin/sh\n' });
    const result = installGitHooks(root);
    expect(result.trackedHooksDir).toBe(true);
    expect(result.installed).toEqual([]);
    expect(git(root, 'status', '--porcelain', '.githooks')).toBe('');
  });

  it('lists only what is still missing', () => {
    const root = trackedRepo('.githooks', {
      '.githooks/commit-msg': `#!/bin/sh\n${workflowHookBlock('commit-msg')}\n`,
      '.githooks/pre-push': '#!/bin/sh\n',
    });
    chmodSync(join(root, '.githooks/commit-msg'), 0o755);
    const advice = trackedWorkflowHookAdvice(root)!;
    expect(advice).toContain('.githooks/pre-push:');
    expect(advice).not.toContain('.githooks/commit-msg');
    expect(advice).not.toContain('check-commit');
  });

  it('gives the shebang and the executable step for a file that does not exist yet', () => {
    const root = trackedRepo('.githooks', { '.githooks/pre-push': '#!/bin/sh\n' });
    const advice = trackedWorkflowHookAdvice(root)!;
    expect(advice).toContain(
      ".githooks/commit-msg doesn't exist yet. Create it with these lines, then run chmod +x .githooks/commit-msg, or git update-index --chmod=+x .githooks/commit-msg from Windows:\n#!/bin/sh\n# paqad-ai git-workflow",
    );
    expect(advice).not.toContain(".githooks/pre-push doesn't exist yet");
  });

  it('gives no lines when people is off', () => {
    const root = trackedRepo('.githooks', { '.githooks/commit-msg': '#!/bin/sh\n' }, 'off');
    expect(trackedWorkflowHookAdvice(root)).toBeNull();
    expect(gitWorkflowWarnings(root)).toEqual([]);
  });

  it('gives no advice for an untracked hooks folder', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-tracked-hooks-'));
    roots.push(root);
    git(root, 'init', '-q');
    expect(trackedWorkflowHookAdvice(root)).toBeNull();
  });

  it('join lists post-commit and post-merge too, each with its own verb', () => {
    const root = trackedRepo('.githooks', { '.githooks/commit-msg': '#!/bin/sh\n' });
    const { snippet } = installGitHooks(root);
    expect(snippet).toContain('commit-msg');
    expect(snippet).toContain('post-commit:\n# paqad-ai delivery-link');
    expect(snippet).toContain('paqad-ai delivery-link commit');
    expect(snippet).toContain('post-merge:\n# paqad-ai delivery-link');
    expect(snippet).toContain('paqad-ai delivery-link merge');
  });
});

describe('doctor on a tracked hooks folder', () => {
  it('AC-12, AC-14: gives the same advice, never says to run update, and clears once the lines are added', () => {
    const root = trackedRepo('.githooks', {
      '.githooks/commit-msg': '#!/bin/sh\n',
      '.githooks/pre-push': '#!/bin/sh\n',
    });
    const [result] = gitWorkflowHealth(root);
    expect(result!.detail).toBe(trackedWorkflowHookAdvice(root));
    expect(result!.detail).not.toContain('Run paqad-ai update');
    expect(result!.remediation).not.toContain('Run paqad-ai update');
    for (const hook of ['commit-msg', 'pre-push']) {
      const path = join(root, '.githooks', hook);
      writeFileSync(path, `${readFileSync(path, 'utf8')}${workflowHookBlock(hook)}\n`);
      chmodSync(path, 0o755);
    }
    expect(gitWorkflowWarnings(root)).toEqual([]);
  });

  it('accepts a hand-added line with no marker and with CRLF', () => {
    const root = trackedRepo('.githooks', {
      '.githooks/commit-msg': `#!/bin/sh\r\n${COMMIT_LINE}\r\n`,
      '.githooks/pre-push': `#!/bin/sh\n${PUSH_LINE}\n`,
    });
    chmodSync(join(root, '.githooks/commit-msg'), 0o755);
    chmodSync(join(root, '.githooks/pre-push'), 0o755);
    expect(workflowHooksInstalled(root)).toBe(true);
  });

  it('AC-13: keeps warning for a commented-out line and for only one of the two lines', () => {
    const root = trackedRepo('.githooks', {
      '.githooks/commit-msg': `#!/bin/sh\n# paqad-ai git-workflow\n# ${COMMIT_LINE}\n`,
      '.githooks/pre-push': `#!/bin/sh\n${PUSH_LINE}\n`,
    });
    chmodSync(join(root, '.githooks/commit-msg'), 0o755);
    chmodSync(join(root, '.githooks/pre-push'), 0o755);
    expect(workflowHooksInstalled(root)).toBe(false);
    expect(gitWorkflowWarnings(root)[0]).toContain('.githooks/commit-msg:');
  });

  it.runIf(process.platform !== 'win32')(
    'AC-13: holds the advice until the bit is set on a file git itself runs, and says how',
    () => {
      const root = trackedRepo('.githooks', {
        '.githooks/commit-msg': `#!/bin/sh\n${COMMIT_LINE}\n`,
        '.githooks/pre-push': `#!/bin/sh\n${PUSH_LINE}\n`,
      });
      chmodSync(join(root, '.githooks/commit-msg'), 0o644);
      chmodSync(join(root, '.githooks/pre-push'), 0o755);
      expect(workflowHooksInstalled(root, 'darwin')).toBe(false);
      expect(workflowHooksInstalled(root, 'win32')).toBe(true);
      expect(gitWorkflowWarnings(root)[0]).toContain(
        ".githooks/commit-msg has the line but git can't run it. Run chmod +x .githooks/commit-msg, or git update-index --chmod=+x .githooks/commit-msg from Windows.",
      );
      chmodSync(join(root, '.githooks/commit-msg'), 0o755);
      expect(gitWorkflowWarnings(root)).toEqual([]);
    },
  );
});

describe('a tracked husky runner folder', () => {
  it('names the files husky runs, and a line in the runner folder does not count', () => {
    const root = trackedRepo('.husky/_', {
      ...husky(),
      '.husky/commit-msg': 'echo team\n',
    });
    write(root, '.husky/_/pre-push', `#!/usr/bin/env sh\n. h\n${PUSH_LINE}\n`);
    const advice = trackedWorkflowHookAdvice(root)!;
    expect(advice).toContain('Your git hooks are in .husky, which your repo tracks');
    expect(advice).toContain('.husky/commit-msg:');
    expect(advice).toContain('.husky/pre-push');
    expect(advice).not.toContain('.husky/_');
  });

  it('AC-14: clears with the lines in place and no executable bit, because husky runs them through sh', () => {
    const root = trackedRepo('.husky/_', {
      ...husky(),
      '.husky/commit-msg': `${workflowHookBlock('commit-msg')}\n`,
      '.husky/pre-push': `${workflowHookBlock('pre-push')}\n`,
    });
    chmodSync(join(root, '.husky/commit-msg'), 0o644);
    chmodSync(join(root, '.husky/pre-push'), 0o644);
    expect(workflowHooksInstalled(root, 'linux')).toBe(true);
    expect(gitWorkflowWarnings(root)).toEqual([]);
  });

  it('treats a tracked folder named _ with no husky runner as a plain hooks folder', () => {
    const root = trackedRepo('hooks/_', { 'hooks/_/commit-msg': '#!/bin/sh\n' });
    expect(trackedWorkflowHookAdvice(root)).toContain('Your git hooks are in hooks/_,');
  });
});

describe('an untracked hooks folder on update', () => {
  it('restores the bit and a commented-out line, so running update clears the warning', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-tracked-hooks-'));
    roots.push(root);
    git(root, 'init', '-q');
    installGitHooks(root);
    const path = join(root, '.git/hooks/commit-msg');
    chmodSync(path, 0o644);
    if (process.platform !== 'win32') expect(workflowHooksInstalled(root)).toBe(false);
    installGitHooks(root);
    expect(workflowHooksInstalled(root)).toBe(true);
    writeFileSync(path, `#!/bin/sh\n# paqad-ai git-workflow\n# ${COMMIT_LINE}\n`);
    expect(workflowHooksInstalled(root)).toBe(false);
    installGitHooks(root);
    expect(workflowHooksInstalled(root)).toBe(true);
  });
});
