import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import fg from 'fast-glob';
import { describe, expect, it } from 'vitest';

const RUNTIME = join(process.cwd(), 'runtime');

/**
 * Workflow specifications that predate the rules-as-rules contract. They are
 * full workflows (triggers, steps, run state) that happen to live under
 * `rules/`. Relocating them out of the copied rule set is tracked separately;
 * until then they are allowlisted so the guard can enforce the contract on the
 * rest of the corpus. See `runtime/rules-authoring.md`.
 */
const WORKFLOW_SPEC_ALLOWLIST = [
  'capabilities/coding/rules/design-test.md',
  'capabilities/coding/rules/design-retest.md',
  'capabilities/coding/rules/feature-development.md',
  'capabilities/coding/rules/codebase-health.md',
  'capabilities/coding/rules/health-retest.md',
  'capabilities/security/rules/pentest.md',
];

const ruleFiles = fg.sync('**/rules/**/*.md', { cwd: RUNTIME }).sort();
const guardedFiles = ruleFiles.filter((rel) => !WORKFLOW_SPEC_ALLOWLIST.includes(rel));

/**
 * A rule must earn its place: a stack rule may sharpen an always-on rule with
 * stack-specific detail, but it must not merely restate one. Always-on rules
 * (base + capability-level + `_shared`) ship to every project alongside the
 * stack rules, so a near-verbatim copy is pure duplication the consumer reads
 * twice. This guard backstops that — see issue #94.
 */
const REDUNDANCY_THRESHOLD = 0.6;

const isAlwaysOnRule = (rel: string): boolean =>
  rel.startsWith('base/rules/') ||
  /^capabilities\/(?:coding|content|security)\/rules\/[^/]+\.md$/.test(rel) ||
  rel.includes('/stacks/_shared/rules/');

const normalizeBullet = (text: string): string =>
  text
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/^[.\s]+|[.\s]+$/g, '');

const bulletTokens = (text: string): Set<string> =>
  new Set(
    normalizeBullet(text)
      .split(' ')
      .filter((word) => word.length > 3),
  );

const jaccard = (a: Set<string>, b: Set<string>): number => {
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
};

interface Bullet {
  file: string;
  text: string;
  tokens: Set<string>;
}

const extractBullets = (rel: string): Bullet[] => {
  const bullets: Bullet[] = [];
  for (const line of readFileSync(join(RUNTIME, rel), 'utf8').split('\n')) {
    const match = line.match(/^\s*[-*]\s+(.*)/);
    if (!match) continue;
    const text = match[1].trim();
    if (normalizeBullet(text).length < 10) continue;
    bullets.push({ file: rel, text, tokens: bulletTokens(text) });
  }
  return bullets;
};

const alwaysOnBullets = guardedFiles.filter(isAlwaysOnRule).flatMap(extractBullets);
const stackBullets = guardedFiles.filter((rel) => !isAlwaysOnRule(rel)).flatMap(extractBullets);

describe('rule quality guard', () => {
  it('discovers the rule corpus', () => {
    expect(ruleFiles.length).toBeGreaterThan(50);
  });

  it.each(ruleFiles)('%s starts with an H1 heading', (rel) => {
    expect(readFileSync(join(RUNTIME, rel), 'utf8')).toMatch(/^# /m);
  });

  it.each(guardedFiles)('%s contains no workflow-spec markers', (rel) => {
    const content = readFileSync(join(RUNTIME, rel), 'utf8');
    // A rule is a constraint, not a workflow: no triggers, numbered steps, or run state.
    expect(content, 'has a "## Trigger" section').not.toMatch(/^#{2,4}\s+Trigger\b/im);
    expect(content, 'has a "### Step N" section').not.toMatch(/^#{2,4}\s+Step\b/im);
    expect(content, 'references a workflow run_id').not.toMatch(/\brun_id\b/);
  });

  it.each(guardedFiles)('%s does not leak framework plumbing', (rel) => {
    const content = readFileSync(join(RUNTIME, rel), 'utf8');
    // Rules ship into the project and must survive deleting `.paqad/`.
    expect(content, 'references the .paqad/ runtime directory').not.toMatch(/\.paqad\//);
  });

  it('no stack rule restates an always-on rule', () => {
    const violations: string[] = [];
    for (const stack of stackBullets) {
      for (const base of alwaysOnBullets) {
        const score = jaccard(stack.tokens, base.tokens);
        if (score >= REDUNDANCY_THRESHOLD) {
          violations.push(
            `${stack.file}\n    "${stack.text}"\n  duplicates ${base.file}\n    "${base.text}" (overlap ${score.toFixed(2)})`,
          );
        }
      }
    }
    expect(
      violations,
      `Stack rules must sharpen, not restate, always-on rules:\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});
