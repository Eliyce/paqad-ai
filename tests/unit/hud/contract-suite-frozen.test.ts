import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CONTRACT, FROZEN_SHA256, contractDigest } from '../../helpers/stage-contract-frozen';

const read = (): string => readFileSync(join(process.cwd(), CONTRACT), 'utf8');

describe('stage enforcement contract suite stays frozen', () => {
  it('AC-38: the contract e2e suite is byte for byte the frozen version', () => {
    expect(contractDigest(process.cwd())).toBe(FROZEN_SHA256);
  });

  it('AC-33: any diff against origin/main on the contract e2e suite is the frozen version', (ctx) => {
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: process.cwd(), encoding: 'utf8', stdio: 'pipe' });
    try {
      git('rev-parse', '--verify', 'origin/main');
    } catch {
      ctx.skip();
    }
    if (git('diff', 'origin/main', '--', CONTRACT) === '') return;
    expect(contractDigest(process.cwd())).toBe(FROZEN_SHA256);
  });

  it('AC-38: the contract e2e suite still runs on both the npm and the plugin route', () => {
    const suite = read();
    expect(suite).toContain("name: 'npm' | 'plugin'");
    expect(suite).toMatch(/\{\s*name:\s*'npm',\s*env:/);
    expect(suite).toMatch(/\{\s*name:\s*'plugin',\s*env:/);
    expect(suite).toContain('CLAUDE_PLUGIN_ROOT: REPO');
  });
});
