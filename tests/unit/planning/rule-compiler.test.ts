import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  compileRules,
  computeSourceHash,
  isCompiledRulesStale,
  readCompiledRules,
  writeCompiledRules,
} from '@/planning/rule-compiler.js';
import { injectRuleCriteria } from '@/planning/rule-injection.js';

import { createManifest } from './fixtures.js';

describe('rule-compiler and injection', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'planning-rules-'));
    mkdirSync(join(root, 'docs/instructions/rules/coding'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('compiles rules, persists them, checks staleness, and injects criteria', async () => {
    writeFileSync(
      join(root, 'docs/instructions/rules/coding/architecture.md'),
      '# Architecture\n\nYou must update `src/planning` safely.\n',
    );
    writeFileSync(join(root, 'docs/instructions/rules/coding/empty.md'), '');

    const compiled = await compileRules(root);
    expect(compiled.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          trigger_patterns: ['src/planning'],
          severity: 'must',
        }),
        expect.objectContaining({
          trigger_patterns: ['**'],
          summary: 'Unparseable rule content; preserve raw text for planning context.',
        }),
      ]),
    );

    await writeCompiledRules(root, compiled);
    await expect(readCompiledRules(root)).resolves.toMatchObject({ rules: expect.any(Array) });
    await expect(isCompiledRulesStale(root)).resolves.toBe(false);

    writeFileSync(
      join(root, 'docs/instructions/rules/coding/architecture.md'),
      '# Architecture\n\nYou should update `src/planning` carefully.\n',
    );
    await expect(isCompiledRulesStale(root)).resolves.toBe(true);
    await expect(computeSourceHash(root)).resolves.toMatch(/^sha256:/);

    const injected = injectRuleCriteria(createManifest(), compiled);
    expect(injected.verification_matrix).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'compiled-rule',
        }),
      ]),
    );
  });

  it('supports explicit trigger directives and non-must severities', async () => {
    writeFileSync(
      join(root, 'docs/instructions/rules/coding/directive.md'),
      '# Directive\n\n<!-- trigger: src/a.ts, src/b.ts -->\nThis should stay readable.\n',
    );
    writeFileSync(
      join(root, 'docs/instructions/rules/coding/could.md'),
      '# Could\n\nMaybe prefer a lighter pattern here.\n',
    );

    const compiled = await compileRules(root);
    expect(compiled.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          trigger_patterns: ['src/a.ts', 'src/b.ts'],
          severity: 'should',
        }),
        expect.objectContaining({
          severity: 'could',
        }),
      ]),
    );

    await expect(readCompiledRules(join(root, 'missing'))).resolves.toBeNull();
    await expect(isCompiledRulesStale(join(root, 'missing'))).resolves.toBe(true);
  });

  it('excludes a `gate:`-tagged rule when its flag is off — zero bytes compiled (issue #279)', async () => {
    writeFileSync(
      join(root, 'docs/instructions/rules/coding/architecture.md'),
      '# Architecture\n\nYou must update `src/planning` safely.\n',
    );
    writeFileSync(
      join(root, 'docs/instructions/rules/coding/analytics-instrumentation.md'),
      '<!--gate: analytics_instrumentation-->\n# Analytics Instrumentation\n\nInstrument every `event`.\n',
    );

    const compiled = await compileRules(root);

    const titles = compiled.rules.map((rule) => rule.title);
    expect(titles).toContain('Architecture');
    expect(titles).not.toContain('Analytics Instrumentation');
    const serialized = JSON.stringify(compiled);
    expect(serialized).not.toContain('Instrument every');
    expect(serialized).not.toContain('analytics_instrumentation');
    // rule_ids stay contiguous after the gated rule is filtered out.
    expect(compiled.rules.map((rule) => rule.rule_id)).toEqual(['RULE-1']);
  });

  it('compiles the `gate:`-tagged rule when its flag is on (issue #279)', async () => {
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, '.paqad', '.config'), 'analytics_instrumentation=true\n');
    writeFileSync(
      join(root, 'docs/instructions/rules/coding/analytics-instrumentation.md'),
      '<!--gate: analytics_instrumentation-->\n# Analytics Instrumentation\n\nInstrument every `event`.\n',
    );

    const compiled = await compileRules(root);

    expect(compiled.rules.map((rule) => rule.title)).toContain('Analytics Instrumentation');
  });
});
