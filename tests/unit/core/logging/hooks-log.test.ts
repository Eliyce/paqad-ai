import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { appendHooksLog, hooksLogPath } from '@/core/logging/hooks-log.js';

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-hooks-log-'));
  roots.push(root);
  return root;
}

describe('appendHooksLog', () => {
  it('appends one timestamped line per call to .paqad/logs/hooks.log', () => {
    const root = tempRoot();
    appendHooksLog(root, 'cost: first');
    appendHooksLog(root, 'cost: second');
    expect(hooksLogPath(root)).toBe(join(root, '.paqad/logs/hooks.log'));
    const lines = readFileSync(hooksLogPath(root), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\S+Z cost: first$/);
  });

  it('never throws when the log cannot be written', () => {
    const root = tempRoot();
    writeFileSync(join(root, '.paqad'), 'not a directory');
    expect(() => appendHooksLog(root, 'lost')).not.toThrow();
  });
});
