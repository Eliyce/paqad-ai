import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startPaqadWatcher } from '@/graph/watcher';

describe('startPaqadWatcher', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-watcher-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns a no-op when .paqad/ is missing', () => {
    rmSync(join(root, '.paqad'), { recursive: true });
    const w = startPaqadWatcher({ projectRoot: root, onChange: () => undefined });
    expect(typeof w.close).toBe('function');
    w.close();
  });

  it('debounces rapid changes into a single onChange', async () => {
    let calls = 0;
    const w = startPaqadWatcher({
      projectRoot: root,
      debounceMs: 80,
      onChange: () => {
        calls += 1;
      },
    });
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(root, '.paqad', `a${i}.txt`), String(i));
      await new Promise((r) => setTimeout(r, 5));
    }
    await new Promise((r) => setTimeout(r, 300));
    w.close();
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(calls).toBeLessThanOrEqual(2);
  });
});
