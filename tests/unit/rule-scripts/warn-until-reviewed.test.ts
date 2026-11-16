import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { appendChoice, markChoicesReviewed, readChoices } from '@/onboarding/journey/choices.js';
import {
  clearJourneyRuleCheckFlags,
  flagJourneyRuleChecks,
  reviewChoices,
  ruleIds,
} from '@/onboarding/journey/rule-checks.js';
import { applyRuleScriptMap } from '@/rule-scripts/apply.js';
import { assembleMap, scanAndEmbedIds } from '@/rule-scripts/analyzer.js';
import { loadRuleScriptMap } from '@/rule-scripts/map.js';
import { upsertScriptEntry } from '@/rule-scripts/mutate.js';
import { runRuleScripts } from '@/rule-scripts/runner.js';

const roots: string[] = [];

function write(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
}

function script(ruleId: string, word: string): string {
  return `// @paqad-rule-script
// rule_id: ${ruleId}
// source: docs/instructions/rules/coding/q.md
// kind: deterministic
// scope: changed-files
// runtime: node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
for (const f of files) {
  if (readFileSync(join(projectRoot, f), 'utf8').includes('${word}')) findings.push({ file: f, message: '${word}', severity: 'blocker' });
}
process.stdout.write(JSON.stringify({ rule_id: '${ruleId}', kind: 'deterministic', findings }));
`;
}

function setup(): { root: string; existing: string; added: string } {
  const root = mkdtempSync(join(tmpdir(), 'paqad-warn-'));
  roots.push(root);
  write(
    join(root, 'docs/instructions/rules/coding/q.md'),
    '- No EXISTING marker.\n- No JOURNEY marker.\n',
  );
  const scan = scanAndEmbedIds(root);
  const [existing, added] = scan.inventory.map((item) => item.id) as [string, string];
  let map = assembleMap(
    scan.inventory,
    new Map(
      [existing, added].map((id) => [
        id,
        { id, verifiability: { kind: 'deterministic' as const }, enforced_by: [] },
      ]),
    ),
    scan.rule_files_hash,
    null,
  );
  for (const [id, word] of [
    [existing, 'EXISTING'],
    [added, 'JOURNEY'],
  ] as const) {
    const rel = `.paqad/scripts/rules/coding/q/${word.toLowerCase()}.mjs`;
    write(join(root, rel), script(id, word));
    map = upsertScriptEntry(map, id, {
      path: rel,
      kind: 'deterministic',
      runtime: 'node',
      scope: 'changed-files',
      last_validated_at: '2026-05-29T00:00:00Z',
      fixtures_passed: true,
    });
  }
  applyRuleScriptMap({
    projectRoot: root,
    map,
    via: 'test',
    event: { action: 'generate', rule_ids: [existing, added] },
  });
  return { root, existing, added };
}

function strictRun(root: string, body: string) {
  write(join(root, 'src/app.ts'), body);
  return runRuleScripts({ projectRoot: root, mode: 'strict', changedFiles: ['src/app.ts'] });
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('journey-added rule checks warn until reviewed', () => {
  it('AC-10 INV-12: the journey-added check only warns while the existing one blocks', () => {
    const { root, existing, added } = setup();
    expect(flagJourneyRuleChecks(root, [existing])).toEqual([added]);
    const journeyOnly = strictRun(root, 'JOURNEY\n');
    expect(journeyOnly.counts.deterministic).toBe(1);
    expect(journeyOnly.blocking).toBe(false);
    expect(
      journeyOnly.results.find((result) => result.rule_id === added)?.warn_until_reviewed,
    ).toBe(true);
    expect(strictRun(root, 'EXISTING\nJOURNEY\n').blocking).toBe(true);
  });

  it('AC-10 NFR-6: after review the journey-added check blocks', () => {
    const { root, existing, added } = setup();
    flagJourneyRuleChecks(root, [existing]);
    expect(clearJourneyRuleCheckFlags(root)).toEqual([added]);
    expect(
      loadRuleScriptMap(root)
        ?.rules.flatMap((rule) => rule.scripts)
        .some((s) => s.warn_until_reviewed),
    ).toBe(false);
    expect(strictRun(root, 'JOURNEY\n').blocking).toBe(true);
  });
});

describe('journey rule-check flags stay idempotent and follow the review (AC-10)', () => {
  const choice = (root: string, kind: string) =>
    appendChoice(root, {
      ts: '2026-05-29T00:00:00Z',
      run_id: 'run-1',
      stage: 'rule_scripts',
      kind,
      choice: 'x',
      reason: 'y',
      by: 'paqad-onboarding',
    });
  const flagged = (root: string) =>
    loadRuleScriptMap(root)
      ?.rules.flatMap((rule) => rule.scripts)
      .some((s) => s.warn_until_reviewed) ?? false;
  const clock = () => new Date('2026-05-30T00:00:00Z');

  it('lists rule ids, and changes nothing without a map or when the flags are already right', () => {
    const empty = mkdtempSync(join(tmpdir(), 'paqad-warn-empty-'));
    roots.push(empty);
    expect(ruleIds(empty)).toEqual([]);
    expect(flagJourneyRuleChecks(empty, [])).toEqual([]);
    expect(clearJourneyRuleCheckFlags(empty)).toEqual([]);

    const { root, existing, added } = setup();
    expect(ruleIds(root)).toEqual([existing, added]);
    expect(clearJourneyRuleCheckFlags(root)).toEqual([]);
    expect(flagJourneyRuleChecks(root, [existing])).toEqual([added]);
    expect(flagJourneyRuleChecks(root, [existing])).toEqual([]);
  });

  it('reviewing a warn-only choice clears the flags; reviewing another choice keeps them', () => {
    const { root, existing } = setup();
    flagJourneyRuleChecks(root, [existing]);
    const other = choice(root, 'rag');
    const warn = choice(root, 'rule_checks_warn_only');
    expect(reviewChoices(root, [other.id], clock).map((row) => row.id)).toEqual([other.id]);
    expect(flagged(root)).toBe(true);
    expect(reviewChoices(root, [warn.id], clock)).toMatchObject([
      { id: warn.id, reviewed: true, reviewed_at: '2026-05-30T00:00:00.000Z' },
    ]);
    expect(flagged(root)).toBe(false);
    expect(reviewChoices(root, 'all', clock)).toEqual([]);
  });

  it('marks choices reviewed with the real clock and writes an empty file when there are none', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-warn-choices-'));
    roots.push(root);
    expect(markChoicesReviewed(root, 'all')).toEqual([]);
    expect(readChoices(root)).toEqual([]);
    const row = choice(root, 'rag');
    const [marked] = markChoicesReviewed(root, 'all');
    expect(marked?.id).toBe(row.id);
    expect(Number.isNaN(Date.parse(marked!.reviewed_at!))).toBe(false);
  });
});
