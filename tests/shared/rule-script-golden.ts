import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { assembleMap, scanAndEmbedIds } from '@/rule-scripts/analyzer.js';
import { applyRuleScriptMap } from '@/rule-scripts/apply.js';
import { upsertScriptEntry } from '@/rule-scripts/mutate.js';
import type { ScriptScope } from '@/rule-scripts/types.js';

export const GOLDEN_NOW = '2026-10-27T00:00:00.000Z';
export const GOLDEN_CHANGED_FILES = ['src/app.ts', 'src/clean.ts'];

interface GoldenScript {
  name: string;
  kind: 'deterministic' | 'heuristic';
  scope: ScriptScope;
  body?: (ruleId: string) => string;
  requires?: string;
}

function header(ruleId: string, script: GoldenScript): string {
  return [
    '// @paqad-rule-script',
    `// rule_id: ${ruleId}`,
    '// source: docs/instructions/rules/coding/golden.md',
    `// kind: ${script.kind}`,
    `// scope: ${script.scope}`,
    '// runtime: node',
    ...(script.requires ? [`// requires: ${script.requires}`] : []),
    '',
  ].join('\n');
}

function lineFinder(pattern: string, message: string, severity: string, kind: string) {
  return (ruleId: string): string =>
    [
      "import { readFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      "const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));",
      'const findings = [];',
      'for (const file of files) {',
      "  const text = readFileSync(join(projectRoot, file), 'utf8');",
      "  text.split('\\n').forEach((line, i) => {",
      `    if (/${pattern}/.test(line)) findings.push({ file, line: i + 1, message: '${message}', severity: '${severity}' });`,
      '  });',
      '}',
      `process.stdout.write(JSON.stringify({ rule_id: '${ruleId}', kind: '${kind}', findings }));`,
      '',
    ].join('\n');
}

export const GOLDEN_SCRIPTS: GoldenScript[] = [
  {
    name: '001-no-debugger',
    kind: 'deterministic',
    scope: 'changed-files',
    body: lineFinder('\\bdebugger\\b', 'debugger statement', 'blocker', 'deterministic'),
  },
  {
    name: '002-todo-marker',
    kind: 'heuristic',
    scope: 'changed-files',
    body: (ruleId) =>
      `${lineFinder('TODO', 'todo marker', 'low', 'heuristic')(ruleId)}process.stderr.write('note from heuristic');\n`,
  },
  {
    name: '003-no-fixme-anywhere',
    kind: 'deterministic',
    scope: 'whole-tree',
    body: lineFinder('FIXME', 'fixme marker', 'high', 'deterministic'),
  },
  {
    name: '004-always-fails',
    kind: 'deterministic',
    scope: 'changed-files',
    body: () => "process.stderr.write('boom');\nprocess.exit(1);\n",
  },
  {
    name: '005-needs-binary',
    kind: 'deterministic',
    scope: 'changed-files',
    requires: '{"binaries":["paqad-golden-missing-binary"]}',
    body: lineFinder('never', 'never', 'low', 'deterministic'),
  },
  { name: '006-file-missing', kind: 'heuristic', scope: 'changed-files' },
];

function write(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
}

export function scriptRelPath(name: string): string {
  return `.paqad/scripts/rules/coding/golden/${name}.mjs`;
}

export function buildGoldenProject(prefix = 'paqad-golden-'): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  write(
    join(root, 'docs/instructions/rules/coding/golden.md'),
    GOLDEN_SCRIPTS.map((script) => `- Golden rule ${script.name}.\n`).join(''),
  );
  const scan = scanAndEmbedIds(root);
  const ids = scan.inventory.map((item) => item.id);
  let map = assembleMap(
    scan.inventory,
    new Map(
      ids.map((id) => [
        id,
        { id, verifiability: { kind: 'deterministic' as const }, enforced_by: [] },
      ]),
    ),
    scan.rule_files_hash,
    null,
    new Date(GOLDEN_NOW),
  );
  GOLDEN_SCRIPTS.forEach((script, index) => {
    const ruleId = ids[index]!;
    const rel = scriptRelPath(script.name);
    if (script.body) {
      write(join(root, rel), `${header(ruleId, script)}${script.body(ruleId)}`);
    }
    map = upsertScriptEntry(map, ruleId, {
      path: rel,
      kind: script.kind,
      runtime: 'node',
      scope: script.scope,
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
  write(join(root, 'src/app.ts'), 'export function f() {\n  debugger;\n  return "TODO";\n}\n');
  write(join(root, 'src/clean.ts'), 'export const clean = 1;\n');
  write(join(root, 'src/other.ts'), 'export const other = "FIXME";\ndebugger;\n');
  return root;
}
