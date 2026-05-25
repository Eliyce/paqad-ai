import {
  applyBatchedAnswer,
  isBatchedConfirmRequest,
  renderBatchedRow,
  type BatchedAutoResolution,
  type BatchedConfirmRequest,
} from '@/planning/batched-confirm.js';

function makeResolution(overrides: Partial<BatchedAutoResolution> = {}): BatchedAutoResolution {
  return {
    decision_id: 'D-5',
    category: 'intake.requirement',
    question: 'Which data shape should the export use?',
    chosen_option_key: 'csv',
    chosen_label: 'CSV',
    rationale: 'Auto-resolved from prior decision D-3.',
    ...overrides,
  };
}

describe('batched-confirm primitive', () => {
  it('accepts a well-formed BatchedConfirmRequest', () => {
    const request: BatchedConfirmRequest = {
      auto_resolutions: [makeResolution(), makeResolution({ decision_id: 'D-6' })],
      task_session_id: 'session-1',
      created_at: new Date().toISOString(),
    };
    expect(isBatchedConfirmRequest(request)).toBe(true);
  });

  it('rejects malformed requests', () => {
    expect(isBatchedConfirmRequest(null)).toBe(false);
    expect(isBatchedConfirmRequest({ auto_resolutions: 'no' })).toBe(false);
    expect(
      isBatchedConfirmRequest({
        auto_resolutions: [{ decision_id: 'D-1' }],
        task_session_id: 'x',
        created_at: 'y',
      }),
    ).toBe(false);
  });

  it('returns the original choice on accept', () => {
    const resolution = makeResolution();
    const result = applyBatchedAnswer(resolution, {
      decision_id: 'D-5',
      outcome: 'accepted',
    });
    expect(result.chosen_option_key).toBe('csv');
    expect(result.intent).toBe('safer-default');
  });

  it('returns the overridden choice with explicit intent on override', () => {
    const resolution = makeResolution();
    const result = applyBatchedAnswer(resolution, {
      decision_id: 'D-5',
      outcome: 'overridden',
      overridden_option_key: 'json',
    });
    expect(result.chosen_option_key).toBe('json');
    expect(result.intent).toBe('explicit');
  });

  it('throws when override is missing the option_key', () => {
    expect(() =>
      applyBatchedAnswer(makeResolution(), { decision_id: 'D-5', outcome: 'overridden' }),
    ).toThrow(/overridden_option_key/);
  });

  it('renders a single-line summary that names the decision, question, choice, and rationale', () => {
    const line = renderBatchedRow(makeResolution());
    expect(line).toContain('D-5');
    expect(line).toContain('Which data shape');
    expect(line).toContain('CSV');
    expect(line).toContain('prior decision D-3');
  });
});
