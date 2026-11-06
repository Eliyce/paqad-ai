import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDecisionCommand } from '@/cli/commands/decision.js';
import { sha256Hex } from '@/compliance/markdown.js';
import { DECISION_REUSE_DOC_TYPE } from '@/decision-reuse/index.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { readSessionDoc } from '@/session-ledger/ledger.js';
import { createPendingDecision, resolvePendingDecision } from '@/decisions/authoring.js';
import { DecisionStore } from '@/planning/decision-store.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { pendingStorePacket, storeOptions } from '../../shared/store-packet.js';

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

  describe('AC-56 the store-shape question block', () => {
    const STORE_ID = 'D-01J000000000000000000000C1';

    async function storeChecked(keys: string[]): Promise<string> {
      await answered('Which colour should the banner use');
      vi.restoreAllMocks();
      new DecisionStore(root).writePending(
        pendingStorePacket({
          decision_id: STORE_ID,
          question: 'Which colour should banner use',
          options: storeOptions(keys),
        }),
      );
      return STORE_ID;
    }

    it('prints no other command, and a fifth option under not_shown with its command', async () => {
      const id = await storeChecked(['a', 'b', 'c', 'd', 'e']);
      const earlier = JSON.parse(pendingBytes(id)).earlier_check.candidates[0] as string;
      const { out } = await run(
        'suggest',
        id,
        '--earlier',
        earlier,
        '--option',
        'c',
        '--reason',
        'r',
      );
      const printed = JSON.parse(out.join('\n'));
      expect(printed.question).not.toHaveProperty('other');
      expect(printed.question.options).toHaveLength(4);
      expect(printed.question.options[0].option_key).toBe('c');
      expect(printed.question.not_shown).toEqual([
        {
          label: 'Use option e',
          option_key: 'e',
          resolve: `paqad-ai decision resolve ${id} e`,
        },
      ]);
      vi.restoreAllMocks();
      const check = JSON.parse((await run('check', id)).out.join('\n'));
      expect(check.question).toEqual(printed.question);
    });

    it('prints no not_shown when every option fits', async () => {
      const id = await storeChecked(['a', 'b', 'c', 'd']);
      const { out } = await run('suggest', id, '--none', '--reason', 'r');
      const printed = JSON.parse(out.join('\n'));
      expect(printed.question).not.toHaveProperty('other');
      expect(printed.question).not.toHaveProperty('not_shown');
      expect(
        printed.question.options.map((entry: { option_key: string }) => entry.option_key),
      ).toEqual(['a', 'b', 'c', 'd']);
    });

    it('refuses --other with the fixed message, no TypeError, and an identical file', async () => {
      const id = await storeChecked(['a', 'b']);
      await run('suggest', id, '--none', '--reason', 'r');
      vi.restoreAllMocks();
      const before = pendingBytes(id);
      const { err } = await run('resolve', id, 'x', '--other', 'text');
      expect(err.join('\n')).toContain(
        "This question takes only its listed options, so --other can't be used. Pick one of them.",
      );
      expect(err.join('\n')).not.toContain('TypeError');
      expect(process.exitCode).toBe(1);
      expect(pendingBytes(id)).toBe(before);
    });

    it('still refuses a required store-shape --other with the earlier-check message first', async () => {
      const id = await storeChecked(['a', 'b']);
      const before = pendingBytes(id);
      const { err } = await run('resolve', id, 'x', '--other', 'text');
      expect(err.join('\n')).toContain('earlier answers to check first');
      expect(pendingBytes(id)).toBe(before);
    });

    it('keeps other on a contract-shape packet', async () => {
      const { output } = await openQuestion('Where should nightly reports be stored');
      vi.restoreAllMocks();
      const check = JSON.parse((await run('check', output.id as string)).out.join('\n'));
      expect(check.question.other).toContain('--other');
    });
  });

  describe('decision suggest', () => {
    async function openChecked(): Promise<{ id: string; earlier: string }> {
      const earlier = await answered('Which colour should the banner use', 'Matches the brand');
      const { output } = await openQuestion('Which colour should banner use');
      vi.restoreAllMocks();
      return { id: output.id as string, earlier };
    }

    it('AC-8 AC-23 refuses bad input and leaves the file byte-identical', async () => {
      const { id, earlier } = await openChecked();
      const before = pendingBytes(id);
      const cases: [string[], string][] = [
        [
          ['--earlier', 'D-01J000000000000000000000B2', '--option', 'a', '--reason', 'r'],
          'not offered',
        ],
        [['--earlier', earlier, '--option', 'nope', '--reason', 'r'], 'not one of'],
        [['--earlier', earlier, '--option', 'a', '--reason', ''], 'non-empty --reason'],
        [['--earlier', earlier, '--option', 'a', '--reason', '   '], 'non-empty --reason'],
        [['--earlier', earlier, '--option', 'a'], 'non-empty --reason'],
        [['--earlier', earlier, '--reason', 'r'], 'needs --option'],
        [['--earlier', earlier, '--option', 'a', '--none', '--reason', 'r'], 'exactly one'],
        [['--option', 'a', '--reason', 'r'], 'exactly one'],
      ];
      for (const [args, message] of cases) {
        process.exitCode = undefined;
        vi.restoreAllMocks();
        const { err } = await run('suggest', id, ...args);
        expect(err.join('\n')).toContain(message);
        expect(process.exitCode).toBe(1);
        expect(pendingBytes(id)).toBe(before);
      }
    });

    it('AC-23 refuses an unknown id, a resolved id, no check and a check already done', async () => {
      const { id, earlier } = await openChecked();
      const unknown = await run(
        'suggest',
        'D-01J000000000000000000000B3',
        '--none',
        '--reason',
        'r',
      );
      expect(unknown.err.join('\n')).toContain('was not found');

      vi.restoreAllMocks();
      const resolved = await run('suggest', earlier, '--none', '--reason', 'r');
      expect(resolved.err.join('\n')).toContain('already resolved');

      vi.restoreAllMocks();
      const plain = (await openQuestion('Where should nightly reports be stored')).output
        .id as string;
      vi.restoreAllMocks();
      const noCheck = await run('suggest', plain, '--none', '--reason', 'r');
      expect(noCheck.err.join('\n')).toContain('no earlier answers');

      vi.restoreAllMocks();
      await run('suggest', id, '--none', '--reason', 'Different screen');
      const before = pendingBytes(id);
      vi.restoreAllMocks();
      const again = await run(
        'suggest',
        id,
        '--earlier',
        earlier,
        '--option',
        'a',
        '--reason',
        'r',
      );
      expect(again.err.join('\n')).toContain('already been checked');
      expect(pendingBytes(id)).toBe(before);
    });

    it('refuses a candidate whose file has gone', async () => {
      const { id, earlier } = await openChecked();
      rmSync(join(root, '.paqad/decisions/resolved', `${earlier}.json`));
      const { err } = await run(
        'suggest',
        id,
        '--earlier',
        earlier,
        '--option',
        'a',
        '--reason',
        'r',
      );
      expect(err.join('\n')).toContain('can no longer be read');
    });

    it('writes the suggestion, marks the check done and sets the recommendation with its reason', async () => {
      const { id, earlier } = await openChecked();
      const { out } = await run(
        'suggest',
        id,
        '--earlier',
        earlier,
        '--option',
        'b',
        '--reason',
        'Same brand rule applies',
      );
      const stored = JSON.parse(pendingBytes(id));
      expect(stored.earlier_check.status).toBe('done');
      expect(stored.suggestion).toMatchObject({
        earlier_id: earlier,
        option_key: 'b',
        reason: 'Same brand rule applies',
      });
      expect(stored.recommendation).toBe('b');
      expect(stored.recommendation_reason).toBe('Same brand rule applies');
      expect(JSON.parse(out.join('\n')).question).toBeDefined();
      vi.restoreAllMocks();
      const resolved = await run('resolve', id, 'b');
      const file = JSON.parse(readFileSync(JSON.parse(resolved.out.join('\n')).path, 'utf8'));
      expect(file.recommendation_reason).toBe('Same brand rule applies');
    });

    it('--none records why and sets no recommendation', async () => {
      const { id } = await openChecked();
      await run('suggest', id, '--none', '--reason', 'Different screen');
      const stored = JSON.parse(pendingBytes(id));
      expect(stored.earlier_check).toMatchObject({
        status: 'done',
        none_reason: 'Different screen',
      });
      expect(stored.recommendation ?? null).toBeNull();
      expect(stored).not.toHaveProperty('suggestion');
    });

    it('AC-46 an answer already held resolves after check and suggest with no second question', async () => {
      const { id, earlier } = await openChecked();
      const held = 'a';
      const refused = await run('resolve', id, held);
      expect(refused.err.join('\n')).toContain(`decision check ${id}`);
      process.exitCode = undefined;
      vi.restoreAllMocks();
      await run('suggest', id, '--earlier', earlier, '--option', 'b', '--reason', 'Same rule');
      vi.restoreAllMocks();
      const { out } = await run('resolve', id, held);
      expect(JSON.parse(out.join('\n')).chosen).toBe('a');
      expect(existsSync(join(root, '.paqad/decisions/resolved', `${id}.json`))).toBe(true);
    });
  });

  describe('one click and standing answers', () => {
    const TITLE = 'Which colour should banner use';

    async function suggested(): Promise<{ id: string; earlier: string }> {
      const earlier = await answered('Which colour should the banner use', 'Matches the brand');
      const { output } = await openQuestion(TITLE);
      const id = output.id as string;
      vi.restoreAllMocks();
      await run('suggest', id, '--earlier', earlier, '--option', 'b', '--reason', 'Same rule');
      vi.restoreAllMocks();
      return { id, earlier };
    }

    it('AC-9 AC-32 check lists the earlier answer first with its id and always last', async () => {
      const { id, earlier } = await suggested();
      const { out } = await run('check', id);
      const block = JSON.parse(out.join('\n')).question;
      expect(block.options.map((entry: { label: string }) => entry.label)).toEqual([
        `Same as last time: Fix B (from ${earlier})`,
        'Fix A',
        'Fix C',
        'Always use this answer for this kind of question',
      ]);
      expect(block.options[0].resolve).toBe(`paqad-ai decision resolve ${id} b`);
    });

    it('AC-31 AC-47 the always entry adds a rule, and the next open is skipped with the say line', async () => {
      const { id } = await suggested();
      const { out } = await run('resolve', id, 'b', '--always');
      const ruleId = JSON.parse(out.join('\n')).standing_answer as string;
      expect(ruleId).toMatch(/^R-/u);

      vi.restoreAllMocks();
      const { output } = await openQuestion(TITLE);
      expect(output).toMatchObject({
        reused: true,
        chosen: 'b',
        label: 'Fix B',
        match: 'standing',
      });
      expect(output.say).toBe(
        `I used your standing answer: Fix B (rule ${ruleId}), so I did not ask. Say "ask me anyway" to be asked this time (--ask-anyway), or "remove that rule" to stop it (paqad-ai decision standing remove ${ruleId}).`,
      );
      expect(
        existsSync(join(root, '.paqad/decisions/pending', `${output.id as string}.json`)),
      ).toBe(false);
    });

    it('AC-13 --ask-anyway opens a pending packet, and so does removing the rule', async () => {
      const { id } = await suggested();
      const { out } = await run('resolve', id, 'b', '--always');
      const ruleId = JSON.parse(out.join('\n')).standing_answer as string;

      vi.restoreAllMocks();
      const anyway = await openQuestion(TITLE, 'finding.triage', '--ask-anyway');
      expect(anyway.output).not.toHaveProperty('reused');

      vi.restoreAllMocks();
      const listed = await run('standing', 'list');
      expect(JSON.parse(listed.out.join('\n')).map((rule: { id: string }) => rule.id)).toEqual([
        ruleId,
      ]);

      vi.restoreAllMocks();
      const removed = await run('standing', 'remove', ruleId);
      expect(JSON.parse(removed.out.join('\n')).removed).toBe(ruleId);

      vi.restoreAllMocks();
      const after = await openQuestion(TITLE);
      expect(after.output).not.toHaveProperty('reused');
    });

    it('AC-10 a stage agent is refused on --always and standing remove, not on list', async () => {
      const { id } = await suggested();
      vi.stubEnv('SE_AGENT_ID', 'agent-1');
      try {
        const always = await run('resolve', id, 'b', '--always');
        expect(always.err.join('\n')).toContain('A stage agent cannot set');
        expect(existsSync(join(root, '.paqad/decisions/pending', `${id}.json`))).toBe(true);
        vi.restoreAllMocks();
        const remove = await run('standing', 'remove', 'R-1');
        expect(remove.err.join('\n')).toContain('A stage agent cannot remove');
        vi.restoreAllMocks();
        process.exitCode = undefined;
        const list = await run('standing', 'list');
        expect(list.out.join('\n')).toBe('[]');
        expect(process.exitCode).toBeUndefined();
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('AC-25 AC-48 refuses --always with --other, an unknown rule and a corrupt file on list', async () => {
      const { id } = await suggested();
      const before = pendingBytes(id);
      const other = await run('resolve', id, 'x', '--always', '--other', 'Shade');
      expect(other.err.join('\n')).toContain('--always cannot be used with --other');
      expect(pendingBytes(id)).toBe(before);

      vi.restoreAllMocks();
      const unknown = await run('standing', 'remove', 'R-unknown');
      expect(unknown.err.join('\n')).toContain('R-unknown');
      expect(process.exitCode).toBe(1);

      vi.restoreAllMocks();
      writeFileSync(join(root, '.paqad/decisions/standing-answers.json'), '{ bad');
      const list = await run('standing', 'list');
      expect(list.err.join('\n')).toContain('cannot be read');
    });

    it('lists a reused packet in the change decision index', async () => {
      const { id } = await suggested();
      await run('resolve', id, 'b', '--always');
      const dir = openFeatureChange(root, 'ses-standing', {
        adapter: 'claude-code',
        title: 'standing',
      });
      vi.restoreAllMocks();
      const { output } = await openQuestion(TITLE, 'finding.triage', '--session', 'ses-standing');
      const index = readFileSync(join(root, featureFilePath(dir, 'decisions')), 'utf8');
      expect(index).toContain(output.id as string);
    });
  });

  describe('evidence rows', () => {
    const TITLE = 'Which colour should banner use';

    function rows(): Record<string, unknown>[] {
      return readSessionDoc(root, DECISION_REUSE_DOC_TYPE, resolveSessionId(root)).filter(
        (row) => row.kind !== 'open',
      );
    }

    async function suggested(): Promise<{ id: string; earlier: string }> {
      const earlier = await answered('Which colour should the banner use', 'Matches the brand');
      const { output } = await openQuestion(TITLE);
      const id = output.id as string;
      vi.restoreAllMocks();
      await run('suggest', id, '--earlier', earlier, '--option', 'b', '--reason', 'Same rule');
      vi.restoreAllMocks();
      return { id, earlier };
    }

    it('AC-1 a decision resolved through the CLI leaves the index unchanged', async () => {
      new DecisionStore(root).initialize();
      const indexPath = join(root, '.paqad/decisions/index.json');
      const before = readFileSync(indexPath, 'utf8');
      await answered('Which colour should the banner use');
      expect(readFileSync(indexPath, 'utf8')).toBe(before);
    });

    it('AC-11 accepting the suggestion writes one accepted row with the earlier id and reason', async () => {
      const { id, earlier } = await suggested();
      await run('resolve', id, 'b');
      expect(rows()).toEqual([
        expect.objectContaining({
          kind: 'suggestion',
          match_kind: 'intent',
          decision_id: earlier,
          outcome: 'accepted',
          note: 'Same rule',
          for_decision: id,
        }),
      ]);
    });

    it('AC-11 picking another option writes changed', async () => {
      const { id } = await suggested();
      await run('resolve', id, 'a');
      expect(rows().map((row) => row.outcome)).toEqual(['changed']);
    });

    it('AC-11 a store-format suggestion answered through the CLI writes its row too', async () => {
      const earlier = await answered('Which colour should the banner use', 'Matches the brand');
      const id = 'D-01J000000000000000000000C1';
      new DecisionStore(root).writePending(
        pendingStorePacket({ decision_id: id, question: TITLE }),
      );
      await run('suggest', id, '--earlier', earlier, '--option', 'a', '--reason', 'Same rule');
      vi.restoreAllMocks();
      await run('resolve', id, 'a');
      expect(rows().map((row) => row.outcome)).toEqual(['accepted']);
    });

    it('AC-31 the always entry says accepted and a write-in says changed', async () => {
      const first = await suggested();
      await run('resolve', first.id, 'b', '--always');
      const kept = rows();
      expect(kept.map((row) => row.kind)).toEqual(['suggestion', 'standing-set']);
      expect(kept[0]?.outcome).toBe('accepted');
      vi.restoreAllMocks();

      const again = await openQuestion(
        'Which colour should banner use',
        'finding.triage',
        '--ask-anyway',
      );
      const id = again.output.id as string;
      const candidates = (again.output.earlier_check as { candidates: { id: string }[] })
        .candidates;
      vi.restoreAllMocks();
      await run('suggest', id, '--earlier', candidates[0]!.id, '--option', 'b', '--reason', 'Same');
      vi.restoreAllMocks();
      await run('resolve', id, 'x', '--other', 'A new shade');
      expect(rows().at(-1)?.outcome).toBe('changed');
    });

    it('AC-27 a none answer writes exactly one row across suggest and resolve', async () => {
      await answered('Which colour should the banner use', 'Matches the brand');
      const { output } = await openQuestion(TITLE);
      const id = output.id as string;
      vi.restoreAllMocks();
      await run('suggest', id, '--none', '--reason', 'Different screen');
      vi.restoreAllMocks();
      await run('resolve', id, 'a');
      expect(rows()).toEqual([
        expect.objectContaining({
          kind: 'suggestion',
          outcome: 'none',
          note: 'Different screen',
          for_decision: id,
        }),
      ]);
    });

    it('AC-12 AC-41 a rule set, used and removed each write one row', async () => {
      const { id } = await suggested();
      const { out } = await run('resolve', id, 'b', '--always');
      const ruleId = JSON.parse(out.join('\n')).standing_answer as string;
      vi.restoreAllMocks();
      const reused = await openQuestion(TITLE);
      vi.restoreAllMocks();
      await run('standing', 'remove', ruleId);
      const byKind = rows().filter((row) => row.kind !== 'suggestion');
      expect(byKind.map((row) => row.kind)).toEqual(['standing-set', 'reuse', 'standing-removed']);
      expect(byKind[1]).toMatchObject({
        match_kind: 'standing',
        rule_id: ruleId,
        decision_id: id,
        for_decision: reused.output.id,
      });
      for (const row of [byKind[0]!, byKind[2]!]) {
        expect(row).toMatchObject({
          rule_id: ruleId,
          category: 'finding.triage',
          chosen_option_key: 'b',
        });
        expect(typeof row.session_id).toBe('string');
        expect(typeof row.ts).toBe('string');
      }
    });

    it('passes SE_SESSION through as the session id', async () => {
      vi.stubEnv('SE_SESSION', 'ses-from-env');
      try {
        await suggested();
        const id = (await openQuestion('Which colour should banner use this time')).output
          .id as string;
        vi.restoreAllMocks();
        await run('suggest', id, '--none', '--reason', 'No fit');
        expect(
          readSessionDoc(root, DECISION_REUSE_DOC_TYPE, 'ses-from-env').map((row) => row.outcome),
        ).toContain('none');
      } finally {
        vi.unstubAllEnvs();
      }
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
