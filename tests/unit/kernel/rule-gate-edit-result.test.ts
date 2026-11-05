import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { readRuleRun } from '@/feature-evidence/bundle-ledgers.js';
import { currentFeature } from '@/feature-evidence/stage-ledger.js';
import { RULE_GATE_REMOVAL_CONTEXT } from '@/kernel/capability.js';
import { runCapabilityGate } from '@/kernel/gate.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { assembleMap, scanAndEmbedIds } from '@/rule-scripts/analyzer.js';
import { applyRuleScriptMap } from '@/rule-scripts/apply.js';
import { upsertScriptEntry } from '@/rule-scripts/mutate.js';
import { startStage } from '@/stage-evidence/recorder.js';

import { seedGitChangedFiles } from '../pipeline/changed-files.fixture.js';

const roots: string[] = [];
const SESSION = 'sess-edit-result';
const SCRIPT_REL = '.paqad/scripts/rules/coding/gate/001-no-debugger.mjs';
const TWO_FINDINGS = 'debugger one;\nconst a = 1;\ndebugger two;\n';
const ONE_FINDING = 'debugger other;\n';
const NO_OVERLAY = process.platform === 'win32';

function fileSystemIgnoresCase(): boolean {
  const probe = mkdtempSync(join(tmpdir(), 'paqad-edit-result-test-case-'));
  try {
    writeFileSync(join(probe, 'probe'), '', 'utf8');
    return existsSync(join(probe, 'PROBE'));
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}

function write(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
}

function gateScript(ruleId: string, perFile: boolean, extra: string, byPath = ''): string {
  return [
    '// @paqad-rule-script',
    `// rule_id: ${ruleId}`,
    '// source: docs/instructions/rules/coding/gate.md',
    '// kind: deterministic',
    '// scope: changed-files',
    '// runtime: node',
    ...(perFile ? ['// per_file: true'] : []),
    "import { existsSync, readFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    "const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));",
    'const findings = [];',
    'for (const file of files) {',
    '  const abs = join(projectRoot, file);',
    byPath,
    '  if (!existsSync(abs)) continue;',
    "  const text = readFileSync(abs, 'utf8');",
    extra,
    "  text.split('\\n').forEach((line, index) => {",
    "    if (/debugger/.test(line)) findings.push({ file, line: index + 1, message: 'debugger', severity: 'blocker' });",
    '  });',
    '}',
    `process.stdout.write(JSON.stringify({ rule_id: '${ruleId}', kind: 'deterministic', findings }));`,
    '',
  ].join('\n');
}

function project(
  options: { perFile?: boolean; extra?: string; byPath?: string; lines?: string[] } = {},
): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-edit-result-test-'));
  roots.push(root);
  write(join(root, 'docs/instructions/rules/coding/gate.md'), '- No debugger.\n');
  const scanned = scanAndEmbedIds(root);
  const ruleId = scanned.inventory[0]!.id;
  write(
    join(root, SCRIPT_REL),
    gateScript(ruleId, options.perFile ?? true, options.extra ?? '', options.byPath ?? ''),
  );
  applyRuleScriptMap({
    projectRoot: root,
    map: upsertScriptEntry(
      assembleMap(
        scanned.inventory,
        new Map([
          [ruleId, { id: ruleId, verifiability: { kind: 'deterministic' }, enforced_by: [] }],
        ]),
        scanned.rule_files_hash,
        null,
      ),
      ruleId,
      {
        path: SCRIPT_REL,
        kind: 'deterministic',
        runtime: 'node',
        scope: 'changed-files',
        last_validated_at: '2026-11-05T00:00:00Z',
        fixtures_passed: true,
      },
    ),
    via: 'test',
    event: { action: 'generate', rule_ids: [ruleId] },
  });
  write(
    join(root, '.paqad/configs/.config.policy'),
    ['rule_compliance=strict', 'stages_mode=off', ...(options.lines ?? []), ''].join('\n'),
  );
  write(join(root, 'src/clean.ts'), 'export const clean = 1;\n');
  seedGitChangedFiles(root, []);
  const sessionId = resolveSessionId(root, SESSION);
  writeWorkflowState(root, sessionId, { active: { workflow: 'feature-development' }, paused: [] });
  startStage(root, 'development', { sessionId, adapter: 'claude-code' });
  write(join(root, 'src/app.ts'), TWO_FINDINGS);
  write(join(root, 'src/other.ts'), ONE_FINDING);
  return root;
}

