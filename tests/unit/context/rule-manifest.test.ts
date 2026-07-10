import { describe, expect, it } from 'vitest';

import { generateRuleManifest, scriptedSourcePaths } from '@/context/rule-manifest.js';
import type { CompiledRule, CompiledRulesStore } from '@/core/types/planning.js';
import type { RuleScriptMap } from '@/rule-scripts/types.js';

function rule(partial: Partial<CompiledRule> & { rule_id: string }): CompiledRule {
  return {
    title: 'A Rule',
    source_path: 'docs/instructions/rules/coding/a.md',
    trigger_patterns: ['src/'],
    severity: 'should',
    summary: 'Do the thing.',
    ...partial,
  };
}

function store(rules: CompiledRule[]): CompiledRulesStore {
  return { schema_version: 1, generated_at: 'now', source_hash: 'sha256:x', rules };
}

describe('generateRuleManifest', () => {
  it('lists every rule with id, title, severity, triggers and summary', () => {
    const md = generateRuleManifest(
      store([
        rule({
          rule_id: 'RULE-1',
          title: 'Canonical Docs',
          severity: 'could',
          trigger_patterns: ['docs/'],
          summary: 'Treat docs as authoritative.',
        }),
        rule({
          rule_id: 'RULE-2',
          title: 'No Secrets',
          severity: 'must',
          trigger_patterns: ['**'],
          summary: 'Never commit secrets.',
        }),
      ]),
    );
    expect(md).toContain('## paqad rule manifest — 2 rules');
    expect(md).toContain('**RULE-1** Canonical Docs · could · triggers: `docs/`');
    expect(md).toContain('Treat docs as authoritative.');
    expect(md).toContain('**RULE-2** No Secrets · must · triggers: `**`');
  });

  it('marks script-enforced rules with the glyph and only those', () => {
    const scripted = new Set(['docs/instructions/rules/security/secrets.md']);
    const md = generateRuleManifest(
      store([
        rule({ rule_id: 'RULE-1', source_path: 'docs/instructions/rules/coding/a.md' }),
        rule({ rule_id: 'RULE-9', source_path: 'docs/instructions/rules/security/secrets.md' }),
      ]),
      { scriptedSourcePaths: scripted },
    );
    const lines = md.split('\n');
    expect(lines.find((l) => l.includes('RULE-9'))).toContain('⚙');
    expect(lines.find((l) => l.includes('RULE-1'))).not.toContain('⚙');
  });

  it('falls back to ** for a rule with no triggers', () => {
    const md = generateRuleManifest(store([rule({ rule_id: 'RULE-3', trigger_patterns: [] })]));
    expect(md).toContain('triggers: `**`');
  });

  it('collapses and truncates a long multi-line summary to one capped line', () => {
    const long = '- ' + 'word '.repeat(80);
    const md = generateRuleManifest(store([rule({ rule_id: 'RULE-4', summary: long })]), {
      maxSummaryChars: 30,
    });
    const line = md.split('\n').find((l) => l.includes('RULE-4'))!;
    expect(line).toContain('…');
    expect(line).not.toContain('\n- word'); // flattened, no leading bullet
    const summarySeg = line.split(' — ')[1];
    expect(summarySeg.length).toBeLessThanOrEqual(30);
  });

  it('handles an empty rule set without error', () => {
    const md = generateRuleManifest(store([]));
    expect(md).toContain('## paqad rule manifest — 0 rules');
    expect(md).toContain('No rules compiled yet');
  });

  it('never emits the corrupted `, ` sequence, even with comma-separated inline code (#345)', () => {
    const md = generateRuleManifest(
      store([
        rule({
          rule_id: 'RULE-1',
          title: 'Frontmatter',
          trigger_patterns: ['runtime/**/skills/*', 'SKILL.md'],
          summary: 'Use the documented frontmatter — `name`, `description`, `license`.',
        }),
      ]),
    );
    expect(md).not.toContain('`, `');
    // Both triggers still render (space-separated, single backtick spans).
    expect(md).toContain('`runtime/**/skills/*`');
    expect(md).toContain('`SKILL.md`');
  });
});

describe('scriptedSourcePaths', () => {
  it('returns sources whose rules have at least one script', () => {
    const map: RuleScriptMap = {
      schema_version: 1 as RuleScriptMap['schema_version'],
      generated_at: 'now',
      rule_files_hash: 'h',
      rules: [
        {
          id: 'RL-a',
          source: 'a.md',
          text: '',
          text_hash: '',
          verifiability: {} as never,
          enforced_by: [],
          scripts: [{ path: 'x.mjs' } as never],
        },
        {
          id: 'RL-b',
          source: 'b.md',
          text: '',
          text_hash: '',
          verifiability: {} as never,
          enforced_by: [],
          scripts: [],
        },
      ],
    };
    const set = scriptedSourcePaths(map);
    expect(set.has('a.md')).toBe(true);
    expect(set.has('b.md')).toBe(false);
  });

  it('degrades to an empty set for a null map', () => {
    expect(scriptedSourcePaths(null).size).toBe(0);
  });
});
