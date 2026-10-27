import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { assembleMap, scanAndEmbedIds } from '@/rule-scripts/analyzer.js';
import { applyRuleScriptMap } from '@/rule-scripts/apply.js';
import { readFileResults, sha256Text } from '@/rule-scripts/file-cache.js';
import { parseScriptHeader } from '@/rule-scripts/header.js';
import { upsertScriptEntry } from '@/rule-scripts/mutate.js';
import { runRuleScriptsAsync, type RunReport } from '@/rule-scripts/runner.js';

const roots: string[] = [];
const SCRIPT_REL = '.paqad/scripts/rules/coding/cache/001-no-debugger.mjs';
const FILES = ['src/a.ts', 'src/b.ts', 'src/c.ts'];

function write(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
}

function scriptBody(ruleId: string, perFile: boolean, log: string, extra = ''): string {
  return [
    '// @paqad-rule-script',
    `// rule_id: ${ruleId}`,
    '// source: docs/instructions/rules/coding/cache.md',
    '// kind: deterministic',
    '// scope: changed-files',
    '// runtime: node',
    ...(perFile ? ['// per_file: true'] : []),
    "import { appendFileSync, readFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    "const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));",
    `appendFileSync(${JSON.stringify(log)}, JSON.stringify(files) + '\\n');`,
    'const findings = [];',
    'for (const file of files) {',
    "  readFileSync(join(projectRoot, file), 'utf8').split('\\n').forEach((line, i) => {",
    "    if (/debugger/.test(line)) findings.push({ file, line: i + 1, message: 'debugger', severity: 'blocker' });",
    '  });',
    '}',
    extra,
    `process.stdout.write(JSON.stringify({ rule_id: '${ruleId}', kind: 'deterministic', findings }));`,
    '',
  ].join('\n');
}

interface CacheProject {
  root: string;
  ruleId: string;
  log: string;
  setScript: (perFile: boolean, extra?: string) => void;
  received: () => string[][];
}

function project(perFile = true): CacheProject {
  const root = mkdtempSync(join(tmpdir(), 'paqad-file-cache-'));
  roots.push(root);
  const log = join(root, 'received.log');
  write(join(root, 'docs/instructions/rules/coding/cache.md'), '- No debugger.\n');
  const scanned = scanAndEmbedIds(root);
  const ruleId = scanned.inventory[0]!.id;
  const setScript = (flag: boolean, extra = ''): void =>
    write(join(root, SCRIPT_REL), scriptBody(ruleId, flag, log, extra));
  setScript(perFile);
  const map = upsertScriptEntry(
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
      last_validated_at: '2026-10-27T00:00:00Z',
      fixtures_passed: true,
    },
  );
  applyRuleScriptMap({
    projectRoot: root,
    map,
    via: 'test',
    event: { action: 'generate', rule_ids: [ruleId] },
  });
  write(join(root, 'src/a.ts'), 'debugger;\n');
  write(join(root, 'src/b.ts'), 'export const b = 1;\n');
  write(join(root, 'src/c.ts'), 'export const c = 1;\ndebugger;\n');
  const received = (): string[][] =>
    existsSync(log)
      ? readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as string[])
      : [];
  return { root, ruleId, log, setScript, received };
}

function preEdit(root: string, changedFiles = FILES): Promise<RunReport> {
  return runRuleScriptsAsync({
    projectRoot: root,
    mode: 'strict',
    changedFiles,
    kinds: ['deterministic'],
    scopes: ['changed-files'],
    useFileCache: true,
  });
}

