import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { assembleMap, scanAndEmbedIds } from '@/rule-scripts/analyzer.js';
import { applyRuleScriptMap } from '@/rule-scripts/apply.js';
import { upsertScriptEntry } from '@/rule-scripts/mutate.js';
import { runRuleScripts, runRuleScriptsAsync } from '@/rule-scripts/runner.js';

import {
  GOLDEN_CHANGED_FILES,
  buildGoldenProject,
  scriptRelPath,
} from '../../shared/rule-script-golden.js';

const scan = vi.hoisted(() => ({ calls: 0 }));

vi.mock('@/core/fs/gitignore-scan.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/core/fs/gitignore-scan.js')>();
  return {
    ...original,
    scanWorkingTree: (...args: Parameters<typeof original.scanWorkingTree>) => {
      scan.calls += 1;
      return original.scanWorkingTree(...args);
    },
  };
});

const roots: string[] = [];
const PRE_EDIT = { kinds: ['deterministic' as const], scopes: ['changed-files' as const] };

function write(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
}

function golden(): string {
  const root = buildGoldenProject('paqad-filter-');
  roots.push(root);
  return root;
}

beforeEach(() => {
  scan.calls = 0;
});

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe('runRuleScripts filters', () => {
  it('AC-18: a heuristic script is not run when kinds is deterministic', async () => {
    const root = golden();
    const report = await runRuleScriptsAsync({
      projectRoot: root,
      mode: 'strict',
      changedFiles: [...GOLDEN_CHANGED_FILES],
      kinds: ['deterministic'],
      concurrency: 4,
    });
    expect(report.results.map((result) => result.kind)).not.toContain('heuristic');
    expect(report.results.map((result) => result.script)).not.toContain(
      scriptRelPath('002-todo-marker'),
    );
    expect(report.counts.heuristic).toBe(0);
  });

  it('AC-19: the pre-edit filter skips the whole-tree script and never scans or hashes the tree', async () => {
    const root = golden();
    const report = await runRuleScriptsAsync({
      projectRoot: root,
      mode: 'strict',
      changedFiles: [...GOLDEN_CHANGED_FILES],
      ...PRE_EDIT,
      concurrency: 4,
    });
    expect(scan.calls).toBe(0);
    expect(report.results.map((result) => result.script)).toEqual([
      scriptRelPath('001-no-debugger'),
      scriptRelPath('004-always-fails'),
      scriptRelPath('005-needs-binary'),
    ]);
    expect(report.filter).toEqual(PRE_EDIT);

    write(join(root, 'src/other.ts'), 'export const other = "changed";\n');
    const again = await runRuleScriptsAsync({
      projectRoot: root,
      mode: 'strict',
      changedFiles: [...GOLDEN_CHANGED_FILES],
      ...PRE_EDIT,
    });
    expect(again.from_cache).toBe(true);
    expect(scan.calls).toBe(0);
  });

  it('a run with no filter still scans the tree for the whole-tree script', () => {
    const root = golden();
    const report = runRuleScripts({
      projectRoot: root,
      mode: 'strict',
      changedFiles: [...GOLDEN_CHANGED_FILES],
    });
    expect(scan.calls).toBe(1);
    expect(report.results).toHaveLength(6);
    expect(report.filter).toBeUndefined();
  });

  it('keeps the filtered report in report.pre-mutation.json so the two runs never evict each other', async () => {
    const root = golden();
    const full = {
      projectRoot: root,
      mode: 'strict' as const,
      changedFiles: [...GOLDEN_CHANGED_FILES],
    };
    await runRuleScriptsAsync({ ...full, ...PRE_EDIT });
    expect(existsSync(join(root, PATHS.RULE_SCRIPTS_PRE_MUTATION_REPORT))).toBe(true);
    expect(existsSync(join(root, PATHS.RULE_SCRIPTS_REPORT))).toBe(false);

    await runRuleScriptsAsync(full);
    expect(existsSync(join(root, PATHS.RULE_SCRIPTS_REPORT))).toBe(true);

    expect((await runRuleScriptsAsync({ ...full, ...PRE_EDIT })).from_cache).toBe(true);
    expect((await runRuleScriptsAsync(full)).from_cache).toBe(true);
    const preEdit = JSON.parse(
      readFileSync(join(root, PATHS.RULE_SCRIPTS_PRE_MUTATION_REPORT), 'utf8'),
    ) as { results: unknown[] };
    expect(preEdit.results).toHaveLength(3);
  });

  it('does not reuse a cached report written under another filter', async () => {
    const root = golden();
    const base = {
      projectRoot: root,
      mode: 'strict' as const,
      changedFiles: [...GOLDEN_CHANGED_FILES],
    };
    await runRuleScriptsAsync({ ...base, kinds: ['deterministic'], scopes: ['changed-files'] });
    const other = await runRuleScriptsAsync({ ...base, kinds: ['heuristic'] });
    expect(other.from_cache).toBeUndefined();
    expect(other.results.every((result) => result.kind === 'heuristic')).toBe(true);
  });
});

