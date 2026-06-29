import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Import the dist-less runtime primitive directly (it is a plain ESM export).
import { readFlooredMode } from '../../../runtime/hooks/lib/paqad-disabled.mjs';

const ORDER = ['off', 'warn', 'strict'];

describe('readFlooredMode — .mjs C2 clamp parity with TS resolveFlooredMode', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-floored-mjs-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const team = (body: string) => {
    mkdirSync(join(root, '.paqad/configs'), { recursive: true });
    writeFileSync(join(root, '.paqad/configs/.config.policy'), body);
  };
  const local = (body: string) => writeFileSync(join(root, '.paqad/.config'), body);
  const resolveMode = (env: NodeJS.ProcessEnv = {}) =>
    readFlooredMode(root, 'rule_compliance', 'PAQAD_RULE_COMPLIANCE', ORDER, 'warn', env);

  it('defaults to the floor when nothing is set', () => {
    expect(resolveMode()).toBe('warn');
  });

  it('the team value sets the floor and can lower it', () => {
    team('rule_compliance=off\n');
    expect(resolveMode()).toBe('off');
  });

  it('local cannot lower below the team/default floor', () => {
    local('rule_compliance=off\n');
    expect(resolveMode()).toBe('warn'); // no team floor → default warn floor holds

    team('rule_compliance=warn\n');
    expect(resolveMode()).toBe('warn'); // local off ignored
  });

  it('local and env may RAISE above the floor', () => {
    team('rule_compliance=off\n');
    local('rule_compliance=strict\n');
    expect(resolveMode()).toBe('strict');
  });

  it('env cannot lower below the floor', () => {
    team('rule_compliance=strict\n');
    expect(resolveMode({ PAQAD_RULE_COMPLIANCE: 'off' })).toBe('strict');
  });
});
