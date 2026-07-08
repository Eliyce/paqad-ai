import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRulesCommand } from '@/cli/commands/rules.js';
import { createProgram } from '@/cli/program.js';
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
});