function completion(root: string, changedFiles = FILES): Promise<RunReport> {
  return runRuleScriptsAsync({ projectRoot: root, mode: 'strict', changedFiles, concurrency: 4 });
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe('per-file rule-script cache', () => {
  it('AC-26: editing one file re-runs a per-file script on that file only, with the same findings as a full run', async () => {
    const { root, received } = project();
    await preEdit(root);
    write(join(root, 'src/b.ts'), 'export const b = 2;\ndebugger;\n');
    const cachedRun = await preEdit(root);

    expect(received()).toEqual([FILES, ['src/b.ts']]);
    const full = await completion(root);
    expect(cachedRun.results[0]!.findings).toEqual(full.results[0]!.findings);
    expect(cachedRun.results[0]!.findings.map((finding) => finding.file)).toEqual([
      'src/a.ts',
      'src/b.ts',
      'src/c.ts',
    ]);
  });

  it('does not spawn a per-file script when every target is cached', async () => {
    const { root, received } = project();
    await preEdit(root);
    rmSync(join(root, PATHS.RULE_SCRIPTS_PRE_MUTATION_REPORT));
    const again = await preEdit(root);
    expect(received()).toHaveLength(1);
    expect(again.counts.deterministic).toBe(2);
  });

  it('AC-27: changing the script source invalidates its entries and runs every target', async () => {
    const { root, received, setScript } = project();
    await preEdit(root);
    setScript(true, "const touched = 'yes';");
    await preEdit(root);
    expect(received()).toEqual([FILES, FILES]);
  });

  it('AC-28: a script without the per_file header always receives the full file list', async () => {
    const { root, received } = project(false);
    await preEdit(root);
    write(join(root, 'src/b.ts'), 'export const b = 3;\n');
    await preEdit(root);
    expect(received()).toEqual([FILES, FILES]);
    expect(existsSync(join(root, PATHS.RULE_SCRIPTS_FILE_RESULTS))).toBe(true);
    expect(readFileResults(root).size).toBe(0);
  });

  it('AC-29: a corrupt cache file counts as empty and is rewritten as valid JSON', async () => {
    const { root, received } = project();
    write(join(root, PATHS.RULE_SCRIPTS_FILE_RESULTS), '{"version":1,"entries":[{"scr');
    const report = await preEdit(root);
    expect(received()).toEqual([FILES]);
    expect(report.counts.deterministic).toBe(2);
    expect(readFileResults(root).size).toBe(3);
  });

  it('AC-29: entries for a deleted file are pruned and the write leaves no temp file', async () => {
    const { root } = project();
    await preEdit(root);
    rmSync(join(root, 'src/c.ts'));
    await preEdit(root, ['src/a.ts', 'src/b.ts']);
    const files = [...readFileResults(root).values()].map((entry) => entry.file);
    expect(files.sort()).toEqual(['src/a.ts', 'src/b.ts']);
    const cacheDir = join(root, PATHS.RULE_SCRIPTS_CACHE_DIR);
    expect(readdirSync(cacheDir).filter((name) => name.includes('.tmp'))).toEqual([]);
  });

  it('AC-29: a forged empty-findings entry is ignored by the completion run, which reports the real finding', async () => {
    const { root } = project();
    await preEdit(root);
    const path = join(root, PATHS.RULE_SCRIPTS_FILE_RESULTS);
    const doc = JSON.parse(readFileSync(path, 'utf8')) as {
      entries: Array<{ file: string; findings: unknown[] }>;
    };
    for (const entry of doc.entries) entry.findings = [];
    writeFileSync(path, JSON.stringify(doc));

    const full = await completion(root);
    expect(full.blocking).toBe(true);
    expect(full.results[0]!.findings.map((finding) => finding.file)).toEqual([
      'src/a.ts',
      'src/c.ts',
    ]);
  });

  it('two runs writing the cache at once leave a valid cache file', async () => {
    const { root } = project();
    await Promise.all([preEdit(root), preEdit(root), preEdit(root)]);
    const raw = readFileSync(join(root, PATHS.RULE_SCRIPTS_FILE_RESULTS), 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(readFileResults(root).size).toBe(3);
  });

  it('never caches an errored run', async () => {
    const { root, setScript } = project();
    setScript(true, "process.stderr.write('broken'); process.exit(3);");
    const report = await preEdit(root);
    expect(report.results[0]!.skipped).toBe('error: script exited 3: broken');
    expect(readFileResults(root).size).toBe(0);
  });

  it('keys each entry by script and file content hashes', async () => {
    const { root } = project();
    await preEdit(root);
    const entry = [...readFileResults(root).values()].find((item) => item.file === 'src/a.ts');
    expect(entry).toMatchObject({
      script: SCRIPT_REL,
      script_sha256: sha256Text(readFileSync(join(root, SCRIPT_REL), 'utf8')),
      file_sha256: sha256Text('debugger;\n'),
    });
  });
});

describe('per_file script header', () => {
  const base = [
    '// @paqad-rule-script',
    '// rule_id: RL-00a1',
    '// source: docs/instructions/rules/coding/x.md',
    '// kind: deterministic',
    '// scope: changed-files',
    '// runtime: node',
  ];

  it('reads per_file true and false as booleans', () => {
    expect(parseScriptHeader([...base, '// per_file: true', ''].join('\n')).header?.per_file).toBe(
      true,
    );
    expect(parseScriptHeader([...base, '// per_file: FALSE', ''].join('\n')).header?.per_file).toBe(
      false,
    );
    expect(parseScriptHeader([...base, ''].join('\n')).header?.per_file).toBeUndefined();
  });

  it('rejects a per_file value that is not a boolean', () => {
    const parsed = parseScriptHeader([...base, '// per_file: maybe', ''].join('\n'));
    expect(parsed.ok).toBe(false);
  });
});
