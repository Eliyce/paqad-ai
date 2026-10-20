import { describe, expect, it } from 'vitest';

import {
  EVIDENCE_CATEGORIES,
  OTHER_EVIDENCE_ROWS,
  TERMINAL_EVIDENCE_ROWS,
  carriesEvidence,
  evidenceCard,
  evidenceRowLimit,
  evidenceRows,
  isOwnQuestion,
  matchPending,
  pendingPacketPath,
  questionTexts,
} from '../../../../runtime/claude-plugin/mod/ask-evidence.ts';

const PENDING = [
  { id: 'D-01ABC', category: 'intake.write_back', question: 'Write the answer back?' },
  { id: 'D-01DEF', category: 'fix.proof_method', question: 'How should the fix be proven?' },
  { id: '../x', category: 'delivery.open_pr', question: 'Open a pull request?' },
];

function packet(rows: number): string {
  const findings = Array.from({ length: rows }, (_, index) => `finding ${index + 1}`);
  return JSON.stringify({
    id: 'D-01DEF',
    options: [
      { option_key: 'a', label: 'Failing test', evidence: { findings } },
      { option_key: 'b', label: 'Manual step', evidence: {} },
    ],
  });
}

describe('which questions carry evidence', () => {
  it('covers the four categories', () => {
    expect(EVIDENCE_CATEGORIES).toEqual([
      'fix.proof_method',
      'spec.expert_conflict',
      'delivery.open_pr',
      'intake.requirement',
    ]);
    expect(carriesEvidence('intake.write_back')).toBe(false);
  });

  it('matches a question by its text or the decision id', () => {
    expect(matchPending(['How should the fix be proven'], PENDING)?.id).toBe('D-01DEF');
    expect(matchPending(['  how should the FIX be   proven?  '], PENDING)?.id).toBe('D-01DEF');
    expect(matchPending(['Decide D-01DEF now'], PENDING)?.id).toBe('D-01DEF');
    expect(matchPending(['Write the answer back?'], PENDING)).toBeNull();
    expect(matchPending(['Open a pull request?'], PENDING)).toBeNull();
    expect(matchPending(['Something else'], PENDING)).toBeNull();
  });

  it("reads the question texts and tells paqad's own questions apart", () => {
    const questions = [{ question: 'Q1', header: 'Rule stop' }, { question: 7 }, null];
    expect(questionTexts(questions)).toEqual(['Q1']);
    expect(isOwnQuestion([{ question: 'Q', header: 'Rule stop' }])).toBe(true);
    expect(isOwnQuestion([{ question: 'Q', header: 'Reason' }])).toBe(true);
    expect(isOwnQuestion([{ question: 'Q', header: 'Proof' }])).toBe(false);
    expect(isOwnQuestion([{ question: 'Q' }])).toBe(false);
    expect(isOwnQuestion([])).toBe(false);
  });

  it('reads the packet only from the pending folder under a safe id', () => {
    expect(pendingPacketPath('/work', 'D-01DEF')).toBe(
      '/work/.paqad/decisions/pending/D-01DEF.json',
    );
    expect(pendingPacketPath('/work', '../x')).toBeNull();
  });
});

describe('the evidence rows', () => {
  it('lists each option evidence item as one row', () => {
    const text = JSON.stringify({
      options: [
        {
          label: 'Reuse it',
          evidence: {
            file: 'src/a.ts',
            last_modified: '2026-10-01',
            callers: 3,
            similarity: 0.9,
            rule_match: 'RULE-13',
            evidence_partial: true,
            findings: ['QA: no test covers the empty file', 4, ''],
          },
        },
        { option_key: 'skip', evidence: { file: 'src/b.ts' } },
        { label: 'No evidence' },
        'odd',
      ],
    });
    expect(evidenceRows(text)).toEqual([
      'Reuse it: file src/a.ts',
      'Reuse it: last changed 2026-10-01',
      'Reuse it: 3 callers',
      'Reuse it: similarity 0.9',
      'Reuse it: rule RULE-13',
      'Reuse it: evidence is partial',
      'Reuse it: QA: no test covers the empty file',
      'skip: file src/b.ts',
    ]);
  });

  it('draws nothing for a missing, unreadable or empty packet', () => {
    expect(evidenceRows(null)).toEqual([]);
    expect(evidenceRows('{not json')).toEqual([]);
    expect(evidenceRows('[]')).toEqual([]);
    expect(evidenceRows(packet(0))).toEqual([]);
    expect(evidenceCard([], 12)).toEqual([]);
  });

  it('fits the card in 12 rows in the terminal and 48 elsewhere, the last a "+N more" line', () => {
    const rows = evidenceRows(packet(60));
    expect(rows).toHaveLength(60);
    expect(evidenceRowLimit('terminal')).toBe(TERMINAL_EVIDENCE_ROWS);
    expect(evidenceRowLimit('desktop')).toBe(OTHER_EVIDENCE_ROWS);
    const terminal = evidenceCard(rows, TERMINAL_EVIDENCE_ROWS).map((line) => line[0]!.text);
    expect(terminal).toHaveLength(12);
    expect(terminal[0]).toBe('Failing test: finding 1');
    expect(terminal.at(-1)).toBe('+49 more');
    const desktop = evidenceCard(rows, OTHER_EVIDENCE_ROWS).map((line) => line[0]!.text);
    expect(desktop).toHaveLength(48);
    expect(desktop.at(-1)).toBe('+13 more');
    expect(evidenceCard(rows.slice(0, 12), TERMINAL_EVIDENCE_ROWS)).toHaveLength(12);
    expect(evidenceCard(rows.slice(0, 3), TERMINAL_EVIDENCE_ROWS)).toHaveLength(3);
    expect(evidenceCard(rows, 0)).toHaveLength(2);
  });
});
