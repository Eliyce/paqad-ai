import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAnalyticsCommand } from '@/cli/commands/analytics.js';
import { foldAnalyticsTagSession } from '@/analytics-tag/fold.js';
import { ANALYTICS_MAP_PATH } from '@/analytics-tag/registry.js';

async function run(root: string, args: string[]): Promise<string> {
  const out: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  try {
    await createAnalyticsCommand().parseAsync(
      ['node', 'analytics', ...args, '--project-root', root],
      {
        from: 'node',
      },
    );
  } finally {
    spy.mockRestore();
  }
  return out.join('');
}

describe('analytics CLI', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-acli-'));
    process.exitCode = 0;
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it('record → show round-trips a tag through the script-only ledger', async () => {
    await run(root, [
      'record',
      'checkout_completed',
      '--session',
      'ses_c',
      '--provider',
      'ga4',
      '--source',
      'src/x.ts',
    ]);
    expect(foldAnalyticsTagSession(root, 'ses_c').totals.tag_added_count).toBe(1);
    const summary = await run(root, ['show', '--session', 'ses_c']);
    expect(summary).toContain('checkout_completed');
    expect(summary).toContain('▸ paqad');
    const json = await run(root, ['show', '--session', 'ses_c', '--format', 'json']);
    expect(JSON.parse(json).totals.tag_added_count).toBe(1);
  });

  it('rejects an invalid --format', async () => {
    await run(root, ['show', '--session', 'ses_c', '--format', 'xml']);
    expect(process.exitCode).toBe(2);
  });

  it('show renders unknown provider/path and empty provider list', async () => {
    // A tag recorded with no provider / no source exercises the ?? "unknown" and
    // "|| none" summary branches.
    await run(root, ['record', 'bare_event', '--session', 'ses_bare']);
    const summary = await run(root, ['show', '--session', 'ses_bare']);
    expect(summary).toContain('bare_event (unknown) → unknown');
    expect(summary).toContain('providers: none');
  });

  it('map reconciles the registry from the ledger', async () => {
    await run(root, ['record', 'signup_started', '--session', 'ses_m', '--provider', 'segment']);
    const out = await run(root, ['map']);
    expect(out).toContain('reconciled');
    expect(readFileSync(join(root, ANALYTICS_MAP_PATH), 'utf8')).toContain('signup_started');
    const json = await run(root, ['map', '--format', 'json']);
    expect(JSON.parse(json).tags).toBe(1);
  });
});
