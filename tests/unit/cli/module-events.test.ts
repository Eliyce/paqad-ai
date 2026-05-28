import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createModuleEventsCommand } from '@/cli/commands/module-events.js';
import { appendModuleMapEvent } from '@/module-decisions/events.js';

describe('module-events command', () => {
  let root: string;
  let stdout: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-me-cli-'));
    stdout = [];
    vi.spyOn(console, 'log').mockImplementation((m) => {
      stdout.push(String(m));
    });
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('list emits "No events." when the log is absent', async () => {
    await createModuleEventsCommand().parseAsync(
      ['node', 'module-events', 'list', '--project-root', root],
      { from: 'node' },
    );
    expect(stdout).toEqual(['No events.']);
  });

  it('list --limit N --json returns only the most recent N entries as JSON', async () => {
    appendModuleMapEvent(root, { ts: '2026-05-20T00:00:00Z', type: 'module.declared', slug: 'a' });
    appendModuleMapEvent(root, { ts: '2026-05-21T00:00:00Z', type: 'module.reconciled' });
    appendModuleMapEvent(root, { ts: '2026-05-22T00:00:00Z', type: 'module.health.rolled-up' });

    await createModuleEventsCommand().parseAsync(
      ['node', 'module-events', 'list', '--project-root', root, '--limit', '2', '--json'],
      { from: 'node' },
    );
    const parsed = JSON.parse(stdout[0] ?? '[]');
    expect(parsed).toHaveLength(2);
    expect(parsed[0].type).toBe('module.reconciled');
    expect(parsed[1].type).toBe('module.health.rolled-up');
  });

  it('since filters by ISO timestamp', async () => {
    appendModuleMapEvent(root, { ts: '2026-05-20T00:00:00Z', type: 'module.declared', slug: 'a' });
    appendModuleMapEvent(root, { ts: '2026-05-25T00:00:00Z', type: 'module.reconciled' });

    await createModuleEventsCommand().parseAsync(
      ['node', 'module-events', 'since', '2026-05-22T00:00:00Z', '--project-root', root, '--json'],
      { from: 'node' },
    );
    const parsed = JSON.parse(stdout[0] ?? '[]');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].type).toBe('module.reconciled');
  });

  it('since rejects malformed ISO timestamps with exit code 2', async () => {
    const stderr: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((m) => {
      stderr.push(String(m));
      return true;
    });
    await createModuleEventsCommand().parseAsync(
      ['node', 'module-events', 'since', 'not-a-date', '--project-root', root],
      { from: 'node' },
    );
    expect(process.exitCode).toBe(2);
    expect(stderr.join('')).toMatch(/invalid ISO timestamp/);
  });

  it('for-module filters by slug', async () => {
    appendModuleMapEvent(root, { ts: '2026-05-20T00:00:00Z', type: 'module.declared', slug: 'a' });
    appendModuleMapEvent(root, { ts: '2026-05-21T00:00:00Z', type: 'module.declared', slug: 'b' });

    await createModuleEventsCommand().parseAsync(
      ['node', 'module-events', 'for-module', 'a', '--project-root', root, '--json'],
      { from: 'node' },
    );
    const parsed = JSON.parse(stdout[0] ?? '[]');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].slug).toBe('a');
  });
});
