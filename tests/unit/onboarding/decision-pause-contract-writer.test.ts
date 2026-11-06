import { ADAPTER_TYPES } from '@/core/types/adapter.js';
import { DECISION_CATEGORIES } from '@/planning/decision-packet.js';
import {
  MANAGED_HEADER,
  buildDecisionPauseContractBody,
  buildDecisionPauseContractDocument,
} from '@/onboarding/decision-pause-contract-writer.js';

describe('decision-pause-contract-writer', () => {
  it('body starts with the contract title (no managed header in the body form)', () => {
    const body = buildDecisionPauseContractBody();
    expect(body.startsWith('# Decision Pause Contract')).toBe(true);
    expect(body.startsWith(MANAGED_HEADER)).toBe(false);
  });

  it('body lists every category from DECISION_CATEGORIES (no duplication, no drift)', () => {
    const body = buildDecisionPauseContractBody();
    expect(body).toContain('## Categories');
    for (const category of DECISION_CATEGORIES) {
      expect(body).toContain(`\`${category}\``);
    }
  });

  it('body has a per-adapter UI table row for every supported adapter', () => {
    const body = buildDecisionPauseContractBody();
    expect(body).toContain('## Per-adapter UI');
    for (const adapter of ADAPTER_TYPES) {
      expect(body).toContain(`| \`${adapter}\` |`);
    }
  });

  it('body documents the claude-code AskUserQuestion row', () => {
    const body = buildDecisionPauseContractBody();
    expect(body).toContain('`claude-code`');
    expect(body).toContain('AskUserQuestion');
  });

  it('body documents evidence-armed create-vs-reuse pauses without adding categories', () => {
    const body = buildDecisionPauseContractBody();
    expect(body).toContain('## Evidence-armed pauses');
    expect(body).toContain('create-vs-reuse');
    expect(body).toContain('decision_arm_mode');
    expect(body).toContain('origin: "evidence-armed"');
    expect(body).toContain('The categories are unchanged');
  });

  it('body includes the resolution flow with its packet fields and the fallback', () => {
    const body = buildDecisionPauseContractBody();
    expect(body).toContain('## Resolution flow');
    expect(body).toContain('chosen');
    expect(body).toContain('rationale');
    expect(body).toContain('resolved_at');
    expect(body).toContain('## Fallback');
  });

  it('document form is the managed header followed by the body', () => {
    const body = buildDecisionPauseContractBody();
    const doc = buildDecisionPauseContractDocument();
    expect(doc.startsWith(MANAGED_HEADER)).toBe(true);
    expect(doc).toBe(`${MANAGED_HEADER}\n\n${body}\n`);
    expect(doc).toContain(body);
  });

  it('AC-19: asks every pending packet for the change in one round, never one at a time', () => {
    const body = buildDecisionPauseContractBody();
    expect(body).not.toContain('one at a time in creation order');
    expect(body).toContain('Ask every pending packet for this change in one round');
    expect(body).toContain('up to 4 packets per question call');
    expect(body).toContain('back to back and no other work between them');
    expect(body).toContain('`paqad-ai spec pipeline round`');
  });

  it('AC-20: keeps spec.change and spec.contradiction immediate and scopes a packet to its change', () => {
    const body = buildDecisionPauseContractBody();
    expect(body).toContain(
      'A `spec.change` or `spec.contradiction` raised during development is still asked straight away.',
    );
    expect(body).toContain('A pending packet holds up only the change it names');
    expect(body).toContain('nothing is auto-answered');
  });
});

describe('the Resolution flow names the earlier check', () => {
  const body = buildDecisionPauseContractBody();

  it('AC-46 says to check and suggest, and to keep an answer already held', () => {
    expect(body).toContain('paqad-ai decision check <id>');
    expect(body).toContain('paqad-ai decision suggest <id>');
    expect(body).toContain('keep that answer, run check and suggest, and resolve with it');
    expect(body).toContain('Never ask the same question again');
  });

  it('names the block, the hand-back rule, the orchestrator and the commit', () => {
    expect(body).toContain('Same as last time: <label> (from D-...)');
    expect(body).toContain('not from the hand-back');
    expect(body).toContain(
      'the orchestrator then runs check, reads up to 5 where the block lists titles, and runs suggest itself',
    );
    expect(body).toContain('.paqad/decisions/standing-answers.json');
    expect(body).toContain('"reused": true');
  });

  it('commits only the standing answers file beyond the packet, and only when a rule changed', () => {
    expect(body).toContain(
      'Commit `.paqad/decisions/standing-answers.json` with it when a rule was added or removed.',
    );
    expect(body).not.toContain('.paqad/decisions/index.json');
  });

  it('names the decision skill and the store-shape block', () => {
    expect(body).toContain('using the decision skill.');
    expect(body).not.toContain('`decision-pause`');
    expect(body).toContain('has no `other` command and takes only its listed options');
    expect(body).toContain('under `not_shown`');
  });
});
