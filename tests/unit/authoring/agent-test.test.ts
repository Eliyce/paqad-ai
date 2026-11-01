import { chmodSync, copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import YAML from 'yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AGENT_PERMISSION_ALLOW, AGENT_PERMISSION_REMOVE } from '@/authoring/decisions.js';
import { runAgentDraft } from '@/authoring/stages/agent-draft.js';
import { draftAgentHash, readPermissionIds, runAgentTest } from '@/authoring/stages/agent-test.js';
import { AGENT_STAGES, AuthoringRefusal, stageState } from '@/authoring/workspace.js';
import { resolvePendingDecision } from '@/decisions/authoring.js';

import {
  AGENT_TRACE,
  agentText,
  agentThrough,
  cleanAgentProjects,
  passGate,
  put,
} from '../../shared/agent-pipeline.js';

afterEach(cleanAgentProjects);

const FIXTURE = join(process.cwd(), 'tests/fixtures/authoring/npm-project/agent');
const FILE = '.claude/agents/migration-reviewer.md';

function npmAgent() {
  const workspace = agentThrough('S4');
  const root = workspace.projectRoot;
  put(root, '.paqad/project-profile.yaml', YAML.stringify({ commands: { test: 'npm test' } }));
  put(root, FILE, readFileSync(join(FIXTURE, 'migration-reviewer.md'), 'utf8'));
  put(root, '.claude/hooks/block-edits.mjs', '');
  copyFileSync(join(FIXTURE, 'hooks/block-edits.mjs'), join(root, '.claude/hooks/block-edits.mjs'));
  put(
    root,
    'tests/agents/migration-reviewer/block-edits.test.ts',
    readFileSync(join(FIXTURE, 'tests/block-edits.test.ts.fixture'), 'utf8'),
  );
  const drafted = runAgentDraft(workspace, { file: FILE, traceText: AGENT_TRACE });
  expect(drafted.lines).toEqual(expect.arrayContaining([expect.stringMatching(/S3 draft passed/)]));
  return workspace;
}

describe('agent test (S4)', () => {
  it('AC-15: lints the draft, runs the hook script tests in the project runner and writes script-tests.json', async () => {
    const workspace = npmAgent();
    const runTests = vi.fn(async () => ({ exitCode: 0, failedTests: null }));
    const result = await runAgentTest(workspace, { runTests });
    expect(result.lines.at(-2)).toMatch(/S4 passed: .*\.claude\/hooks\/block-edits\.mjs are green/);
    expect(result.ok).toBe(true);
    expect(runTests).toHaveBeenCalledWith(
      'npm test',
      workspace.projectRoot,
      expect.objectContaining({ PAQAD_AGENT_UNDER_TEST: expect.any(String) }),
    );
    const report = workspace.readJson<Record<string, unknown>>('script-tests.json')!;
    expect(report).toMatchObject({
      gate: 'passed',
      test_location: 'tests/agents/migration-reviewer',
      file_hash: draftAgentHash(workspace),
    });
    expect(workspace.readJson<{ inputs_hash: string }>('lint.json')?.inputs_hash).toBe(
      draftAgentHash(workspace),
    );
    expect(stageState(workspace, AGENT_STAGES[4]!).state).toBe('passed');
  });

  it('a red run fails the gate', async () => {
    const workspace = npmAgent();
    const result = await runAgentTest(workspace, {
      runTests: async () => ({ exitCode: 1, failedTests: ['block-edits blocks'] }),
    });
    expect(result.ok).toBe(false);
    expect(result.lines).toContain(
      '.claude/hooks/block-edits.mjs blocks: failed (the test run failed)',
    );
  });

  it('a missing named contract test fails the gate', async () => {
    const workspace = npmAgent();
    put(
      workspace.projectRoot,
      'tests/agents/migration-reviewer/block-edits.test.ts',
      "it('block-edits blocks', () => {});\n",
    );
    const result = await runAgentTest(workspace, {
      runTests: async () => ({ exitCode: 0, failedTests: null }),
    });
    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toContain('allows: missing');
  });

  it('AC-2: blocking lint findings fail S4 before any test runs', async () => {
    const workspace = agentThrough('S4');
    put(workspace.projectRoot, FILE, agentText({ maxTurns: undefined }));
    runAgentDraft(workspace, { file: FILE, traceText: AGENT_TRACE });
    const runTests = vi.fn();
    const result = await runAgentTest(workspace, { runTests });
    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toMatch(/AG-007/);
    expect(runTests).not.toHaveBeenCalled();
  });

  it('AC-33: S4 scans and hashes the draft copy of a hook script, the one release writes', async () => {
    const workspace = npmAgent();
    const draftScript = 'draft/.claude/hooks/block-edits.mjs';
    const clean = workspace.read(draftScript)!;
    workspace.write(draftScript, `${clean}const key = 'AKIAIOSFODNN7EXAMPLE';\n`);
    const runTests = vi.fn(async () => ({ exitCode: 0, failedTests: null }));
    const result = await runAgentTest(workspace, { runTests });
    expect(result.ok).toBe(false);
    expect(runTests).not.toHaveBeenCalled();
    const lint = workspace.readJson<{ findings: Array<{ rule: string; file: string }> }>(
      'lint.json',
    )!;
    expect(lint.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'AG-012', file: '.claude/hooks/block-edits.mjs' }),
      ]),
    );
    workspace.write(draftScript, `${clean}const note = 'changed in the draft';\n`);
    await runAgentTest(workspace, { runTests });
    expect(workspace.readJson<{ file_hash: string }>('lint.json')?.file_hash).toBe(
      draftAgentHash(workspace),
    );
  });

  it('AC-5, AC-33: a risky power raises one authoring.agent_permission packet and clears once allowed', async () => {
    const workspace = agentThrough('S4');
    put(workspace.projectRoot, FILE, agentText({ tools: 'Read, WebFetch' }));
    runAgentDraft(workspace, { file: FILE, traceText: AGENT_TRACE });
    const waiting = await runAgentTest(workspace, {});
    expect(waiting.decision).toMatch(/^D-/);
    expect(waiting.lines[0]).toMatch(/asks for WebFetch/);
    expect(readPermissionIds(workspace)).toEqual([waiting.decision]);
    expect(stageState(workspace, AGENT_STAGES[4]!).state).toBe('waiting');

    const again = await runAgentTest(workspace, {});
    expect(again.decision).toBe(waiting.decision);

    resolvePendingDecision(workspace.projectRoot, waiting.decision!, AGENT_PERMISSION_ALLOW, 'ok');
    const passed = await runAgentTest(workspace, {});
    expect(passed.ok).toBe(true);
  });

  it('a removed power refuses S4 until the agent drops it', async () => {
    const workspace = agentThrough('S4');
    put(workspace.projectRoot, FILE, agentText({ tools: 'Read, WebFetch' }));
    runAgentDraft(workspace, { file: FILE, traceText: AGENT_TRACE });
    const waiting = await runAgentTest(workspace, {});
    resolvePendingDecision(workspace.projectRoot, waiting.decision!, AGENT_PERMISSION_REMOVE, 'no');
    await expect(runAgentTest(workspace, {})).rejects.toThrow(AuthoringRefusal);
  });

  it('refuses without a draft', async () => {
    const workspace = agentThrough('S4');
    passGate(workspace, 'trace.md', 'S3');
    await expect(runAgentTest(workspace, {})).rejects.toThrow(/holds no draft/);
  });

  it('a risky hook script raises authoring.risky_script before it runs', async () => {
    const workspace = npmAgent();
    const script = join(workspace.projectRoot, '.claude/hooks/block-edits.mjs');
    put(
      workspace.projectRoot,
      '.claude/hooks/block-edits.mjs',
      `${readFileSync(script, 'utf8')}\nfetch('https://x');\n`,
    );
    chmodSync(script, 0o644);
    runAgentDraft(workspace, { file: FILE, traceText: AGENT_TRACE });
    const runTests = vi.fn();
    const result = await runAgentTest(workspace, { runTests });
    expect(result.decision).toMatch(/^D-/);
    expect(runTests).not.toHaveBeenCalled();
  });
});
