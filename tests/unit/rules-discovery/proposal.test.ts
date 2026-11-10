import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DECISION_CATEGORIES, validateDecisionPacket } from '@/planning/decision-packet.js';
import { DecisionStore } from '@/planning/decision-store.js';
import { readBaseline } from '@/rules-discovery/baseline.js';
import { proposeStep, reviewStep, signoffStep } from '@/rules-discovery/flow.js';
import { RULES_DISCOVERY_BASELINE, absRunFile } from '@/rules-discovery/paths.js';
import {
  CHECK_WORDS,
  ROW_VERDICTS,
  readProposal,
  setVerdict,
  signoffQuestion,
} from '@/rules-discovery/proposal.js';
import { readRun } from '@/rules-discovery/run-store.js';
import { NOT_NOW, readSignoff, signedHash } from '@/rules-discovery/signoff.js';

import { NOW, RULE_FILE, flowProject, type FlowProject } from './flow-fixtures.js';

let current: FlowProject | null = null;

function setup(): FlowProject {
  current = flowProject();
  return current;
}

afterEach(() => {
  current?.project.dispose();
  current = null;
});

function decideAll(fp: FlowProject): void {
  const proposal = readProposal(fp.project.root, fp.runId)!;
  for (const row of proposal.rows) {
    const verdict = row.change === 'conflict' ? 'take_new' : 'keep';
    reviewStep(fp.project.root, fp.runId, row.row_id, verdict);
  }
}

