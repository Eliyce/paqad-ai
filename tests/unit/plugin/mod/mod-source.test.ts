import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const MOD_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../runtime/claude-plugin/mod',
);

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '.claude-plugin' ? [] : files(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const sources = files(MOD_DIR).map((path) => ({
  name: relative(MOD_DIR, path).replace(/\\/g, '/'),
  text: readFileSync(path, 'utf8'),
}));

describe('the HUD mod source (AC-34, AC-54)', () => {
  it('has the files the design names', () => {
    expect(sources.map((s) => s.name).sort()).toEqual(
      [
        'ask-evidence.ts',
        'band.ts',
        'commands.ts',
        'config.ts',
        'cost.ts',
        'model.ts',
        'pane.ts',
        'paqad-cli.ts',
        'receipt.ts',
        'register.test.ts',
        'register.tsx',
        'table.ts',
        'tabs.ts',
        'test/fixtures.ts',
        'test/world.ts',
        'types/index.d.ts',
      ].sort(),
    );
  });

  it.each(sources.map((s) => [s.name, s.text]))(
    '%s calls no model, no network and no process outside the paqad-ai helper',
    (name, text) => {
      expect(text).not.toMatch(/\$\.model\b/);
      expect(text).not.toMatch(/\$\.http\b/);
      if (name !== 'paqad-cli.ts') expect(text).not.toMatch(/\$\.process\b/);
      expect(text).not.toMatch(/\bimport\s*\(/);
      expect(text).not.toMatch(/\brequire\s*\(/);
      expect(text).not.toMatch(/from 'node:/);
    },
  );

  it('runs processes only through the one paqad-ai helper, by argument vector', () => {
    const helper = sources.find((s) => s.name === 'paqad-cli.ts')!.text;
    expect(helper.match(/\$\.process\./g)).toEqual(['$.process.']);
    expect(helper).toContain('$.process.run(argv, { cwd, timeoutMs: PAQAD_CLI_TIMEOUT_MS })');
    expect(helper).toContain("export const PAQAD_BIN = 'paqad-ai';");
    expect(helper).toContain("return [PAQAD_BIN, ...verb.split(' '), ...args];");
    expect(helper).not.toMatch(/spawn|shell|exec/);
  });

  it.each(sources.map((s) => [s.name, s.text]))('%s uses no em dash', (_name, text) => {
    expect(text).not.toContain('—');
  });

  it('keeps the pure modules free of Claude Code imports, so vitest runs them', () => {
    for (const name of [
      'ask-evidence.ts',
      'band.ts',
      'commands.ts',
      'config.ts',
      'cost.ts',
      'model.ts',
      'pane.ts',
      'paqad-cli.ts',
      'receipt.ts',
      'table.ts',
      'tabs.ts',
    ]) {
      const text = sources.find((s) => s.name === name)!.text;
      expect(text, name).not.toContain("from 'claude-code'");
    }
  });
});
