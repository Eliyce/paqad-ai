import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createModuleDecisionsCommand } from '@/cli/commands/module-decisions.js';
import type { ModuleDecision } from '@/module-decisions/schema.js';
import { writeDecision } from '@/module-decisions/store.js';

function decision(over: Partial<ModuleDecision> = {}): ModuleDecision {
  return {
    id: 'MD-0001',
    state: 'proposed',
    proposed_slug: 'payments',
    proposed_name: 'Payments',
    proposed_layer: null,
    proposed_features: [],
    source_of_decision: {
      type: 'pasted-ticket',
      prompt_excerpt: 'add a payments adapter',
      detected_at: '2026-05-28T00:00:00.000Z',
    },
    confidence: 'medium',
    reasoning: 'Prompt names a module that is not on the map.',
    disposition: { collision_with: null, alternatives_offered: [] },
    created_at: '2026-05-28T00:00:00.000Z',
    updated_at: '2026-05-28T00:00:00.000Z',
    expires_at: '2099-12-31T00:00:00.000Z',
    approved_by: null,
    applied_to_map_at: null,
    applied_to_map_commit: null,
    events_log_ref: null,
    ...over,
  };
}

describe('module-decisions command', () => {
  let root: string;
  let out: string[];
  let err: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-md-cli-'));
    out = [];
    err = [];
    process.exitCode = 0;
    vi.spyOn(console, 'log').mockImplementation((line?: unknown) => void out.push(String(line)));
    vi.spyOn(console, 'error').mockImplementation((line?: unknown) => void err.push(String(line)));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
    rmSync(root, { recursive: true, force: true });
  });

  async function run(args: string[]): Promise<void> {
    await createModuleDecisionsCommand().parseAsync([...args, '--project-root', root], {
      from: 'user',
    });
  }

  it('lists nothing, then decisions as lines, as JSON and filtered by state', async () => {
    await run(['list']);
    expect(out).toEqual(['No module decisions.']);

    writeDecision(root, decision());
    writeDecision(root, decision({ id: 'MD-0002', state: 'accepted', proposed_slug: 'ledger' }));
    out = [];
    await run(['list']);
    expect(out).toEqual([
      'MD-0001  [proposed]  payments  →  Payments  (confidence: medium)',
      'MD-0002  [accepted]  ledger  →  Payments  (confidence: medium)',
    ]);

    out = [];
    await run(['list', '--state', 'accepted', '--json']);
    expect((JSON.parse(out[0]!) as ModuleDecision[]).map((d) => d.id)).toEqual(['MD-0002']);
  });

  it('shows a decision and reports one that does not exist', async () => {
    writeDecision(root, decision());
    await run(['show', 'MD-0001']);
    expect(JSON.parse(out[0]!)).toMatchObject({ id: 'MD-0001' });

    await run(['show', 'MD-9999']);
    expect(err).toEqual(['Decision MD-9999 not found.']);
    expect(process.exitCode).toBe(1);
  });

  it('expires past-due proposals and says when there is nothing to expire', async () => {
    await run(['expire-stale']);
    expect(out).toEqual(['No decisions to expire.']);

    writeDecision(root, decision({ expires_at: '2000-01-01T00:00:00.000Z' }));
    out = [];
    await run(['expire-stale']);
    expect(out).toEqual(['Expired 1 decision(s):', '  MD-0001']);

    out = [];
    await run(['expire-stale', '--json']);
    expect(JSON.parse(out[0]!)).toEqual({ expired: [] });
  });

  it('extracts candidates from a prompt or a prompt file and needs one of them', async () => {
    await run(['extract', '--prompt', 'add a payments adapter']);
    expect(JSON.parse(out[0]!)).toMatchObject({
      prompt_length: 22,
      existing_slugs: [],
    });

    const file = join(root, 'prompt.txt');
    writeFileSync(file, 'build the ledger');
    out = [];
    await run(['extract', '--prompt-file', file]);
    expect(JSON.parse(out[0]!)).toMatchObject({ prompt_length: 16 });

    await expect(run(['extract'])).rejects.toThrow(
      'Must provide --prompt <text> or --prompt-file <path>',
    );
  });

  it('infers an attribution for a prompt', async () => {
    await run(['infer', '--prompt', 'add a payments adapter', '--max-choices', '2']);
    expect(JSON.parse(out[0]!)).toBeTypeOf('object');
  });
});
