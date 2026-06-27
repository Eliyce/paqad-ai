import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  composeRuleContext,
  refreshRuleContext,
  selectTriggeredRules,
} from '@/context/rule-context.js';
import { PATHS } from '@/core/constants/paths.js';
import type { CompiledRule, CompiledRulesStore } from '@/core/types/planning.js';

function rule(partial: Partial<CompiledRule> & { rule_id: string }): CompiledRule {
  return {
    title: 'A Rule',
    source_path: 'docs/instructions/rules/coding/a.md',
    trigger_patterns: ['src/'],
    severity: 'should',
    summary: 'Summary.',
    raw_text: `# ${partial.rule_id} body`,
    ...partial,
  };
}

function store(rules: CompiledRule[]): CompiledRulesStore {
  return { schema_version: 1, generated_at: 'now', source_hash: 'sha256:x', rules };
}

describe('selectTriggeredRules', () => {
  const rules = [
    rule({ rule_id: 'SCOPED-SRC', trigger_patterns: ['src/'] }),
    rule({ rule_id: 'SCOPED-DOCS', trigger_patterns: ['docs/'] }),
    rule({ rule_id: 'ALWAYS-STAR', trigger_patterns: ['**'] }),
    rule({ rule_id: 'ALWAYS-EMPTY', trigger_patterns: [] }),
  ];

  it('always-load rules load regardless of the files in play', () => {
    const { alwaysLoad } = selectTriggeredRules(rules, []);
    expect(alwaysLoad.map((r) => r.rule_id).sort()).toEqual(['ALWAYS-EMPTY', 'ALWAYS-STAR']);
  });

  it('a scoped rule loads only when a changed path matches its trigger', () => {
    const { triggered } = selectTriggeredRules(rules, ['src/foo.ts']);
    expect(triggered.map((r) => r.rule_id)).toEqual(['SCOPED-SRC']);
  });

  it('non-matching scoped rules are not loaded', () => {
    const { triggered } = selectTriggeredRules(rules, ['src/foo.ts']);
    expect(triggered.map((r) => r.rule_id)).not.toContain('SCOPED-DOCS');
  });

  it('no files in play loads no scoped rules (only always-load apply)', () => {
    const { triggered, alwaysLoad } = selectTriggeredRules(rules, []);
    expect(triggered).toHaveLength(0);
    expect(alwaysLoad).toHaveLength(2);
  });
});

describe('composeRuleContext', () => {
  it('emits the manifest plus full text of matched + always-load rules only', () => {
    const md = composeRuleContext(
      store([
        rule({ rule_id: 'SCOPED-SRC', trigger_patterns: ['src/'], raw_text: 'SRC FULL TEXT' }),
        rule({ rule_id: 'SCOPED-DOCS', trigger_patterns: ['docs/'], raw_text: 'DOCS FULL TEXT' }),
        rule({ rule_id: 'ALWAYS', trigger_patterns: ['**'], raw_text: 'ALWAYS FULL TEXT' }),
      ]),
      { changedPaths: ['src/app.ts'] },
    );
    // Manifest lists everyone.
    expect(md).toContain('paqad rule manifest — 3 rules');
    // Full text only for the matched scoped rule and the always-load rule.
    expect(md).toContain('## Loaded rule text');
    expect(md).toContain('SRC FULL TEXT');
    expect(md).toContain('ALWAYS FULL TEXT');
    expect(md).not.toContain('DOCS FULL TEXT');
  });

  it('drops to manifest-only when nothing applies (token floor)', () => {
    const md = composeRuleContext(
      store([rule({ rule_id: 'SCOPED-DOCS', trigger_patterns: ['docs/'] })]),
      { changedPaths: [] },
    );
    expect(md).toContain('paqad rule manifest');
    expect(md).not.toContain('## Loaded rule text');
  });

  it('falls back to the summary when a rule has no raw_text, with no options', () => {
    // No options ⇒ changedPaths defaults to []; raw_text undefined ⇒ ruleTextBlock uses summary.
    const md = composeRuleContext(
      store([
        rule({
          rule_id: 'ALWAYS',
          trigger_patterns: ['**'],
          raw_text: undefined,
          summary: 'FALLBACK SUMMARY',
        }),
      ]),
    );
    expect(md).toContain('## Loaded rule text');
    expect(md).toContain('FALLBACK SUMMARY');
  });

  it('tolerates a store with no rules array', () => {
    const md = composeRuleContext({
      schema_version: 1,
      generated_at: 'now',
      source_hash: 'sha256:x',
    } as CompiledRulesStore);
    expect(md).toContain('paqad rule manifest');
    expect(md).not.toContain('## Loaded rule text');
  });
});

