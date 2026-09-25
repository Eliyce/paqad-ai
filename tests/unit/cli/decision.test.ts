import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDecisionCommand } from '@/cli/commands/decision.js';
import { sha256Hex } from '@/compliance/markdown.js';
import { createPendingDecision, resolvePendingDecision } from '@/decisions/authoring.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';

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

  // Issue #581 (FR-11, AC-15) — while a change is active, packets name it and resolving one
  // rewrites the change's decisions.json index. Waivers and delivery decisions included.
  describe('decisions.json index (#581)', () => {
    const SES = 'ses_decision_index';
    const ULID = '01JABCDEFGHJKMNPQRSTVWXYZ0';

    it('links every decision resolved while the change is active, copying no packet body', async () => {
      const dir = openFeatureChange(root, SES, {
        adapter: 'claude-code',
        title: 'index',
        issue: '581',
        ulid: ULID,
      });
      // An agent-opened decision names the active change.
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
      // A delivery decision minted without a change, and a visual-evidence waiver.
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
