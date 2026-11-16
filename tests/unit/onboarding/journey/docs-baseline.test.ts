import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startRun } from '../../../../src/onboarding/journey/actions.js';
import { claimUnit } from '../../../../src/onboarding/journey/actions.js';
import { KEPT_FOR_REVIEW, answerCommit } from '../../../../src/onboarding/journey/commit.js';
import { existingPagesKept } from '../../../../src/onboarding/journey/finish.js';
import {
  docsBaseline,
  fileSha256,
  runPreflight,
} from '../../../../src/onboarding/journey/preflight.js';
import { readRun, updateRun } from '../../../../src/onboarding/journey/run-store.js';
import { ONBOARDING_STAGES } from '../../../../src/onboarding/journey/stages.js';
import { stageAgentWriteDecision } from '../../../../src/stage-isolation/bash-write-guard.js';

import { git, gitRepo } from './fixtures/git.js';
import { clockAt, tempRoot, writeFile } from './fixtures/journey.js';

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const ASKED = { asked: true, fromTray: false, isTTY: false };

describe('AC-23 FR-23 INV-16: onboarding adds missing docs only', () => {
  let root: string;

  beforeEach(() => {
    root = tempRoot('paqad-docs-baseline-');
    gitRepo(root);
    writeFile(root, '.gitignore', 'docs/build/\n');
    writeFile(root, 'docs/stack/overview.md', '# Stack, hand-written\n');
    writeFile(root, 'docs/modules/billing/summary.md', '# Billing, hand-written\n');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'init');
    writeFile(root, 'docs/draft.md', '# Untracked draft\n');
    writeFile(root, 'docs/build/out.html', '<p>ignored</p>\n');
    const preflight = runPreflight(root, ASKED);
    if (preflight.kind !== 'ok') throw new Error('preflight refused');
    startRun(
      root,
      {
        providers: ['claude-code'],
        session: 'session-a',
        allowList: false,
        asked: 'tray',
        baseline: preflight.baseline,
        docsBaseline: preflight.docs_baseline,
      },
      clockAt(0),
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('records the tracked and untracked docs pages with their sha256 at start', () => {
    expect(readRun(root)?.docs_baseline).toEqual({
      'docs/draft.md': sha('# Untracked draft\n'),
      'docs/modules/billing/summary.md': sha('# Billing, hand-written\n'),
      'docs/stack/overview.md': sha('# Stack, hand-written\n'),
    });
    expect(docsBaseline(root)).toEqual(readRun(root)?.docs_baseline);
  });

  function blocked(agentType: string, toolName: string, target: string, agentId?: string) {
    return stageAgentWriteDecision({
      projectRoot: root,
      agentType,
      toolName,
      ...(agentId !== undefined ? { agentId } : {}),
      ...(toolName === 'Bash'
        ? { command: `echo x > ${target}` }
        : { targets: [join(root, target)] }),
    }).blocked;
  }

  it('the write guard refuses the docs agent an Edit or Write to a page that existed before', () => {
    for (const tool of ['Edit', 'Write', 'Bash']) {
      expect(blocked('paqad-onboarding-docs', tool, 'docs/stack/overview.md'), tool).toBe(true);
      expect(blocked('paqad:paqad-onboarding-docs', tool, 'docs/draft.md'), tool).toBe(true);
    }
    expect(blocked('paqad-onboarding-docs', 'Write', 'docs/stack/new-page.md')).toBe(false);
  });

  it('the write guard refuses a module agent its own folder page that existed before', () => {
    updateRun(root, (draft) => {
      draft.stages.module_docs = { status: 'running' };
    });
    claimUnit(root, 'module_docs', 'billing', 'paqad-onboarding-modules', clockAt(2));
    const agent = 'paqad-onboarding-modules';
    expect(blocked(agent, 'Write', 'docs/modules/billing/summary.md')).toBe(true);
    expect(blocked(agent, 'Edit', 'docs/modules/billing/summary.md')).toBe(true);
    expect(blocked(agent, 'Write', 'docs/modules/billing/api.md')).toBe(false);
  });

  it('the commit leaves out a pre-existing page whose bytes changed, as kept for review', () => {
    writeFile(root, 'docs/stack/overview.md', '# Stack, overwritten by an agent\n');
    writeFile(root, 'docs/draft.md', '# Draft, overwritten\n');
    writeFile(root, 'docs/stack/new-page.md', '# New\n');
    updateRun(root, (draft) => {
      for (const stage of ONBOARDING_STAGES) draft.stages[stage.id] = { status: 'done' };
      draft.written = {
        'docs/stack/overview.md': fileSha256(join(root, 'docs/stack/overview.md'))!,
        'docs/stack/new-page.md': fileSha256(join(root, 'docs/stack/new-page.md'))!,
      };
    });
    const record = answerCommit(root, { kind: 'branch', branch: true }, clockAt(9));
    expect(record.committed).toContain('docs/stack/new-page.md');
    expect(record.committed).not.toContain('docs/stack/overview.md');
    expect(record.committed).not.toContain('docs/draft.md');
    const reasons = Object.fromEntries(
      (record.left_out ?? []).map((item) => [item.path, item.reason]),
    );
    expect(reasons['docs/stack/overview.md']).toBe(KEPT_FOR_REVIEW);
    expect(reasons['docs/draft.md']).toBe(KEPT_FOR_REVIEW);
    expect(git(root, 'show', '--name-only', '--format=', 'HEAD')).not.toContain(
      'docs/stack/overview.md',
    );
    expect(existingPagesKept(root, readRun(root)!)).toContain('docs/stack/overview.md');
  });
});