function attempt(
  root: string,
  toolName: string,
  toolInput: unknown,
  extra: { file?: string; targets?: string[]; startedAt?: number; now?: () => number } = {},
) {
  const file = join(root, extra.file ?? 'src/app.ts');
  return runCapabilityGate({
    projectRoot: root,
    seam: 'pre-mutation',
    env: {},
    payload: {
      sessionId: SESSION,
      toolName,
      toolInput,
      targetPath: file,
      targetPaths: extra.targets ?? [file],
    },
    ...(extra.startedAt === undefined ? {} : { startedAt: extra.startedAt }),
    ...(extra.now ? { now: extra.now } : {}),
  });
}

function edit(root: string, oldText: string, newText: string, file = 'src/app.ts') {
  return attempt(
    root,
    'Edit',
    { file_path: join(root, file), old_string: oldText, new_string: newText },
    { file },
  );
}

function allowedRows(root: string): Array<Record<string, unknown>> {
  const dirName = currentFeature(root, resolveSessionId(root, SESSION))!;
  return readRuleRun(root, dirName).filter((row) => row.kind === 'edit-allowed');
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe.skipIf(NO_OVERLAY)('AC-83: the pre-edit rule check judges an edit on its result', () => {
  it('AC-83: an Edit that removes one finding and adds none passes and is recorded, with findings in two files', async () => {
    const root = project();
    const result = await edit(root, 'debugger one;\n', '');
    expect(result.block).toBe(false);
    expect(result.context).toContain(RULE_GATE_REMOVAL_CONTEXT);
    const rows = allowedRows(root);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      counts: { removed: 1, remaining: 2 },
      blocking: false,
      findings: [{ file: 'src/app.ts', line: 1, message: 'debugger' }],
    });
    const log = readFileSync(join(root, '.paqad/logs/hooks.log'), 'utf8');
    expect(log).toContain('edit-allowed');
    expect(readFileSync(join(root, 'src/app.ts'), 'utf8')).toBe(TWO_FINDINGS);
  });

  it('AC-83: a Write that removes one finding and adds none passes and is recorded', async () => {
    const root = project();
    const content = 'const a = 1;\ndebugger two;\n';
    const result = await attempt(root, 'Write', { file_path: join(root, 'src/app.ts'), content });
    expect(result.block).toBe(false);
    expect(allowedRows(root)).toHaveLength(1);
  });

  it("AC-83: Codex's apply_patch route passes the same way", async () => {
    const root = project();
    const command = [
      '*** Begin Patch',
      '*** Update File: src/app.ts',
      '@@',
      '-debugger one;',
      ' const a = 1;',
      '*** End Patch',
    ].join('\n');
    const result = await attempt(root, 'apply_patch', { command });
    expect(result.block).toBe(false);
    expect(allowedRows(root)).toHaveLength(1);
  });

  it('AC-83: a script that reads the whole change judges the edit too', async () => {
    const root = project({ perFile: false });
    expect((await edit(root, 'debugger one;\n', '')).block).toBe(false);
    expect(allowedRows(root)[0]).toMatchObject({ counts: { removed: 1, remaining: 2 } });
  });

  it('AC-83: an edit that removes one finding and adds another is refused as before', async () => {
    const root = project();
    const result = await edit(
      root,
      'debugger one;\nconst a = 1;\n',
      'const a = 2;\ndebugger new;\n',
    );
    expect(result.block).toBe(true);
    expect(result.summary).toContain('debugger');
    expect(allowedRows(root)).toEqual([]);
  });

  it('AC-83: an edit to a clean file with findings elsewhere is refused as before', async () => {
    const root = project();
    const result = await edit(root, 'clean = 1', 'clean = 2', 'src/clean.ts');
    expect(result.block).toBe(true);
    expect(result.summary).toContain('src/app.ts');
    expect(allowedRows(root)).toEqual([]);
  });

  it('AC-83: an edit that removes no finding is refused', async () => {
    const root = project();
    expect((await edit(root, 'const a = 1;', 'const a = 2;')).block).toBe(true);
    expect(allowedRows(root)).toEqual([]);
  });

  it('AC-83: removing two findings cannot pay for a new one with the same message', async () => {
    const root = project();
    const content = 'debugger brand new;\nconst a = 1;\n';
    const result = await attempt(root, 'Write', { file_path: join(root, 'src/app.ts'), content });
    expect(result.block).toBe(true);
  });

  it('AC-83: rewording a finding is adding one', async () => {
    const root = project();
    expect((await edit(root, 'debugger one;', 'debugger uno;')).block).toBe(true);
  });

  it('AC-83: moving a finding removes none', async () => {
    const root = project();
    const content = 'const a = 1;\ndebugger one;\ndebugger two;\n';
    const result = await attempt(root, 'Write', { file_path: join(root, 'src/app.ts'), content });
    expect(result.block).toBe(true);
  });

  it('AC-83: a new finding the edit causes in another file is refused', async () => {
    const extra =
      "  if (file === 'src/other.ts' && !readFileSync(join(projectRoot, 'src/app.ts'), 'utf8').includes('const a = 1')) findings.push({ file, line: 1, message: 'needs a', severity: 'blocker' });";
    const root = project({ perFile: false, extra });
    expect((await edit(root, 'debugger one;\nconst a = 1;\n', '')).block).toBe(true);
  });
});

