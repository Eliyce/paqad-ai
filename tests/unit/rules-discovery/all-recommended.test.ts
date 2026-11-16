import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRulesCommand } from '../../../src/cli/commands/rules.js';
import {
  applyRecommendedVerdicts,
  signoffCounts,
  type Proposal,
  type ProposalRow,
} from '../../../src/rules-discovery/proposal.js';
import { buildSignoffPacket } from '../../../src/rules-discovery/signoff.js';

import { tempRoot, writeFile } from '../onboarding/journey/fixtures/journey.js';

const RUN = 'rd-20261101-100000';

function row(
  rowId: string,
  change: ProposalRow['change'],
  verdict: ProposalRow['verdict'] = null,
): ProposalRow {
  return {
    row_id: rowId,
    change,
    text: `Rule text for ${rowId}.`,
    existing:
      change === 'new' ? null : { rule_id: `RL-${rowId}`, text: 'old text', source: 'api.md' },
    origin: 'research',
    idea_ids: [],
    source_decisions: [],
    sources: [],
    packages: [],
    target: 'docs/instructions/rules/coding/api.md',
    topic: null,
    check: 'script',
    reason: null,
    target_hash: null,
    verdict,
    edited_text: null,
  } as ProposalRow;
}

function proposal(rows: ProposalRow[]): Proposal {
  return {
    schema_version: 1,
    run_id: RUN,
    generated_at: '2026-11-01T10:00:00.000Z',
    rows,
    folded: [],
    not_rules: [],
    manifests: {},
  };
}

describe('rules discovery review --all-recommended', () => {
  it('INV-10 INV-16: fills only null verdicts with new keep, changed drop, removed drop, conflict keep_existing', () => {
    const result = applyRecommendedVerdicts(
      proposal([
        row('P-1', 'new'),
        row('P-2', 'changed'),
        row('P-3', 'removed'),
        row('P-4', 'conflict'),
        row('P-5', 'new', 'drop'),
      ]),
    );
    expect(result.proposal.rows.map((entry) => entry.verdict)).toEqual([
      'keep',
      'drop',
      'drop',
      'keep_existing',
      'drop',
    ]);
    expect(result.filled).toEqual(['P-1', 'P-2', 'P-3', 'P-4']);
    expect(result.listed_for_review.map((entry) => entry.row_id)).toEqual(['P-2', 'P-3']);
    expect(signoffCounts(result.proposal)).toEqual({ added: 1, changed: 0, removed: 0 });
  });

  it('INV-11: never overwrites a person’s verdict and refuses one that would remove or edit a rule', () => {
    expect(() =>
      applyRecommendedVerdicts(proposal([row('P-1', 'removed', 'keep'), row('P-2', 'new')])),
    ).toThrow(/P-1 would remove or rewrite/u);
    expect(() => applyRecommendedVerdicts(proposal([row('P-1', 'changed', 'edit')]))).toThrow(
      /P-1/u,
    );
  });

  it('the sign-off packet recommends sign_off with a reason', () => {
    const packet = buildSignoffPacket({
      decisionId: 'D-1',
      proposal: proposal([row('P-1', 'new', 'keep')]),
      proposalHash: 'abc',
      now: new Date('2026-11-01T10:00:00.000Z'),
    });
    expect(packet.recommendation).toBe('sign_off');
    expect(packet.recommendation_reason).toBeTruthy();
  });

  describe('the CLI flag', () => {
    let root: string;

    beforeEach(() => {
      root = tempRoot('paqad-all-recommended-');
    });

    afterEach(() => {
      vi.restoreAllMocks();
      process.exitCode = undefined;
      rmSync(root, { recursive: true, force: true });
    });

    it('INV-16: writes the safe verdicts and leaves the rule file byte-identical', async () => {
      const ruleFile = '- Existing rule. <!-- @rule RL-1 -->\n';
      writeFile(root, 'docs/instructions/rules/coding/api.md', ruleFile);
      const file = `.paqad/ledger/rules-discovery/${RUN}/proposal.json`;
      writeFile(root, file, JSON.stringify(proposal([row('P-1', 'new'), row('P-2', 'removed')])));
      const lines: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((line: string) => void lines.push(String(line)));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await createRulesCommand().parseAsync(
        ['discovery', 'review', '--run', RUN, '--all-recommended', '--project-root', root],
        { from: 'user' },
      );
      const saved = JSON.parse(readFileSync(join(root, file), 'utf8')) as Proposal;
      expect(saved.rows.map((entry) => entry.verdict)).toEqual(['keep', 'drop']);
      expect(lines.join('\n')).toContain('1 changed or removed row(s) listed for review');
      expect(readFileSync(join(root, 'docs/instructions/rules/coding/api.md'), 'utf8')).toBe(
        ruleFile,
      );
    });

    async function review(...args: string[]) {
      const lines: string[] = [];
      const errors: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((line: string) => void lines.push(String(line)));
      vi.spyOn(console, 'error').mockImplementation((line: string) => void errors.push(line));
      process.exitCode = undefined;
      await createRulesCommand().parseAsync(
        ['discovery', 'review', '--run', RUN, ...args, '--project-root', root],
        { from: 'user' },
      );
      const code = Number(process.exitCode ?? 0);
      process.exitCode = undefined;
      vi.restoreAllMocks();
      return { lines, errors, code };
    }

    it('INV-11: one row still needs --row and a known --verdict, and records it', async () => {
      const file = `.paqad/ledger/rules-discovery/${RUN}/proposal.json`;
      writeFile(root, file, JSON.stringify(proposal([row('P-1', 'new'), row('P-2', 'new')])));
      const missing = await review('--row', 'P-1');
      expect(missing.code).toBe(1);
      expect(missing.errors.join('\n')).toContain(
        'review needs --row and --verdict, or --all-recommended.',
      );
      expect((await review('--verdict', 'keep')).code).toBe(1);
      const unknown = await review('--row', 'P-1', '--verdict', 'maybe');
      expect(unknown.errors.join('\n')).toContain('"maybe" is not a verdict.');
      const kept = await review('--row', 'P-1', '--verdict', 'keep');
      expect(kept.code).toBe(0);
      expect(kept.lines.join('\n')).toContain('review — P-1 is keep; 1 row(s) left.');
      const saved = JSON.parse(readFileSync(join(root, file), 'utf8')) as Proposal;
      expect(saved.rows.map((entry) => entry.verdict)).toEqual(['keep', null]);
    });
  });
});
