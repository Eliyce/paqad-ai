import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRagCommand } from '@/cli/commands/rag.js';
import { ensureCompiledRulesCurrent, refreshRuleContext } from '@/context/rule-context.js';
import { HealthChecker } from '@/health/checker.js';
import { isCompiledRulesStale, readCompiledRules } from '@/planning/rule-compiler.js';
import { FrameworkUpdater } from '@/update/index.js';

const STORE = '.paqad/compiled-rules.json';
const ROUTE = '.paqad/context/.session-route.json';

describe('keeping the compiled rules current', () => {
  let root: string;

  const put = (rel: string, text: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  const breakTheStore = () => mkdirSync(join(root, STORE), { recursive: true });
  const refresh = async (...args: string[]) => {
    const command = createRagCommand();
    command.exitOverride();
    await command.parseAsync(['refresh-context', '--project-root', root, ...args], {
      from: 'user',
    });
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-compiled-rules-'));
    put('.paqad/.config', 'rag_enabled=false\n');
    put('docs/instructions/rules/coding/a.md', '# A\n\n- First rule\n');
    process.exitCode = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
    rmSync(root, { recursive: true, force: true });
  });

  it('leaves a project with no rules folder alone', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'paqad-compiled-rules-'));
    expect(await ensureCompiledRulesCurrent(empty)).toBeNull();
    expect(await readCompiledRules(empty)).toBeNull();
    rmSync(empty, { recursive: true, force: true });
  });

  it('returns the error instead of swallowing it', async () => {
    breakTheStore();
    expect(await ensureCompiledRulesCurrent(root)).toBeInstanceOf(Error);
  });

  it.each([
    ['missing', null],
    ['corrupt', '{not json'],
    ['a no-workflow route', JSON.stringify({ workflow: 'no-workflow', query: 'hi' })],
    ['a feature route', JSON.stringify({ workflow: 'feature-development', query: 'hi' })],
  ])('AC-17: recompiles a stale store with the route file %s', async (_name, route) => {
    if (route !== null) put(ROUTE, route);
    put(STORE, JSON.stringify({ source_hash: 'old', rules: [] }));
    expect(await isCompiledRulesStale(root)).toBe(true);
    await refresh('--quiet');
    expect(await isCompiledRulesStale(root)).toBe(false);
    expect(process.exitCode).toBe(0);
  });

  it('AC-17: recompiles an invalid-JSON store', async () => {
    put(STORE, '{not json');
    await refresh('--quiet');
    expect(await isCompiledRulesStale(root)).toBe(false);
  });

  it('AC-17: recompiles when the route does not load rules', async () => {
    put(STORE, JSON.stringify({ source_hash: 'old', rules: [] }));
    await refreshRuleContext(root, { loadRules: false });
    expect(await isCompiledRulesStale(root)).toBe(false);
  });

  it('AC-17: a failed refresh exits non-zero with one stderr line, and quiet does not hide it', async () => {
    const stderr: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    breakTheStore();
    await refresh('--quiet');
    expect(process.exitCode).toBe(1);
    expect(
      stderr.filter((line) => line.startsWith("Couldn't refresh .paqad/compiled-rules.json: ")),
    ).toHaveLength(1);
    expect(stdout).not.toHaveBeenCalled();
  });

  it('AC-17: a compile failure stays exit 0 for update, with one line in its output', async () => {
    breakTheStore();
    const report = await new FrameworkUpdater({ generateCandidates: async () => [] }).run(root);
    const lines = (report.git_workflow_notes ?? []).filter((line) =>
      line.startsWith("Couldn't refresh .paqad/compiled-rules.json: "),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /\. Doctor will flag it\. Run paqad-ai rag refresh-context to try again\.$/u,
    );
    expect(lines[0]).not.toMatch(/\.\. Doctor/u);
  });

  it('AC-16: the compiled rules check passes straight after an update, and from a stale state its own advice clears it', async () => {
    const check = async () =>
      (await new HealthChecker().run(root)).checks.find(
        (result) => result.name === 'Compiled rules are current',
      );
    put(STORE, JSON.stringify({ source_hash: 'old', rules: [] }));
    await new FrameworkUpdater({ generateCandidates: async () => [] }).run(root);
    expect(readFileSync(join(root, STORE), 'utf8')).toContain('First rule');
    expect((await check())?.status).toBe('pass');
    put('docs/instructions/rules/coding/a.md', '# A\n\n- Changed rule\n');
    put(ROUTE, JSON.stringify({ workflow: 'no-workflow', query: 'hi' }));
    expect((await check())?.status).toBe('fail');
    await refresh('--quiet');
    expect((await check())?.status).toBe('pass');
  });
});
