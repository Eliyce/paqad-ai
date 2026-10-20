import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const OLD_PLUGIN_REPO = ['Eliyce', 'paqad-plugin'].join('/');
const HISTORY = ['CHANGELOG.md', '.changeset/', '.paqad/decisions/'];

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter((file) => file.length > 0)
    .filter((file) => !HISTORY.some((prefix) => file === prefix || file.startsWith(prefix)));
}

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

describe('the plugin repository name', () => {
  it('names only Eliyce/paqad-claude-plugin outside the release history', () => {
    const offenders = trackedFiles().filter((file) => readText(file).includes(OLD_PLUGIN_REPO));
    expect(offenders).toEqual([]);
  });

  it('keeps no marketplace file in this repository', () => {
    expect(trackedFiles()).not.toContain('.claude-plugin/marketplace.json');
  });
});
