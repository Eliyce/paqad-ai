import { describe, expect, it } from 'vitest';

import {
  canDriveCodeChange,
  changeDrivingVerdicts,
  classifyFinding,
  triageFinding,
} from '@/triage/classifier.js';
import type { TriageFinding, TriageSignals } from '@/core/types/triage.js';

function finding(signals: TriageSignals, overrides: Partial<TriageFinding> = {}): TriageFinding {
  return {
    id: 'F-1',
    source: 'gate',
    kind: 'generic',
    message: 'something',
    file: 'src/x.ts',
    line: 10,
    signals,
    ...overrides,
  };
}

describe('classifyFinding — the four piles', () => {
  it('sorts a reproducible failing gate into confirmed/demonstrable → code-change', () => {
    const v = classifyFinding(
      finding({ gate_failed: true, reproducible: true, behavioural: true }),
    );
    expect(v.pile).toBe('confirmed');
    expect(v.confirmation).toBe('demonstrable');
    expect(v.route).toBe('code-change');
    expect(v.ambiguous).toBe(false);
  });

  it('sorts a not-yet-reproducible failing gate into confirmed/needs-repro → await-repro (no change)', () => {
    const v = classifyFinding(finding({ gate_failed: true, reproducible: false }));
    expect(v.pile).toBe('confirmed');
    expect(v.confirmation).toBe('needs-repro');
    expect(v.route).toBe('await-repro');
    expect(canDriveCodeChange(v)).toBe(false);
  });

  it('sorts a spec-silent finding into unclear-spec → spec (#102), not code', () => {
    const v = classifyFinding(finding({ spec_silent: true }));
    expect(v.pile).toBe('unclear-spec');
    expect(v.route).toBe('spec');
    expect(canDriveCodeChange(v)).toBe(false);
  });

  it('sorts a refuted finding into false-alarm → record', () => {
    const v = classifyFinding(finding({ refuted_by_evidence: true }));
    expect(v.pile).toBe('false-alarm');
    expect(v.route).toBe('record');
  });

  it('sorts a style-only, non-behavioural finding into taste → record (never edits code)', () => {
    const v = classifyFinding(finding({ style_only: true, behavioural: false }));
    expect(v.pile).toBe('taste');
    expect(v.route).toBe('record');
    expect(canDriveCodeChange(v)).toBe(false);
  });
});

describe('classifyFinding — special routes and ambiguity', () => {
  it('routes a measurable quality regression to the ratchet (#110), not the taste bin', () => {
    const v = classifyFinding(finding({ measurable_quality: true, style_only: true }));
    expect(v.pile).toBeNull();
    expect(v.route).toBe('ratchet');
  });

  it('marks a finding with no decisive signal ambiguous → ask-human', () => {
    const v = classifyFinding(finding({}));
    expect(v.pile).toBeNull();
    expect(v.ambiguous).toBe(true);
    expect(v.route).toBe('ask-human');
  });

  it('does not treat a style-only-but-behavioural finding as taste — it is ambiguous', () => {
    const v = classifyFinding(finding({ style_only: true, behavioural: true }));
    expect(v.pile).toBeNull();
    expect(v.ambiguous).toBe(true);
    expect(v.route).toBe('ask-human');
  });

  it('checks the strongest signal first: refuted beats every other signal', () => {
    const v = classifyFinding(
      finding({ refuted_by_evidence: true, gate_failed: true, reproducible: true }),
    );
    expect(v.pile).toBe('false-alarm');
  });
});

describe('triageFinding — lane behaviour', () => {
  it('fast lane is prompt-free: an ambiguous finding is set aside, not asked', () => {
    const v = triageFinding(finding({}), 'fast');
    expect(v.ambiguous).toBe(false);
    expect(v.route).toBe('record');
    expect(v.reason).toContain('fast lane');
  });

  it('off the fast lane an ambiguous finding opens a Decision Pause (ask-human)', () => {
    expect(triageFinding(finding({}), 'graduated').route).toBe('ask-human');
    expect(triageFinding(finding({}), 'full').route).toBe('ask-human');
  });

  it('a clearly-sorted finding is unaffected by the lane', () => {
    const f = finding({ gate_failed: true, reproducible: true });
    expect(triageFinding(f, 'fast').route).toBe('code-change');
    expect(triageFinding(f, 'full').route).toBe('code-change');
  });
});

describe('canDriveCodeChange — only confirmed-demonstrable may change code', () => {
  it('returns true only for the confirmed/demonstrable pile', () => {
    const confirmed = classifyFinding(finding({ gate_failed: true, reproducible: true }));
    expect(canDriveCodeChange(confirmed)).toBe(true);
  });

  it('returns false for taste, false-alarm, unclear-spec, needs-repro, ratchet, ambiguous', () => {
    const cases: TriageSignals[] = [
      { style_only: true, behavioural: false }, // taste
      { refuted_by_evidence: true }, // false-alarm
      { spec_silent: true }, // unclear-spec
      { gate_failed: true, reproducible: false }, // needs-repro
      { measurable_quality: true }, // ratchet
      {}, // ambiguous
    ];
    for (const signals of cases) {
      expect(canDriveCodeChange(classifyFinding(finding(signals)))).toBe(false);
    }
  });

  it('changeDrivingVerdicts keeps only the change-driving verdicts', () => {
    const verdicts = [
      classifyFinding(finding({ gate_failed: true, reproducible: true }, { id: 'A' })),
      classifyFinding(finding({ style_only: true }, { id: 'B' })),
      classifyFinding(finding({ spec_silent: true }, { id: 'C' })),
    ];
    expect(changeDrivingVerdicts(verdicts).map((v) => v.finding_id)).toEqual(['A']);
  });
});
