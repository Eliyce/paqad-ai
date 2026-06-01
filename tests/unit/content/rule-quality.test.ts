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
  'capabilities/security/rules/pentest.md',
];

const ruleFiles = fg.sync('**/rules/**/*.md', { cwd: RUNTIME }).sort();
const guardedFiles = ruleFiles.filter((rel) => !WORKFLOW_SPEC_ALLOWLIST.includes(rel));

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
});