describe('refreshRuleContext', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-rulectx-'));
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function writeCompiled(rules: CompiledRule[]): void {
    writeFileSync(join(projectRoot, PATHS.COMPILED_RULES), JSON.stringify(store(rules)));
  }

  it('writes the composed rule context to the seam artifact', async () => {
    writeCompiled([rule({ rule_id: 'ALWAYS', trigger_patterns: ['**'], raw_text: 'ALWAYS TEXT' })]);
    const target = await refreshRuleContext(projectRoot);
    expect(target).toBe(join(projectRoot, PATHS.CONTEXT_SESSION_ARTIFACT));
    const written = readFileSync(join(projectRoot, PATHS.CONTEXT_SESSION_ARTIFACT), 'utf8');
    expect(written).toContain('paqad rule manifest');
    expect(written).toContain('ALWAYS TEXT');
  });

  it('returns null when there are no compiled rules', async () => {
    expect(await refreshRuleContext(projectRoot)).toBeNull();
  });

  it('no-ops when another refresh holds the single-flight lock', async () => {
    writeCompiled([rule({ rule_id: 'ALWAYS', trigger_patterns: ['**'] })]);
    mkdirSync(join(projectRoot, PATHS.LOCKS_DIR, 'rule-context.lock'), { recursive: true });
    expect(await refreshRuleContext(projectRoot)).toBeNull();
  });

  it('the composed context appears via the seam hook (end-to-end, rag on)', async () => {
    writeCompiled([rule({ rule_id: 'ALWAYS', trigger_patterns: ['**'], raw_text: 'ALWAYS TEXT' })]);
    await refreshRuleContext(projectRoot);
    const hook = resolve(__dirname, '../../../runtime/hooks/context-seam-inject.mjs');
    const stdout = execFileSync('node', [hook], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot, PAQAD_RAG_ENABLED: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString('utf8');
    expect(stdout).toContain('[paqad-context]');
    expect(stdout).toContain('paqad rule manifest');
    expect(stdout).toContain('ALWAYS TEXT');
  });

  it('threads the F21 memory section into the artifact, ahead of retrieval', async () => {
    writeCompiled([rule({ rule_id: 'ALWAYS', trigger_patterns: ['**'], raw_text: 'ALWAYS TEXT' })]);
    await refreshRuleContext(projectRoot, {
      memorySection: '## Codebase memory — 1 remembered fact\nMEMORY BODY',
      retrievalSection: '## Retrieved context — 1 slice\nRETRIEVAL BODY',
    });
    const written = readFileSync(join(projectRoot, PATHS.CONTEXT_SESSION_ARTIFACT), 'utf8');
    expect(written).toContain('MEMORY BODY');
    expect(written).toContain('RETRIEVAL BODY');
    // Durable memory sits ahead of the ephemeral retrieval slices.
    expect(written.indexOf('MEMORY BODY')).toBeLessThan(written.indexOf('RETRIEVAL BODY'));
  });

  it('writes a memory-only artifact when there are no compiled rules', async () => {
    const target = await refreshRuleContext(projectRoot, {
      memorySection: '## Codebase memory — 1 remembered fact\nMEMORY ONLY',
    });
    expect(target).toBe(join(projectRoot, PATHS.CONTEXT_SESSION_ARTIFACT));
    expect(readFileSync(target as string, 'utf8')).toContain('MEMORY ONLY');
  });

  it('appends the F27 base-drift section last, after the rule text', async () => {
    writeCompiled([rule({ rule_id: 'ALWAYS', trigger_patterns: ['**'], raw_text: 'ALWAYS TEXT' })]);
    const target = await refreshRuleContext(projectRoot, {
      driftSection: '## Base drift\nDRIFT HEADS-UP',
    });
    const written = readFileSync(target as string, 'utf8');
    expect(written).toContain('ALWAYS TEXT');
    expect(written).toContain('DRIFT HEADS-UP');
    expect(written.indexOf('ALWAYS TEXT')).toBeLessThan(written.indexOf('DRIFT HEADS-UP'));
  });
});
