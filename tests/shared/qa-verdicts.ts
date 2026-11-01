export const QA_VERDICTS = {
  spec_compliance: { status: 'pass', reason: 'every acceptance criterion has a check' },
  quality: { status: 'concerns', reason: 'the empty input case has no test yet' },
} as const;

export function qaVerdictsFor(role: string): { verdicts?: typeof QA_VERDICTS } {
  return role === 'qa-engineer' ? { verdicts: QA_VERDICTS } : {};
}
