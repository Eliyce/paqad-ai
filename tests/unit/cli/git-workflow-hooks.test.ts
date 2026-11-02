import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  messageSubject,
  pushedBranches,
  runCheckCommit,
  runCheckPush,
} from '@/cli/commands/git-workflow.js';
import { PATHS } from '@/core/constants/paths.js';
import { runningUnderAgent } from '@/git-workflow/agent-env.js';

let root: string;
const AGENT = { CLAUDECODE: '1' };
const PERSON = {};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-wf-hooks-'));
  mkdirSync(join(root, PATHS.GIT_WORKFLOW_DIR), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function enforcement(text: string): void {
  writeFileSync(join(root, PATHS.GIT_WORKFLOW_DIR, 'enforcement.yaml'), text);
}

function message(text: string): string {
  writeFileSync(join(root, 'MSG'), text);
  return 'MSG';
}

function commit(text: string, env: NodeJS.ProcessEnv, merging = false) {
  return runCheckCommit({ projectRoot: root, messageFile: message(text), env, merging });
}

describe('runningUnderAgent', () => {
  it('is true for Claude Code, a paqad session and a Codex sandbox, false otherwise', () => {
    expect(runningUnderAgent({ CLAUDECODE: '1' })).toBe(true);
    expect(runningUnderAgent({ SE_SESSION: 'abc' })).toBe(true);
    expect(runningUnderAgent({ CODEX_SANDBOX: 'seatbelt' })).toBe(true);
    expect(runningUnderAgent({ CODEX_SANDBOX_NETWORK_DISABLED: '1' })).toBe(true);
    expect(runningUnderAgent({ SE_SESSION: ' ' })).toBe(false);
    expect(runningUnderAgent({})).toBe(false);
  });
});

describe('git-workflow check-commit', () => {
  it('uses agents under an agent and people otherwise, and exits 1 only under block', () => {
    enforcement('agents: block\npeople: warn\n');
    const agent = commit('fix\n', AGENT);
    expect(agent.exitCode).toBe(1);
    expect(agent.stderr).toContain(
      `🔴 commit "fix" reads like code, not plain language: it doesn't say what changed.`,
    );
    const person = commit('fix\n', PERSON);
    expect(person.exitCode).toBe(0);
    expect(person.stderr).toContain('🟡 commit "fix"');
  });

  it('rejects a person under people: block, never a merge commit, and passes a good message', () => {
    enforcement('people: block\n');
    expect(commit('fix\n', PERSON).exitCode).toBe(1);
    expect(commit('fix\n', PERSON, true).exitCode).toBe(0);
    expect(commit("Merge branch 'x'\n", PERSON).exitCode).toBe(0);
    expect(commit('# comment\n\nlet people sign in with email\n', PERSON)).toEqual({
      exitCode: 0,
      stderr: '',
      findings: [],
    });
  });

  it('does nothing when people is off or the rules are turned off', () => {
    enforcement('people: off\n');
    expect(commit('fix\n', PERSON).stderr).toBe('');
    enforcement('enabled: false\nagents: block\n');
    expect(commit('fix\n', AGENT).exitCode).toBe(0);
  });

  it('reads the first non-comment line as the subject', () => {
    expect(messageSubject('# x\n\n  \nfirst line\nsecond')).toBe('first line');
  });
});

describe('git-workflow check-push', () => {
  const line = (branch: string, sha = 'a'.repeat(40)) =>
    `refs/heads/${branch} ${sha} refs/heads/${branch} ${'0'.repeat(40)}`;

  it('with people: block rejects a badly named branch, and with warn lets it through', () => {
    enforcement('people: block\n');
    const blocked = runCheckPush({ projectRoot: root, stdin: line('misc/x'), env: PERSON });
    expect(blocked.exitCode).toBe(1);
    expect(blocked.stderr).toContain(
      "branch misc/x doesn't follow this team's pattern {prefix}/{ticket}-{title_slug}.",
    );
    enforcement('people: warn\n');
    const warned = runCheckPush({ projectRoot: root, stdin: line('misc/x'), env: PERSON });
    expect(warned.exitCode).toBe(0);
    expect(warned.stderr).toContain('🟡 branch misc/x');
  });

  it('skips configured bases, deletions and tags, and passes a good branch', () => {
    enforcement('people: block\n');
    const stdin = [
      line('main'),
      line('feature/add-login'),
      line('misc/x', '0'.repeat(40)),
      `refs/tags/v1 ${'a'.repeat(40)} refs/tags/v1 ${'0'.repeat(40)}`,
    ].join('\n');
    expect(runCheckPush({ projectRoot: root, stdin, env: PERSON }).exitCode).toBe(0);
    expect(pushedBranches(stdin)).toEqual(['main', 'feature/add-login']);
  });
});
