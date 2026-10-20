import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readContractDecisions, resolvePendingDecision } from '@/decisions/authoring.js';
import { openFeatureChange, recordChangeConstants } from '@/feature-evidence/stage-ledger.js';
import {
  buildFixProofMethodOptions,
  raiseFixProofMethodDecision,
} from '@/fix-protocol/fix-proof-method-decision.js';
import { isDecisionPacket, validateDecisionPacket } from '@/planning/decision-packet.js';

const SES = 'ses-proof-method';

describe('raiseFixProofMethodDecision', () => {
  let root: string;
  let dir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-proof-method-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    dir = openFeatureChange(root, SES, { adapter: 'claude-code' });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('raises nothing for a change that is not a fix or has no kind', () => {
    expect(raiseFixProofMethodDecision(root, dir)).toBeNull();
    recordChangeConstants(root, dir, { kind: 'other' });
    expect(raiseFixProofMethodDecision(root, dir)).toBeNull();
    expect(readContractDecisions(root)).toEqual([]);
  });

  it('raises one rich packet with failing-test recommended plus the three methods', () => {
    recordChangeConstants(root, dir, { kind: 'fix' });
    const first = raiseFixProofMethodDecision(root, dir);
    expect(first?.raised).toBe(true);
    const [{ packet }] = readContractDecisions(root) as [
      { packet: ReturnType<typeof readContractDecisions>[number]['packet'] },
    ];
    expect(packet.recommendation).toBe('failing-test');
    expect(packet.options.map((option) => option.option_key)).toEqual([
      'failing-test',
      'human-verification-step',
      'recorded-baseline-snapshot',
      'measured-threshold',
    ]);
    const rich = packet as unknown as Record<string, unknown> & {
      options: { one_line_preview: string; trade_off: string }[];
    };
    expect(isDecisionPacket(rich)).toBe(true);
    expect(rich.options[1]!.one_line_preview).toContain('a person runs a set check');
    expect(rich.options[1]!.trade_off).toBe('You give up: a fully automated check.');
    expect(packet.options[0]!.evidence).toEqual({});
  });

  it('never raises twice for one change, pending or resolved', () => {
    recordChangeConstants(root, dir, { kind: 'fix' });
    const first = raiseFixProofMethodDecision(root, dir)!;
    expect(raiseFixProofMethodDecision(root, dir)).toEqual({ id: first.id, raised: false });
    resolvePendingDecision(root, first.id, 'failing-test');
    expect(raiseFixProofMethodDecision(root, dir)).toEqual({ id: first.id, raised: false });
    expect(readContractDecisions(root)).toHaveLength(1);
  });
});

describe('buildFixProofMethodOptions', () => {
  it('carries the QA findings as evidence on the failing-test option only', () => {
    const options = buildFixProofMethodOptions(['EX-qa-engineer-2: prove it']);
    expect(options[0]!.evidence).toEqual({ findings: ['EX-qa-engineer-2: prove it'] });
    expect(options.slice(1).every((option) => option.evidence === undefined)).toBe(true);
  });
});

describe('option evidence findings', () => {
  it('rejects findings that are not a string array', () => {
    const option = {
      option_key: 'a',
      label: 'A',
      one_line_preview: 'a',
      trade_off: 'a',
      evidence: { findings: [1] },
    };
    const packet = {
      decision_id: 'D-1',
      fingerprint: 'sha256:x',
      category: 'fix.proof_method',
      question: 'q',
      context: 'c',
      options: [option, { ...option, option_key: 'b', evidence: { findings: 'x' } }],
      confidence: 1,
      requested_by: 'r',
      task_session_id: 't',
      linked_requirements: [],
      created_at: new Date().toISOString(),
      status: 'pending',
      ttl_until: new Date().toISOString(),
      invalidation_watch: [],
    };
    expect(validateDecisionPacket(packet)).toEqual([
      'options[0].evidence.findings must be a string array',
      'options[1].evidence.findings must be a string array',
    ]);
  });
});
