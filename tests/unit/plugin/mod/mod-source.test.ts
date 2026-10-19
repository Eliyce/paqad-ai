import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Issue #639, Part 8 (decisions 3 and 4, AC-34): the HUD mod never calls a model or the network
// and starts no process. It runs in Claude Code's sandbox, so it also uses no Node module, no
// `require` and no `import()` (a module holding one does not load). Checked on the source of every
// file the mod ships.

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
  // Posix separators, so the names read the same on Windows.
  name: relative(MOD_DIR, path).replace(/\\/g, '/'),
  text: readFileSync(path, 'utf8'),
}));

// Issue #639, Part 23 (AC-54): the cost modules join the list and the same checks, so the cost
// pill, the Cost tab and /paqad cost read a file and never the network.
describe('the HUD mod source (AC-34, AC-54)', () => {
  it('has the files the design names', () => {
    expect(sources.map((s) => s.name).sort()).toEqual(
      [
        'band.ts',
        'commands.ts',
        'config.ts',
        'cost.ts',
        'model.ts',
        'pane.ts',
        'register.test.ts',
        'register.tsx',
        'test/fixtures.ts',
        'test/world.ts',
        'types/index.d.ts',
      ].sort(),
    );
  });

  it.each(sources.map((s) => [s.name, s.text]))(
    '%s calls no model, no network and no process',
    (_name, text) => {
      expect(text).not.toMatch(/\$\.model\b/);
      expect(text).not.toMatch(/\$\.http\b/);
      expect(text).not.toMatch(/\$\.process\b/);
      expect(text).not.toMatch(/\bimport\s*\(/);
      expect(text).not.toMatch(/\brequire\s*\(/);
      expect(text).not.toMatch(/from 'node:/);
    },
  );

  it.each(sources.map((s) => [s.name, s.text]))('%s uses no em dash', (_name, text) => {
    expect(text).not.toContain('—');
  });

  it('keeps the pure modules free of Claude Code imports, so vitest runs them', () => {
    for (const name of ['band.ts', 'commands.ts', 'config.ts', 'cost.ts', 'model.ts', 'pane.ts']) {
      const text = sources.find((s) => s.name === name)!.text;
      expect(text, name).not.toContain("from 'claude-code'");
    }
  });
});
