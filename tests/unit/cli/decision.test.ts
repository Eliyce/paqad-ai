import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDecisionCommand } from '@/cli/commands/decision.js';
import { sha256Hex } from '@/compliance/markdown.js';
import { createPendingDecision, resolvePendingDecision } from '@/decisions/authoring.js';
import { DecisionStore } from '@/planning/decision-store.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { pendingStorePacket } from '../../shared/store-packet.js';

describe('paqad-ai decision command', () => {
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

  async function openQuestion(
    title: string,
    category = 'finding.triage',
    ...extra: string[]
  ): Promise<{ out: string; err: string; output: Record<string, unknown> }> {
    const { out, err } = await run(
      'create',
      '--category',
      category,
      '--title',
      title,
      '--context',
      'Why this came up',
      '--option',
      'a=Fix A',
      '--option',
      'b=Fix B',
      '--option',
      'c=Fix C',
      ...extra,
    );
    const text = out.join('\n');
    return { out: text, err: err.join('\n'), output: JSON.parse(text || '{}') };
  }

  async function answered(title: string, why = 'The reason then'): Promise<string> {
    vi.restoreAllMocks();
    const { output } = await openQuestion(title, 'ux-pattern');
    const id = output.id as string;
    vi.restoreAllMocks();
    await run('resolve', id, 'b', why);
    vi.restoreAllMocks();
    return id;
  }

  function pendingBytes(id: string): string {
    return readFileSync(join(root, '.paqad/decisions/pending', `${id}.json`), 'utf8');
  }

  describe('earlier check on open', () => {
    it('AC-4 prints exactly id and path with no match, and the packet has no check', async () => {
      await answered('Which colour should the banner use');
      const { output } = await openQuestion('Where should nightly reports be stored');
      expect(Object.keys(output).sort()).toEqual(['id', 'path']);
      expect(JSON.parse(pendingBytes(output.id as string))).not.toHaveProperty('earlier_check');
    });

    it('AC-5 prints a candidate from another category with its reason and the shipped method', async () => {
      const earlier = await answered('Which colour should the banner use', 'Matches the brand');
      const { output } = await openQuestion('Which colour should banner use');
      const id = output.id as string;
      const check = output.earlier_check as {
        required: boolean;
        candidates: Record<string, unknown>[];
        method: string;
        next: string;
      };
      expect(existsSync(join(root, '.paqad/decisions/pending', `${id}.json`))).toBe(true);
      expect(check.required).toBe(true);
      expect(check.candidates).toHaveLength(1);
      expect(check.candidates[0]).toMatchObject({
        id: earlier,
        category: 'ux-pattern',
        context: 'Why this came up',
        chosen: 'b',
        chosen_label: 'Fix B',
        why: 'Matches the brand',
      });
      expect(check.candidates[0]).not.toHaveProperty('score');
      expect(check.method).toContain('Treat shared wording as no evidence');
      expect(check.next).toContain(`paqad-ai decision suggest ${id} --earlier`);
      expect(JSON.parse(pendingBytes(id)).earlier_check).toEqual({
        status: 'required',
        candidates: [earlier],
      });
    });

    it('AC-6 refuses resolve while the check is required and leaves the packet pending', async () => {
      await answered('Which colour should the banner use');
      const { output } = await openQuestion('Which colour should banner use');
      const id = output.id as string;
      const before = pendingBytes(id);
      vi.restoreAllMocks();
      const { err } = await run('resolve', id, 'a');
      expect(err.join('\n')).toBe(
        `This question has earlier answers to check first. Run paqad-ai decision check ${id}.`,
      );
      expect(process.exitCode).toBe(1);
      expect(pendingBytes(id)).toBe(before);
    });

    it('AC-38 refuses --other before the write-in reaches the pending file', async () => {
      await answered('Which colour should the banner use');
      const { output } = await openQuestion('Which colour should banner use');
      const id = output.id as string;
      const before = pendingBytes(id);
      vi.restoreAllMocks();
      const { err } = await run('resolve', id, 'x', '--other', 'A new shade');
      expect(err.join('\n')).toContain('earlier answers to check first');
      expect(pendingBytes(id)).toBe(before);
    });

    it('AC-19 refuses a required store-format packet with the file byte-identical', async () => {
      await answered('Which colour should the banner use');
      const id = 'D-01J000000000000000000000A9';
      new DecisionStore(root).writePending(
        pendingStorePacket({ decision_id: id, question: 'Which colour should banner use' }),
      );
      const before = pendingBytes(id);
      expect(JSON.parse(before).earlier_check.status).toBe('required');
      const { err } = await run('resolve', id, 'a');
      expect(err.join('\n')).toContain(`Run paqad-ai decision check ${id}.`);
      expect(pendingBytes(id)).toBe(before);
    });
  });

  describe('AC-24 decision check', () => {
    it('exits 1 naming the id for an unknown id and for a malformed one', async () => {
      const unknown = 'D-01J000000000000000000000B1';
      const { err } = await run('check', unknown);
      expect(err.join('\n')).toBe(`Decision ${unknown} was not found.`);
      expect(process.exitCode).toBe(1);
      vi.restoreAllMocks();
      process.exitCode = undefined;
      const malformed = await run('check', '../../etc/passwd');
      expect(malformed.err.join('\n')).toContain('was not found');
      expect(process.exitCode).toBe(1);
    });

    it('exits 1 naming the id for a resolved packet', async () => {
      const id = await answered('Which colour should the banner use');
      const { err } = await run('check', id);
      expect(err.join('\n')).toBe(`Decision ${id} is already resolved.`);
      expect(process.exitCode).toBe(1);
    });

    it('exits 0 with required false and the plain block for a packet with no check', async () => {
      const { output } = await openQuestion('Where should nightly reports be stored');
      const id = output.id as string;
      vi.restoreAllMocks();
      const { out } = await run('check', id);
      const printed = JSON.parse(out.join('\n'));
      expect(process.exitCode).not.toBe(1);
      expect(printed.earlier_check).toEqual({ required: false });
      expect(printed.question.options.map((entry: { label: string }) => entry.label)).toEqual([
        'Fix A',
        'Fix B',
        'Fix C',
      ]);
      expect(printed.question.options[0].resolve).toBe(`paqad-ai decision resolve ${id} a`);
    });

    it('prints the check and no question while required, for a store-format packet too', async () => {
      await answered('Which colour should the banner use');
      const { output } = await openQuestion('Which colour should banner use');
      vi.restoreAllMocks();
      const { out } = await run('check', output.id as string);
      const printed = JSON.parse(out.join('\n'));
      expect(printed.earlier_check.required).toBe(true);
      expect(printed).not.toHaveProperty('question');
    });

    it('names a candidate whose file has gone under missing and drops it from the list', async () => {
      const earlier = await answered('Which colour should the banner use');
      const { output } = await openQuestion('Which colour should banner use');
      rmSync(join(root, '.paqad/decisions/resolved', `${earlier}.json`));
      vi.restoreAllMocks();
      const { out } = await run('check', output.id as string);
      const printed = JSON.parse(out.join('\n'));
      expect(printed.earlier_check.candidates).toEqual([]);
      expect(printed.earlier_check.missing).toEqual([earlier]);
    });

    it('names a candidate whose file no longer holds an answer under missing', async () => {
      const earlier = await answered('Which colour should the banner use');
      const { output } = await openQuestion('Which colour should banner use');
      const path = join(root, '.paqad/decisions/resolved', `${earlier}.json`);
      writeFileSync(path, '{ "status": "resolved" }');
      vi.restoreAllMocks();
      const { out } = await run('check', output.id as string);
      expect(JSON.parse(out.join('\n')).earlier_check.missing).toEqual([earlier]);
    });
  });

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

  describe('decisions.json index', () => {
    const SES = 'ses_decision_index';
    const ULID = '01JABCDEFGHJKMNPQRSTVWXYZ0';

    it('links every decision resolved while the change is active, copying no packet body', async () => {
      const dir = openFeatureChange(root, SES, {
        adapter: 'claude-code',
        title: 'index',
        issue: '581',
        ulid: ULID,
      });
      const { out } = await run(
        'create',
        '--category',
        'architecture-path',
        '--title',
        'Where the trace lives',
        '--context',
        'pick one',
        '--option',
        'map=A trace map',
        '--option',
        'field=A field',
        '--session',
        SES,
      );
      const id = (JSON.parse(out.join('\n')) as { id: string }).id;
      const pending = JSON.parse(
        readFileSync(join(root, '.paqad/decisions/pending', `${id}.json`), 'utf8'),
      ) as { change?: string };
      expect(pending.change).toBe(ULID);
      const delivery = createPendingDecision(root, {
        category: 'delivery.open_pr',
        title: 'Open a pull request for this change?',
        context: 'Delivery is ready.',
        options: [
          { option_key: 'yes', label: 'Open a PR now' },
          { option_key: 'no', label: 'Commit only' },
        ],
      }).id;
      const waiver = createPendingDecision(root, {
        category: 'workflow-or-tool',
        title: 'Visual evidence waiver',
        context: `no browser here [paqad-ve-readiness ${dir}]`,
        options: [
          { option_key: 'waive', label: 'Waive visual evidence' },
          { option_key: 'attach', label: 'Attach screenshots' },
        ],
      }).id;

      await run('resolve', id, 'map', 'no', 'reader', 'churn', '--session', SES);
      await run('resolve', delivery, 'yes', '--session', SES);
      await run('resolve', waiver, 'waive', '--session', SES);
      expect(process.exitCode).not.toBe(1);

      const resolvedDelivery = JSON.parse(
        readFileSync(join(root, '.paqad/decisions/resolved', `${delivery}.json`), 'utf8'),
      ) as { change?: string };
      expect(resolvedDelivery.change).toBe(ULID);

      const indexText = readFileSync(join(root, featureFilePath(dir, 'decisions')), 'utf8');
      const index = JSON.parse(indexText) as {
        decisions: { id: string; category: string; path: string; content_hash: string }[];
      };
      expect(index.decisions.map((entry) => entry.id).sort()).toEqual(
        [id, delivery, waiver].sort(),
      );
      for (const entry of index.decisions) {
        const tracked = readFileSync(join(root, entry.path), 'utf8');
        expect(entry.content_hash).toBe(sha256Hex(tracked));
      }
      expect(indexText).not.toContain('reader churn');
    });

    it('names no change and writes no index when no change is active', async () => {
      const id = await createOne();
      const pending = JSON.parse(
        readFileSync(join(root, '.paqad/decisions/pending', `${id}.json`), 'utf8'),
      ) as Record<string, unknown>;
      expect('change' in pending).toBe(false);
      await run('resolve', id, 'a');
      expect(existsSync(join(root, '.paqad/ledger/feature-evidence'))).toBe(false);
    });

    it('keeps the change a packet already names when another change resolves it', () => {
      const { id } = createPendingDecision(root, {
        category: 'ux-pattern',
        title: 't',
        context: 'c',
        options: [
          { option_key: 'a', label: 'A' },
          { option_key: 'b', label: 'B' },
        ],
        change: '01JZZZZZZZZZZZZZZZZZZZZZZZ',
      });
      const { packet } = resolvePendingDecision(root, id, 'a', '', { change: ULID });
      expect(packet.change).toBe('01JZZZZZZZZZZZZZZZZZZZZZZZ');
    });
  });
});