describe.skipIf(NO_OVERLAY)('AC-83: anything that cannot be judged stays refused', () => {
  it('a rule script that crashes on the result refuses the edit', async () => {
    const extra = "  if (text.includes('marker')) process.exit(3);";
    const root = project({ extra });
    expect((await edit(root, 'debugger one;', 'const marker = 1;')).block).toBe(true);
    expect(allowedRows(root)).toEqual([]);
  });

  it('running out of time during the comparison refuses and does not defer', async () => {
    const root = project();
    const startedAt = 1_000_000;
    let calls = 0;
    const now = (): number => {
      calls += 1;
      return calls === 1 ? startedAt : startedAt + 60_000;
    };
    const input = {
      file_path: join(root, 'src/app.ts'),
      old_string: 'debugger one;\n',
      new_string: '',
    };
    const result = await attempt(root, 'Edit', input, { startedAt, now });
    expect(result.block).toBe(true);
    expect(allowedRows(root)).toEqual([]);
    expect(existsSync(join(root, PATHS.RULE_SCRIPTS_PENDING_DIR))).toBe(false);
  });

  it.each([
    ['an old text that is not in the file', { old_string: 'absent', new_string: '' }],
    ['an old text that matches twice', { old_string: 'debugger', new_string: 'x' }],
  ])('%s is refused', async (_name, input) => {
    const root = project();
    const result = await attempt(root, 'Edit', { file_path: join(root, 'src/app.ts'), ...input });
    expect(result.block).toBe(true);
  });

  it('a tool the comparison does not know is refused', async () => {
    const root = project();
    const content = 'const a = 1;\ndebugger two;\n';
    const input = { file_path: join(root, 'src/app.ts'), content };
    expect((await attempt(root, 'NotebookEdit', input)).block).toBe(true);
  });

  it('an edit naming two files is refused', async () => {
    const root = project();
    const command = [
      '*** Begin Patch',
      '*** Update File: src/app.ts',
      '@@',
      '-debugger one;',
      ' const a = 1;',
      '*** End Patch',
    ].join('\n');
    const targets = [join(root, 'src/app.ts'), join(root, 'src/other.ts')];
    expect((await attempt(root, 'apply_patch', { command }, { targets })).block).toBe(true);
  });

  it('a target that is a link to another file is refused', async () => {
    const root = project();
    symlinkSync(join(root, 'src/app.ts'), join(root, 'src/link.ts'));
    expect((await edit(root, 'debugger one;\n', '', 'src/link.ts')).block).toBe(true);
  });

  it('growing a file past the size limit is refused, so padding cannot hide a finding', async () => {
    const root = project();
    const padded = `${'x'.repeat(1024 * 1024)}\nconst a = 1;\ndebugger two;\n`;
    const input = { file_path: join(root, 'src/app.ts'), content: padded };
    expect((await attempt(root, 'Write', input)).block).toBe(true);
  });

  it('under rule_gate_pre_edit=all the edit stays refused', async () => {
    const root = project({ lines: ['rule_gate_pre_edit=all'] });
    expect((await edit(root, 'debugger one;\n', '')).block).toBe(true);
  });

  it('a target with findings that the overlay cannot reproduce is refused', async () => {
    const extra =
      "  if (projectRoot.includes('paqad-edit-result-') && !projectRoot.includes('-test-')) process.stdout.write(JSON.stringify({ rule_id: 'x', kind: 'deterministic', findings: [] })), process.exit(0);";
    const root = project({ extra });
    expect((await edit(root, 'debugger one;\n', '')).block).toBe(true);
  });

  it('a new file a script flags by path gets the normal refusal, not a gate failure', async () => {
    const byPath =
      "  if (file === 'src/new.ts') findings.push({ file, line: 1, message: 'flagged by path', severity: 'blocker' });";
    const root = project({ byPath });
    const file = 'src/new.ts';
    const result = await attempt(
      root,
      'Write',
      { file_path: join(root, file), content: 'export const a = 1;\n' },
      { file },
    );
    expect(result.block).toBe(true);
    expect(result.summary).toContain('flagged by path');
    expect(result.summary).not.toContain('PAQAD_DISABLED');
    expect(existsSync(join(root, file))).toBe(false);
    expect(allowedRows(root)).toEqual([]);
  });

  it('leaves no temporary project behind', async () => {
    const root = project();
    const scratch = join(root, 'scratch-tmp');
    mkdirSync(scratch);
    const before = process.env.TMPDIR;
    process.env.TMPDIR = scratch;
    try {
      expect((await edit(root, 'debugger one;\n', '')).block).toBe(false);
    } finally {
      if (before === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = before;
    }
    expect(readdirSync(scratch)).toEqual([]);
  });
});

describe.skipIf(NO_OVERLAY)('AC-83: a comparison write never follows a link', () => {
  it.runIf(fileSystemIgnoresCase()).each(['src/APP.ts', 'SRC/app.ts', 'SRC/APP.TS'])(
    'refuses %s, a spelling of the real file that is not its name on disk',
    async (file) => {
      const root = project();
      const result = await attempt(
        root,
        'Edit',
        { file_path: join(root, file), old_string: 'debugger one;\n', new_string: '' },
        { file },
      );
      expect(result.block).toBe(true);
      expect(allowedRows(root)).toEqual([]);
      expect(readFileSync(join(root, 'src/app.ts'), 'utf8')).toBe(TWO_FINDINGS);
    },
  );

  it('does not write the result through a link a rule script left at the target', async () => {
    const extra =
      "  if (!projectRoot.includes('-test-') && file === 'src/app.ts') { const { rmSync, symlinkSync, realpathSync } = await import('node:fs'); rmSync(abs); symlinkSync(realpathSync(join(projectRoot, 'src/other.ts')), abs); }";
    const root = project({ extra });
    const result = await edit(root, 'debugger one;\n', '');
    expect(result.block).toBe(true);
    expect(result.summary).toContain('debugger');
    expect(readFileSync(join(root, '.paqad/logs/hooks.log'), 'utf8')).toContain(
      'edit-refused the comparison failed (ELOOP)',
    );
    expect(readFileSync(join(root, 'src/other.ts'), 'utf8')).toBe(ONE_FINDING);
    expect(readFileSync(join(root, 'src/app.ts'), 'utf8')).toBe(TWO_FINDINGS);
  });
});
