import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { HOME_PATH_PATTERN, LAUNCHER } from './helpers';

const source = readFileSync(LAUNCHER, 'utf8');

describe('the launcher template is self-contained', () => {
  it('imports Node built-ins only', () => {
    const specifiers = [...source.matchAll(/^import[^'"]*from '([^']+)';$/gms)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.every((s) => s!.startsWith('node:'))).toBe(true);
    expect(source).not.toMatch(/\bimport\(/);
    expect(source).not.toMatch(/\brequire\(/);
  });

  it('avoids syntax older Node cannot parse, so it can report an old Node instead', () => {
    expect(source).not.toContain('?.');
    expect(source).not.toContain('??');
    expect(source).not.toMatch(/^\s*(?:await|#\w+)/m);
  });

  it('holds the plugin URL as a constant and no home path', () => {
    expect(source).toContain(
      "export const PLUGIN_REPO_URL = 'https://github.com/Eliyce/paqad-claude-plugin.git';",
    );
    expect(source.match(/https:\/\//g)).toHaveLength(1);
    expect(source).not.toMatch(HOME_PATH_PATTERN);
    expect(source).not.toContain(homedir());
  });

  it('carries a version stamp placeholder that the writer fills in', () => {
    expect(source).toContain("export const PAQAD_LAUNCHER_VERSION = '__PAQAD_VERSION__';");
  });
});
