import type { PaqadHudSnapshot, PaqadStageProof } from './types';

export type WordTone = 'pass' | 'fail' | 'acc' | 'att' | 'cau' | 'dim';

export const NOTHING_TO_PROVE = 'Nothing to prove yet';
export const OLD_RECORD_NOTE =
  'This record was written before stage proof. Only its recorded gates are shown.';

export const GATE_STATE_WORDS: Readonly<Record<string, { word: string; tone: WordTone }>> = {
  pass: { word: 'Pass', tone: 'pass' },
  fail: { word: 'Fail', tone: 'fail' },
  inconclusive: { word: 'Could not prove', tone: 'cau' },
  'did-not-run': { word: 'Did not run', tone: 'cau' },
  'not-required': { word: 'Not required', tone: 'dim' },
};

const NOT_JUDGED_WORD = { word: 'Not judged yet', tone: 'dim' as const };

export function gateStateWord(state: string): { word: string; tone: WordTone } {
  return GATE_STATE_WORDS[state] ?? NOT_JUDGED_WORD;
}

const STAGE_STATE_WORDS: Readonly<Record<string, { word: string; tone: WordTone }>> = {
  complete: { word: 'Recorded', tone: 'dim' },
  redone: { word: 'Recorded', tone: 'dim' },
  running: { word: 'Running', tone: 'acc' },
  failed: { word: 'Failed', tone: 'fail' },
  inconclusive: { word: 'Could not prove', tone: 'cau' },
  skipped: { word: 'Skipped', tone: 'cau' },
  'not-applicable': { word: 'Not required', tone: 'dim' },
};

const NOT_YET_WORD = { word: 'Not yet', tone: 'dim' as const };

export type StepMark = 'done' | 'failed' | 'not-yet';

export const STEP_MARKS: Readonly<Record<StepMark, string>> = {
  done: '✓',
  failed: '✕',
  'not-yet': '○',
};

export interface TrustStep {
  key: string;
  mark: StepMark;
  words: string;
  detail: string | null;
}

export interface TrustGateRow {
  key: string;
  words: string;
  word: string;
  tone: WordTone;
}

export interface TrustStage {
  key: string;
  words: string;
  word: string;
  tone: WordTone;
  steps: TrustStep[];
  gates: TrustGateRow[];
}

export function stageHasEvidence(stage: PaqadStageProof): boolean {
  return (
    stage.steps.some((step) => step.state !== 'not-yet') ||
    stage.gates.some((gate) => gate.state !== 'not-judged') ||
    STAGE_STATE_WORDS[stage.state] !== undefined
  );
}

export function trustStage(stage: PaqadStageProof): TrustStage {
  const look = STAGE_STATE_WORDS[stage.state] ?? NOT_YET_WORD;
  return {
    key: stage.stage,
    words: stage.words,
    word: look.word,
    tone: look.tone,
    steps: stage.steps.map((step) => ({
      key: `${stage.stage}-${step.id}`,
      mark: step.state,
      words: step.words,
      detail: step.detail,
    })),
    gates: stage.gates.map((gate) => ({
      key: gate.code,
      words: gate.words,
      ...gateStateWord(gate.state),
    })),
  };
}

const OLD_GATE_WORDS: Readonly<Record<string, string>> = {
  'spec-review': 'The spec was reviewed',
  'implementation-review': 'The code was reviewed',
  'code-tests-lint': 'Tests, types and lint pass',
  'quality-ratchet': 'Quality did not drop',
  duplication: 'No near-copies added',
  'documentation-freshness': 'Docs match the code',
  'ac-test-mapping': 'Every criterion has a test',
  'change-completeness': 'Nothing left half done',
  'mutation-testing': 'Tests catch real mutations',
  'module-docs-structure': 'Module docs keep their shape',
  'instructions-docs-structure': 'Instruction docs keep their shape',
  'extension-surface': 'Public surface stays stable',
  'site-map-freshness': 'The site map matches the app',
};

export function oldRecordGates(snapshot: PaqadHudSnapshot): TrustGateRow[] {
  return snapshot.gates.flatMap((gate) => {
    const words = OLD_GATE_WORDS[gate.name];
    const look = GATE_STATE_WORDS[gate.verdict];
    if (!words || !look || gate.owner === 'paqad-record') return [];
    return [{ key: gate.name, words, ...look }];
  });
}

export function repairLine(snapshot: PaqadHudSnapshot): string | null {
  const repairs = [...new Set((snapshot.repairs ?? []).map((repair) => repair.what))];
  return repairs.length > 0 ? `paqad repaired its own record: ${repairs.join('; ')}` : null;
}

export function recordGapLines(snapshot: PaqadHudSnapshot): string[] {
  return [...new Set(snapshot.record_gaps ?? [])];
}