describe('runRuleScriptsAsync pool', () => {
  function delayedProject(delays: number[]): { root: string; log: string } {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pool-order-'));
    roots.push(root);
    const log = join(root, 'finished.log');
    write(
      join(root, 'docs/instructions/rules/coding/pool.md'),
      delays.map((_, index) => `- Pool rule ${index}.\n`).join(''),
    );
    const scanned = scanAndEmbedIds(root);
    const ids = scanned.inventory.map((item) => item.id);
    let map = assembleMap(
      scanned.inventory,
      new Map(
        ids.map((id) => [
          id,
          { id, verifiability: { kind: 'deterministic' as const }, enforced_by: [] },
        ]),
      ),
      scanned.rule_files_hash,
      null,
    );
    delays.forEach((delay, index) => {
      const rel = `.paqad/scripts/rules/coding/pool/00${index}-wait.mjs`;
      write(
        join(root, rel),
        [
          '// @paqad-rule-script',
          `// rule_id: ${ids[index]}`,
          '// source: docs/instructions/rules/coding/pool.md',
          '// kind: deterministic',
          '// scope: changed-files',
          '// runtime: node',
          "import { appendFileSync, readFileSync } from 'node:fs';",
          "const { files } = JSON.parse(readFileSync(0, 'utf8'));",
          `setTimeout(() => {`,
          `  appendFileSync(${JSON.stringify(log)}, '${index}\\n');`,
          `  process.stdout.write(JSON.stringify({ rule_id: '${ids[index]}', kind: 'deterministic', findings: [{ file: files[0], message: 'slot ${index}', severity: 'low' }] }));`,
          `}, ${delay});`,
          '',
        ].join('\n'),
      );
      map = upsertScriptEntry(map, ids[index]!, {
        path: rel,
        kind: 'deterministic',
        runtime: 'node',
        scope: 'changed-files',
        last_validated_at: '2026-10-27T00:00:00Z',
        fixtures_passed: true,
      });
    });
    applyRuleScriptMap({
      projectRoot: root,
      map,
      via: 'test',
      event: { action: 'generate', rule_ids: ids },
    });
    write(join(root, 'src/a.ts'), 'export const a = 1;\n');
    appendFileSync(log, '');
    return { root, log };
  }

  it('AC-20: results come out in map order when scripts finish in reverse order', async () => {
    const { root, log } = delayedProject([1200, 800, 400, 0]);
    const report = await runRuleScriptsAsync({
      projectRoot: root,
      mode: 'warn',
      changedFiles: ['src/a.ts'],
      concurrency: 4,
    });
    expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual(['3', '2', '1', '0']);
    expect(report.results.map((result) => result.findings[0]?.message)).toEqual([
      'slot 0',
      'slot 1',
      'slot 2',
      'slot 3',
    ]);
  });
});
