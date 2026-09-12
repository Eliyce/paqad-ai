import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRulesCommand } from '@/cli/commands/rules.js';
import { createProgram } from '@/cli/program.js';
import { PATHS } from '@/core/constants/paths.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { setActiveFeature } from '@/feature-evidence/session-control.js';
import { ruleScriptMapPath } from '@/rule-scripts/map.js';

describe('paqad-ai rules command', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-cli-rules-'));
    const dir = join(root, 'docs/instructions/rules/coding');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'code-quality.md'), '- Keep functions small.\n');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  it('is registered on the program', () => {
    const names = createProgram().commands.map((c) => c.name());
    expect(names).toContain('rules');
  });

  it('compile writes the rule-script map and narrates the arming (AC-2)', async () => {
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => out.push(String(line)));

    await createRulesCommand().parseAsync(['compile', '--project-root', root], { from: 'user' });

    expect(existsSync(ruleScriptMapPath(root))).toBe(true);
    expect(out.some((line) => line.startsWith('▸ paqad'))).toBe(true);
    expect(out.some((line) => line.includes('armed'))).toBe(true);
    expect(out.some((line) => line.includes('"compiled":true'))).toBe(true);
  });

  function writeCompiledRules(): void {
    const store = {
      schema_version: 1,
      generated_at: 'now',
      source_hash: 'sha256:x',
      rules: [
        {
          rule_id: 'RULE-2',
          title: 'Constitution',
          source_path: 'docs/instructions/rules/coding/code-quality.md',
          trigger_patterns: ['**'],
          severity: 'must',
          summary: 'Always applies.',
          raw_text: '# Constitution body',
        },
      ],
    };
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, PATHS.COMPILED_RULES), JSON.stringify(store));
  }

  it('load reports there is nothing to load when no rules are compiled (#557)', async () => {
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => out.push(String(line)));
    await createRulesCommand().parseAsync(['load', '--project-root', root], { from: 'user' });
    expect(out.some((line) => line.includes('no compiled rules'))).toBe(true);
    expect(out.some((line) => line.includes('"reason":"no-compiled-rules"'))).toBe(true);
  });

  it('load prints the applicable rule text but records nothing with no active feature (#557)', async () => {
    writeCompiledRules();
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => out.push(String(line)));
    await createRulesCommand().parseAsync(['load', '--project-root', root, '--session', 'ses_x'], {
      from: 'user',
    });
    expect(out.some((line) => line.includes('Rules loaded for this change'))).toBe(true);
    expect(out.some((line) => line.includes('Constitution body'))).toBe(true);
    expect(out.some((line) => line.includes('"recorded":false'))).toBe(true);
  });

  it('load writes rules-loaded.json into the active feature bundle (#557)', async () => {
    writeCompiledRules();
    const dir = 'x-01JABCDEFGHJKMNPQRSTVWXYZ0';
    setActiveFeature(root, 'ses_x', dir);
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => out.push(String(line)));
    await createRulesCommand().parseAsync(['load', '--project-root', root, '--session', 'ses_x'], {
      from: 'user',
    });
    expect(existsSync(join(root, featureFilePath(dir, 'rulesLoaded')))).toBe(true);
    expect(out.some((line) => line.includes('"recorded":true'))).toBe(true);
  });

  it('load narrates the plural when more than one rule applies (#557)', async () => {
    const store = {
      schema_version: 1,
      generated_at: 'now',
      source_hash: 'sha256:x',
      rules: [
        {
          rule_id: 'RULE-2',
          title: 'Constitution',
          source_path: 'a.md',
          trigger_patterns: ['**'],
          severity: 'must',
          summary: 's',
          raw_text: '# a',
        },
        {
          rule_id: 'RULE-5',
          title: 'Observability',
          source_path: 'b.md',
          trigger_patterns: ['**'],
          severity: 'must',
          summary: 's',
          raw_text: '# b',
        },
      ],
    };
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, PATHS.COMPILED_RULES), JSON.stringify(store));
    const dir = 'x-01JABCDEFGHJKMNPQRSTVWXYZ0';
    setActiveFeature(root, 'ses_x', dir);
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => out.push(String(line)));
    await createRulesCommand().parseAsync(['load', '--project-root', root, '--session', 'ses_x'], {
      from: 'user',
    });
    expect(out.some((line) => line.includes('2 applicable rules'))).toBe(true);
  });

  it('load --silent suppresses the machine-readable summary line (#557)', async () => {
    writeCompiledRules();
    const dir = 'x-01JABCDEFGHJKMNPQRSTVWXYZ0';
    setActiveFeature(root, 'ses_x', dir);
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => out.push(String(line)));
    await createRulesCommand().parseAsync(
      ['load', '--project-root', root, '--session', 'ses_x', '--silent'],
      { from: 'user' },
    );
    expect(existsSync(join(root, featureFilePath(dir, 'rulesLoaded')))).toBe(true);
    expect(out.some((line) => line.includes('"recorded":true'))).toBe(false);
    expect(out.some((line) => line.startsWith('▸ paqad'))).toBe(true);
  });
});
