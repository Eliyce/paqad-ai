import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { DecisionStore, type DecisionPacket } from '@/planning/index.js';
import { writeGitignore } from '@/onboarding/gitignore-writer.js';

// Issue #184 — two developers on parallel branches must be able to each raise a
// decision and merge to main with no git conflict. ULID filenames make the
// packet files distinct; the managed `.gitignore` keeps the append-only audit
// stream out of git so it cannot conflict at EOF.

function git(projectRoot: string, args: string[]): string {
  return execFileSync('git', args, { cwd: projectRoot }).toString();
}

function gitInit(projectRoot: string): void {
  git(projectRoot, ['init', '-b', 'main']);
  git(projectRoot, ['config', 'user.email', 'test@paqad.dev']);
  git(projectRoot, ['config', 'user.name', 'paqad test']);
}

function makePacket(decisionId: string, fingerprint: string): DecisionPacket {
  return {
    decision_id: decisionId,
    fingerprint,
    category: 'component-reuse',
    question: 'Use the Button we have?',
    context: 'We are adding a dashboard action.',
    options: [
      {
        option_key: 'reuse-button',
        label: 'Reuse Button',
        one_line_preview: 'If you pick this, we will update src/components/Button.tsx.',
        trade_off: 'You give up: a fresh design.',
        evidence: { file: 'src/components/Button.tsx', callers: 3, similarity: 0.9 },
      },
      {
        option_key: 'make-new',
        label: 'Make new Button',
        one_line_preview: 'If you pick this, we will create src/components/ButtonV2.tsx.',
        trade_off: 'You give up: one shared place.',
        evidence: { file: 'src/components/ButtonV2.tsx', evidence_partial: true },
      },
    ],
    confidence: 0.72,
    requested_by: 'codex-cli',
    task_session_id: 'session-1',
    created_at: '2026-04-27T12:00:00Z',
    status: 'pending',
    ttl_until: '2099-12-31T12:00:00Z',
    invalidation_watch: [],
  };
}

describe('parallel-branch decision merge (issue #184)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-merge-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('merges two decisions raised on diverged branches with no conflict', () => {
    gitInit(projectRoot);
    const store = new DecisionStore(projectRoot);
    store.initialize();
    // The managed .gitignore must be committed at the base so the append-only
    // audit stream stays untracked on both branches.
    writeGitignore(projectRoot);
    git(projectRoot, ['add', '-A']);
    git(projectRoot, ['commit', '-m', 'base']);

    // Branch A raises a decision.
    git(projectRoot, ['checkout', '-b', 'feat-a']);
    const idA = store.nextDecisionId();
    store.writePending(makePacket(idA, 'sha256:a'));
    git(projectRoot, ['add', '-A']);
    git(projectRoot, ['commit', '-m', 'decision A']);

    // Branch B diverges from the same base and raises a different decision.
    git(projectRoot, ['checkout', 'main']);
    git(projectRoot, ['checkout', '-b', 'feat-b']);
    const idB = store.nextDecisionId();
    store.writePending(makePacket(idB, 'sha256:b'));
    git(projectRoot, ['add', '-A']);
    git(projectRoot, ['commit', '-m', 'decision B']);

    // Merge A into B — must be conflict-free (distinct ULID filenames).
    expect(idA).not.toBe(idB);
    expect(() => git(projectRoot, ['merge', '--no-edit', 'feat-a'])).not.toThrow();

    // Both packets survive the merge.
    const pendingDir = join(projectRoot, PATHS.DECISIONS_PENDING_DIR);
    const files = readdirSync(pendingDir).filter((f) => f.endsWith('.json'));
    expect(files).toContain(`${idA}.json`);
    expect(files).toContain(`${idB}.json`);
    expect(existsSync(join(pendingDir, `${idA}.json`))).toBe(true);
    expect(existsSync(join(pendingDir, `${idB}.json`))).toBe(true);
  });
});
