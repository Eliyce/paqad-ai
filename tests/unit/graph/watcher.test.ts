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

  it('ignores append-only logs the report build itself writes', async () => {
    mkdirSync(join(root, '.paqad', 'logs'), { recursive: true });
    let calls = 0;
    const w = startPaqadWatcher({
      projectRoot: root,
      debounceMs: 40,
      onChange: () => {
        calls += 1;
      },
    });
    writeFileSync(join(root, '.paqad', 'audit.log'), 'entry one\n');
    writeFileSync(join(root, '.paqad', 'logs', 'auto-update.log'), 'tick\n');
    await new Promise((r) => setTimeout(r, 200));
    expect(calls).toBe(0);

    writeFileSync(join(root, '.paqad', 'project-profile.yaml'), 'project: {}\n');
    await new Promise((r) => setTimeout(r, 200));
    w.close();
    expect(calls).toBeGreaterThanOrEqual(1);
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