describe('rules proposal', () => {
  it('AC-31 each row shows the rule, change, origin, target and how it can be checked', () => {
    const fp = setup();
    const { proposal } = proposeStep(fp.project.root, fp.runId, NOW);
    const byIdea = new Map(proposal.rows.map((row) => [row.idea_ids[0] ?? row.row_id, row]));
    const zod = byIdea.get('RI-zod-1')!;
    expect(zod).toMatchObject({
      change: 'new',
      origin: 'research',
      target: 'docs/instructions/rules/project/validation.md',
      check: 'script',
      text: 'Parse untrusted input with zod schemas.',
    });
    const logged = byIdea.get('DI-2')!;
    expect(logged).toMatchObject({ origin: 'decisions', target: RULE_FILE, check: 'none' });
    expect(logged.text).toBe('Log every request with a request id');
    const markdown = readFileSync(
      absRunFile(fp.project.root, fp.runId, 'proposalMarkdown'),
      'utf8',
    );
    expect(markdown).toContain('P-2 · new · from research');
    expect(markdown).toContain(CHECK_WORDS.script);
    expect(markdown).toContain(`Target: ${RULE_FILE}`);
  });

  it('AC-32 an idea saying the same as an existing rule is folded, not shown as new', () => {
    const fp = setup();
    const { proposal } = proposeStep(fp.project.root, fp.runId, NOW);
    expect(proposal.folded).toEqual([
      { idea_id: 'DI-1', rule_id: 'RL-aaaa', source_decisions: ['D-1'] },
    ]);
    expect(proposal.rows.some((row) => row.idea_ids.includes('DI-1'))).toBe(false);
  });

  it('AC-33 a contradicting idea is a conflict row with both texts and three ways to settle', () => {
    const fp = setup();
    const { proposal } = proposeStep(fp.project.root, fp.runId, NOW);
    const conflict = proposal.rows.find((row) => row.change === 'conflict')!;
    expect(conflict.text).toBe('Return errors as plain text.');
    expect(conflict.existing).toEqual({
      rule_id: 'RL-cccc',
      text: 'Return errors as problem+json.',
      source: RULE_FILE,
    });
    expect(ROW_VERDICTS.conflict).toEqual(['keep_existing', 'take_new', 'edit']);
    expect(() => setVerdict(proposal, conflict.row_id, 'keep')).toThrow(/keep_existing/);
  });

  it('AC-35 a rule about a package no longer used is proposed for removal with the reason', () => {
    const fp = setup();
    const { proposal } = proposeStep(fp.project.root, fp.runId, NOW);
    const removal = proposal.rows.find((row) => row.change === 'removed')!;
    expect(removal.existing?.rule_id).toBe('RL-bbbb');
    expect(removal.reason).toBe('the project no longer uses moment');
    expect(proposal.rows.filter((row) => row.change === 'removed')).toHaveLength(1);
  });

  it('AC-36 one rules.proposal decision asks the sign-off question with the real counts', () => {
    const fp = setup();
    proposeStep(fp.project.root, fp.runId, NOW);
    expect(() => signoffStep(fp.project.root, fp.runId, NOW)).toThrow(/without a keep/);
    decideAll(fp);
    const result = signoffStep(fp.project.root, fp.runId, NOW);
    expect(result.counts).toEqual({ added: 2, changed: 1, removed: 1 });
    const packet = new DecisionStore(fp.project.root).readPending(result.decision_id)!;
    expect(packet.category).toBe('rules.proposal');
    expect(packet.question).toBe('Sign off 2 new, 1 changed, 1 removed rules?');
    expect(packet.options.map((option) => option.option_key)).toEqual(['sign_off', 'not_now']);
    expect(packet.invalidation_watch).toEqual([
      RULE_FILE,
      'docs/instructions/rules/project/validation.md',
    ]);
    expect(signedHash(packet)).toBe(result.hash);
    expect(validateDecisionPacket(packet)).toEqual([]);
    const run = readRun(fp.project.root, fp.runId);
    expect(run.state === 'ok' && run.record).toMatchObject({
      step: 'sign_off',
      signoff_decision: result.decision_id,
      proposal_hash: result.hash,
    });
    expect(signoffQuestion({ added: 0, changed: 0, removed: 3 })).toBe(
      'Sign off 0 new, 0 changed, 3 removed rules?',
    );
    expect(signoffStep(fp.project.root, fp.runId, NOW).decision_id).toBe(result.decision_id);
  });

  it('accepts rules.proposal as a decision category', () => {
    expect(DECISION_CATEGORIES).toContain('rules.proposal');
  });

  it('AC-37 a not_now sign-off leaves rule files, decisions and baseline untouched', () => {
    const fp = setup();
    const before = fp.read(RULE_FILE);
    proposeStep(fp.project.root, fp.runId, NOW);
    decideAll(fp);
    const { decision_id } = signoffStep(fp.project.root, fp.runId, NOW);
    new DecisionStore(fp.project.root).resolve({
      decisionId: decision_id,
      humanResponse: {
        chosen_option_key: NOT_NOW,
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: NOW.toISOString(),
        responded_by: 'human',
        carry_over_scope: 'none',
      },
    });
    expect(readSignoff(fp.project.root, decision_id).state).toBe('not_now');
    expect(fp.read(RULE_FILE)).toBe(before);
    expect(existsSync(join(fp.project.root, RULES_DISCOVERY_BASELINE))).toBe(false);
    expect(readProposal(fp.project.root, fp.runId)?.rows.length).toBeGreaterThan(0);
    expect(fp.read('.paqad/decisions/resolved/D-1.json')).not.toContain('rules_discovery');
  });

  it('AC-39 nothing to propose reports the rules current, skips sign-off and moves the baseline', () => {
    const fp = setup();
    for (const file of ['fromDecisions', 'fromResearch', 'judgements'] as const) {
      writeFileSync(
        absRunFile(fp.project.root, fp.runId, file),
        file === 'fromDecisions'
          ? '{"ideas":[],"not_rules":[]}'
          : file === 'fromResearch'
            ? '[]'
            : '{}',
      );
    }
    const inventoryPath = absRunFile(fp.project.root, fp.runId, 'inventory');
    const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
    inventory.packages = inventory.packages.filter(
      (p: { status: string }) => p.status !== 'removed',
    );
    writeFileSync(inventoryPath, JSON.stringify(inventory));
    const result = proposeStep(fp.project.root, fp.runId, NOW);
    expect(result.current).toBe(true);
    expect(readBaseline(fp.project.root)?.run_id).toBe(fp.runId);
    const run = readRun(fp.project.root, fp.runId);
    expect(run.state === 'ok' && run.record.status).toBe('done');
    expect(new DecisionStore(fp.project.root).listPendingDecisionIds()).toEqual([]);
  });

  it('AC-61 proposing again after a stop keeps earlier keep, edit and drop choices', () => {
    const fp = setup();
    const { proposal } = proposeStep(fp.project.root, fp.runId, NOW);
    const [first, second] = proposal.rows;
    reviewStep(
      fp.project.root,
      fp.runId,
      first!.row_id,
      'edit',
      'Parse all untrusted input with zod.',
    );
    reviewStep(fp.project.root, fp.runId, second!.row_id, 'drop');
    const again = proposeStep(fp.project.root, fp.runId, NOW).proposal;
    expect(again.rows[0]).toMatchObject({
      verdict: 'edit',
      edited_text: 'Parse all untrusted input with zod.',
    });
    expect(again.rows[1]?.verdict).toBe('drop');
    expect(() =>
      reviewStep(
        fp.project.root,
        fp.runId,
        second!.row_id,
        'edit',
        'Parse all untrusted input with zod.',
      ),
    ).toThrow(/repeats row/);
  });

  it('AC-62 rows touched by a rule file or stack change are reported stale on resume', () => {
    const fp = setup();
    proposeStep(fp.project.root, fp.runId, NOW);
    expect(proposeStep(fp.project.root, fp.runId, NOW).stale).toEqual([]);
    fp.project.write(RULE_FILE, `${fp.read(RULE_FILE)}- One more rule.\n`);
    fp.project.write('package.json', '{"dependencies":{"zod":"^2.0.0"}}\n');
    const { stale } = proposeStep(fp.project.root, fp.runId, NOW);
    const why = Object.fromEntries(stale.map((row) => [row.row_id, row.why]));
    expect(Object.values(why)).toContain(`${RULE_FILE} changed`);
    expect(Object.values(why)).toContain('the stack changed');
  });
});
