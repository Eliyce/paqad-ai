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

  it('body documents evidence-armed create-vs-reuse pauses (issue #361) without adding categories', () => {
    const body = buildDecisionPauseContractBody();
    expect(body).toContain('## Evidence-armed pauses');
    expect(body).toContain('create-vs-reuse');
    expect(body).toContain('decision_arm_mode');
    expect(body).toContain('origin: "evidence-armed"');
    // The arming section names create-vs-reuse but introduces no NEW category —
    // the category list stays sourced from DECISION_CATEGORIES (covered above).
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
});
