import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDecisionCommand } from '@/cli/commands/decision.js';

describe('paqad-ai decision command (#326)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-cli-decision-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  async function run(...args: string[]): Promise<{ out: string[]; err: string[] }> {
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => void out.push(String(line)));
    vi.spyOn(console, 'error').mockImplementation((line: string) => void err.push(String(line)));
    await createDecisionCommand().parseAsync([...args, '--project-root', root], { from: 'user' });
    return { out, err };
  }

  async function createOne(category = 'finding.triage'): Promise<string> {
    const { out } = await run(
      'create',
      '--category',
      category,
      '--title',
      'How to triage',
      '--context',
      'Two candidate fixes',
      '--option',
      'a=Fix A',
      '--option',
      'b=Fix B',
    );
    return (JSON.parse(out.join('\n')) as { id: string }).id;
  }

  it('creates a packet with a minted D-<ULID> id in an onboarded project', async () => {
    const id = await createOne();
    expect(id).toMatch(/^D-[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(existsSync(join(root, '.paqad/decisions/pending', `${id}.json`))).toBe(true);
    expect(process.exitCode).not.toBe(1);
  });

  it('rejects an unknown category with a nearest-match suggestion', async () => {
    const { err } = await run(
      'create',
      '--category',
      'finding.triage-typo',
      '--title',
      't',
      '--context',
      'c',
      '--option',
      'a=A',
      '--option',
      'b=B',
    );
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toContain('Did you mean "finding.triage"');
  });

  it('resolves a pending packet, moving it to resolved/', async () => {
    const id = await createOne();
    const { out } = await run('resolve', id, 'a', 'went with A');
    expect(out.join('\n')).toContain('resolved');
    expect(existsSync(join(root, '.paqad/decisions/pending', `${id}.json`))).toBe(false);
    const resolved = JSON.parse(
      readFileSync(join(root, '.paqad/decisions/resolved', `${id}.json`), 'utf8'),
    ) as { status: string; chosen: string; rationale: string };
    expect(resolved.status).toBe('resolved');
    expect(resolved.chosen).toBe('a');
    expect(resolved.rationale).toBe('went with A');
  });

  it('resolves to a minted write-in option via --other', async () => {
    const id = await createOne();
    await run('resolve', id, 'unused', '--other', 'A third way');
    const resolved = JSON.parse(
      readFileSync(join(root, '.paqad/decisions/resolved', `${id}.json`), 'utf8'),
    ) as { chosen: string; options: { option_key: string; label: string }[] };
    expect(resolved.chosen).toBe('other');
    expect(
      resolved.options.some((o) => o.option_key === 'other' && o.label === 'A third way'),
    ).toBe(true);
  });

  it('lists pending and resolved packets', async () => {
    const pending = await createOne('spec.change');
    const toResolve = await createOne('fix.proof_method');
    await run('resolve', toResolve, 'a');

    const { out } = await run('list', '--json');
    const rows = JSON.parse(out.join('\n')) as { id: string; status: string }[];
    expect(rows.find((r) => r.id === pending)?.status).toBe('pending');
    expect(rows.find((r) => r.id === toResolve)?.status).toBe('resolved');

    const { out: human } = await run('list');
    expect(human.join('\n')).toContain(pending);
  });

  it('reports an empty store cleanly', async () => {
    const { out } = await run('list');
    expect(out.join('\n')).toContain('No decision packets found.');
  });

  it('surfaces an engine validation error (fewer than 2 options) as exit 1', async () => {
    const { err } = await run(
      'create',
      '--category',
      'finding.triage',
      '--title',
      't',
      '--context',
      'c',
      '--option',
      'a=only one',
    );
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toContain('at least 2 options');
  });

  it('honors --recommendation on create', async () => {
    const { out } = await run(
      'create',
      '--category',
      'finding.triage',
      '--title',
      't',
      '--context',
      'c',
      '--option',
      'a=A',
      '--option',
      'b=B',
      '--recommendation',
      'b',
    );
    const { id } = JSON.parse(out.join('\n')) as { id: string };
    const packet = JSON.parse(
      readFileSync(join(root, '.paqad/decisions/pending', `${id}.json`), 'utf8'),
    ) as { recommendation: string };
    expect(packet.recommendation).toBe('b');
  });
});
