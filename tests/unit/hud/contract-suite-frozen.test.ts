import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const CONTRACT = 'tests/e2e/stage-enforcement-contract.e2e.test.ts';
const FROZEN_SHA256 = '74709c6aa1645dd4c03da70e5f544edc0422441039e5d09d4af10a42e774f73b';

const read = (): string => readFileSync(join(process.cwd(), CONTRACT), 'utf8');

describe('stage enforcement contract suite stays frozen', () => {
  it('AC-38: the contract e2e suite is byte for byte the frozen version', () => {
    const digest = createHash('sha256')
      .update(readFileSync(join(process.cwd(), CONTRACT)))
      .digest('hex');
    expect(digest).toBe(FROZEN_SHA256);
  });

  it('AC-38: the contract e2e suite still runs on both the npm and the plugin route', () => {
    const suite = read();
    expect(suite).toContain("name: 'npm' | 'plugin'");
    expect(suite).toMatch(/\{\s*name:\s*'npm',\s*env:/);
    expect(suite).toMatch(/\{\s*name:\s*'plugin',\s*env:/);
    expect(suite).toContain('CLAUDE_PLUGIN_ROOT: REPO');
  });
});
