import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runCapabilityGate } from '@/kernel/gate.js';
import { assembleMap, scanAndEmbedIds } from '@/rule-scripts/analyzer.js';
import { applyRuleScriptMap } from '@/rule-scripts/apply.js';
import { upsertScriptEntry } from '@/rule-scripts/mutate.js';

import { seedGitChangedFiles } from '../pipeline/changed-files.fixture.js';

vi.mock('@/rule-scripts/edit-result.js', () => ({
  judgeEditResult: vi.fn(() => Promise.reject(new Error('comparison crashed'))),
}));

const SCRIPT_REL = '.paqad/scripts/rules/coding/gate/001-flag.mjs';
const roots: string[] = [];

function write(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
}

function blockedProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-edit-crash-'));
  roots.push(root);
  write(join(root, 'docs/instructions/rules/coding/gate.md'), '- Flag.\n');
  const scanned = scanAndEmbedIds(root);
  const ruleId = scanned.inventory[0]!.id;
  write(
    join(root, SCRIPT_REL),
    [
      '// @paqad-rule-script',
      `// rule_id: ${ruleId}`,
      '// source: docs/instructions/rules/coding/gate.md',
      '// kind: deterministic',
      '// scope: changed-files',
      '// runtime: node',
      `process.stdout.write(JSON.stringify({ rule_id: '${ruleId}', kind: 'deterministic', findings: [{ file: 'src/app.ts', line: 1, message: 'flag', severity: 'blocker' }] }));`,
      '',
    ].join('\n'),
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
  write(join(root, '.paqad/configs/.config.policy'), 'rule_compliance=strict\nstages_mode=off\n');
  write(join(root, 'src/app.ts'), 'flag;\n');
  seedGitChangedFiles(root, ['src/app.ts']);
  return root;
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('AC-83: a crash in the comparison', () => {
  it('AC-83: reaches the hook as a gate failure, which refuses a pre-mutation edit', async () => {
    const root = blockedProject();
    const file = join(root, 'src/app.ts');
    await expect(
      runCapabilityGate({
        projectRoot: root,
        seam: 'pre-mutation',
        env: {},
        payload: {
          sessionId: 'sess-crash',
          toolName: 'Edit',
          toolInput: { file_path: file, old_string: 'flag;\n', new_string: '' },
          targetPath: file,
          targetPaths: [file],
        },
      }),
    ).rejects.toThrow('comparison crashed');
  });
});
