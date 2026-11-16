import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  allowListEntries,
  writeAllowList,
} from '../../../../src/onboarding/journey/permissions.js';

import { tempRoot, writeFile } from './fixtures/journey.js';

const INSTALL = '/opt/paqad-ai';

describe('onboarding allow list', () => {
  let root: string;

  beforeEach(() => {
    root = tempRoot();
    execFileSync('git', ['init', '-q'], { cwd: root });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function settings(): { permissions: Record<string, string[]>; model?: string } {
    return JSON.parse(readFileSync(join(root, '.claude/settings.local.json'), 'utf8'));
  }

  it('FR-6: merges without dropping or widening the person’s own entries', () => {
    writeFile(
      root,
      '.claude/settings.local.json',
      JSON.stringify({
        model: 'opus',
        permissions: { allow: ['Bash(ls:*)'], deny: ['Read(.env)'] },
      }),
    );
    const result = writeAllowList(root, INSTALL);
    expect(settings().model).toBe('opus');
    expect(settings().permissions.allow?.[0]).toBe('Bash(ls:*)');
    expect(settings().permissions.deny).toContain('Read(.env)');
    expect(result.added.allow).not.toContain('Bash(ls:*)');
    expect(writeAllowList(root, INSTALL).added.allow).toEqual([]);
  });

  it('FR-6: adds the ignore line when the file is not git-ignored, and not twice', () => {
    expect(writeAllowList(root, INSTALL).ignore_line_added).toBe(true);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('.claude/settings.local.json');
    expect(writeAllowList(root, INSTALL).ignore_line_added).toBe(false);
  });

  it('INV-4 FR-24: denies paqad controls, asks for the commit verb and never allows commit', () => {
    const entries = allowListEntries(INSTALL);
    for (const path of [
      '.paqad/.config',
      '.paqad/configs/**',
      '.paqad/decisions/**',
      '.paqad/scripts/rules/**',
      '.paqad/onboarding/journey.json',
      '.paqad/onboarding/events.jsonl',
      '.paqad/onboarding/view.json',
    ]) {
      expect(entries.deny).toContain(`Write(${path})`);
      expect(entries.deny).toContain(`Edit(${path})`);
    }
    expect(entries.ask).toContain('Bash(paqad-ai onboarding commit:*)');
  });

  it('INV-5: the skill-script entry names the absolute install dir outside docs/ and .paqad/', () => {
    const scripts = allowListEntries(INSTALL).allow.filter((entry) =>
      entry.startsWith('Bash(node '),
    );
    expect(scripts).toEqual([`Bash(node ${INSTALL}/runtime/base/skills/*)`]);
    expect(scripts[0]).not.toContain(':*');
  });

  it('INV-5: a Windows install dir keeps its drive letter and uses forward slashes', () => {
    const scripts = allowListEntries('C:\\Users\\dev\\paqad-ai').allow.filter((entry) =>
      entry.startsWith('Bash(node '),
    );
    expect(scripts).toEqual(['Bash(node C:/Users/dev/paqad-ai/runtime/base/skills/*)']);
  });
});
