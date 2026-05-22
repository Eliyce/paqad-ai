import {
  lintDecisionCopy,
  type DecisionPacket,
  buildRepoStateSignature,
  computeDecisionFingerprint,
  isDecisionPacket,
  normalizeDecisionQuestion,
  scoreDecisionOptionOverlap,
  toDecisionRecord,
  validateDecisionPacket,
} from '@/planning/index.js';

describe('decision packet helpers', () => {
  it('normalizes similar questions to the same fingerprint input', () => {
    expect(normalizeDecisionQuestion('Which Button should I use?')).toBe(
      normalizeDecisionQuestion('Button to pick?'),
    );

    const first = computeDecisionFingerprint({
      category: 'component-reuse',
      question: 'Which Button should I use?',
      option_keys: ['reuse-button', 'make-new'],
      repo_state: { active_capabilities: ['coding', 'content'], stack: 'react', packs: ['ui'] },
    });
    const second = computeDecisionFingerprint({
      category: 'component-reuse',
      question: 'Button to pick?',
      option_keys: ['make-new', 'reuse-button'],
      repo_state: { active_capabilities: ['content', 'coding'], stack: 'react', packs: ['ui'] },
    });

    expect(first).toBe(second);
  });

  it('converts a resolved packet into a decision record', () => {
    const packet: DecisionPacket = {
      decision_id: 'D-3',
      fingerprint: 'sha256:test',
      category: 'component-reuse',
      question: 'Use the Button we have?',
      context: 'We are adding a new dashboard action.',
      options: [
        {
          option_key: 'reuse-button',
          label: 'Reuse Button',
          one_line_preview: 'If you pick this, we will update src/components/Button.tsx.',
          trade_off: 'You give up: a fresh design.',
          evidence: { file: 'src/components/Button.tsx', callers: 47, similarity: 0.91 },
        },
        {
          option_key: 'make-new',
          label: 'Make new Button',
          one_line_preview: 'If you pick this, we will create src/components/ButtonV2.tsx.',
          trade_off: 'You give up: one shared place.',
          evidence: { file: 'src/components/ButtonV2.tsx', evidence_partial: true },
        },
      ],
      recommendation: 'reuse-button',
      recommendation_reason: 'We already use one Button across the app.',
      confidence: 0.82,
      requested_by: 'codex-cli',
      task_session_id: 'session-1',
      linked_requirements: ['FR-1'],
      created_at: '2026-04-27T12:00:00Z',
      status: 'resolved',
      human_response: {
        chosen_option_key: 'reuse-button',
        intent: 'explicit',
        explanation_rounds_used: 1,
        responded_at: '2026-04-27T12:01:00Z',
        responded_by: 'haider',
        carry_over_scope: 'session',
      },
      ttl_until: '2026-05-27T12:00:00Z',
      invalidation_watch: ['src/components/Button.tsx'],
    };

    expect(toDecisionRecord(packet)).toEqual({
      decision_id: 'D-3',
      choice: 'Reuse Button',
      reason: 'You give up: a fresh design.',
      alternatives_rejected: [
        {
          alternative: 'Make new Button',
          rejection_reason: 'You give up: one shared place.',
        },
      ],
      linked_requirements: ['FR-1'],
      reversibility: 'easy',
    });
  });

  it('flags banned copy and invalid label lengths', () => {
    const packet = {
      decision_id: 'D-4',
      fingerprint: 'sha256:test',
      category: 'shared-abstraction',
      question: 'Should we use a polymorphic abstraction for this?',
      context: 'A shared change is needed.',
      options: [
        {
          option_key: 'a',
          label: 'Reuse',
          one_line_preview: 'Add it here.',
          trade_off: 'Lose flexibility',
          evidence: {},
        },
      ],
      confidence: 0.5,
      requested_by: 'codex-cli',
      task_session_id: 's',
      created_at: '2026-04-27T12:00:00Z',
      status: 'pending',
      ttl_until: '2026-05-27T12:00:00Z',
      invalidation_watch: [],
    } as DecisionPacket;

    expect(lintDecisionCopy(packet)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'question' }),
        expect.objectContaining({ field: 'options[0].label' }),
        expect.objectContaining({ field: 'options[0].one_line_preview' }),
        expect.objectContaining({ field: 'options[0].trade_off' }),
      ]),
    );
  });

  it('rejects questions longer than fifteen words and labels that are not grade-8 verb-first copy', () => {
    const packet = {
      decision_id: 'D-5',
      fingerprint: 'sha256:test',
      category: 'create-vs-reuse',
      question:
        'Should we now choose the extraordinarily complicated implementation path for this dashboard button flow with extra coordination overhead today?',
      context: 'A shared change is needed.',
      options: [
        {
          option_key: 'a',
          label: 'Extraordinarily Complex Choice',
          one_line_preview: 'If you pick this, we will update src/a.ts.',
          trade_off: 'You give up: a simpler plan.',
          evidence: { file: 'src/a.ts', callers: 1, similarity: 0.9 },
        },
        {
          option_key: 'b',
          label: 'Make new path',
          one_line_preview: 'If you pick this, we will update src/b.ts.',
          trade_off: 'You give up: one shared path.',
          evidence: { file: 'src/b.ts', callers: 0, evidence_partial: true },
        },
      ],
      confidence: 0.5,
      requested_by: 'codex-cli',
      task_session_id: 's',
      created_at: '2026-04-27T12:00:00Z',
      status: 'pending',
      ttl_until: '2026-05-27T12:00:00Z',
      invalidation_watch: [],
    } as DecisionPacket;

    expect(lintDecisionCopy(packet)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'question', message: expect.stringMatching(/15 words/) }),
        expect.objectContaining({ field: 'question', message: expect.stringMatching(/grade-8/) }),
        expect.objectContaining({
          field: 'options[0].label',
          message: expect.stringMatching(/start with a verb/),
        }),
        expect.objectContaining({
          field: 'options[0].label',
          message: expect.stringMatching(/grade-8/),
        }),
      ]),
    );
  });

  it('rejects malformed nested packet fields', () => {
    const packet = {
      decision_id: 'not-a-decision',
      fingerprint: 'bad',
      category: 'component-reuse',
      question: 'Use the Button we have?',
      context: 'We are adding a dashboard action.',
      options: [{ label: 'Missing fields', evidence: null }],
      confidence: 5,
      requested_by: '',
      task_session_id: '',
      created_at: 'yesterday',
      status: 'broken',
      ttl_until: 'later',
      invalidation_watch: [123],
    };

    expect(isDecisionPacket(packet)).toBe(false);
    expect(validateDecisionPacket(packet)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/decision_id/),
        expect.stringMatching(/fingerprint/),
        expect.stringMatching(/options/),
        expect.stringMatching(/confidence/),
        expect.stringMatching(/status/),
      ]),
    );
  });

  it('accepts a valid packet, normalizes repo state signatures, and covers overlap helpers', () => {
    const packet: DecisionPacket = {
      decision_id: 'D-8',
      fingerprint: 'sha256:test',
      category: 'workflow-or-tool',
      question: 'Which workflow fits best?',
      context: 'We are choosing a workflow.',
      options: [
        {
          option_key: 'use-current-workflow',
          label: 'Use current workflow',
          one_line_preview: 'If you pick this, we will update src/workflow.ts.',
          trade_off: 'You give up: trying a brand new tool path.',
          evidence: { file: 'src/workflow.ts', callers: 1, similarity: 0.8 },
        },
        {
          option_key: 'switch-workflow',
          label: 'Switch workflow now',
          one_line_preview: 'If you pick this, we will update src/new-workflow.ts.',
          trade_off: 'You give up: the simpler path for this task.',
          evidence: { file: 'src/new-workflow.ts', callers: 0, evidence_partial: true },
        },
      ],
      recommendation: 'use-current-workflow',
      recommendation_reason: 'This path already matches the way the repo works today.',
      confidence: 0.8,
      requested_by: 'codex-cli',
      task_session_id: 'session-1',
      created_at: '2026-04-27T12:00:00Z',
      status: 'pending',
      ttl_until: '2026-05-27T12:00:00Z',
      invalidation_watch: ['src/workflow.ts'],
    };

    expect(isDecisionPacket(packet)).toBe(true);
    expect(validateDecisionPacket(packet)).toEqual([]);
    expect(
      buildRepoStateSignature({
        active_capabilities: ['security', 'coding'],
        packs: ['b', 'a'],
        stack: 'node',
      }),
    ).toBe(
      buildRepoStateSignature({
        active_capabilities: ['coding', 'security'],
        packs: ['a', 'b'],
        stack: 'node',
      }),
    );
    expect(buildRepoStateSignature({})).toBe(
      JSON.stringify({ active_capabilities: [], packs: [], stack: null }),
    );
    expect(scoreDecisionOptionOverlap([], [])).toBe(1);
    expect(scoreDecisionOptionOverlap(['a', 'b'], ['b', 'c'])).toBe(1 / 3);
  });

  it('covers null decision-record branches and human-response validation branches', () => {
    const pendingPacket: DecisionPacket = {
      decision_id: 'D-9',
      fingerprint: 'sha256:test',
      category: 'component-reuse',
      question: 'Reuse the component or make new?',
      context: 'We are adding a button.',
      options: [
        {
          option_key: 'reuse-existing',
          label: 'Reuse what exists',
          one_line_preview: 'If you pick this, we will update src/a.ts.',
          trade_off: 'You give up: a blank-slate implementation.',
          evidence: { file: 'src/a.ts', callers: 1, similarity: 0.9 },
        },
        {
          option_key: 'make-new',
          label: 'Make a new one',
          one_line_preview: 'If you pick this, we will update src/b.ts.',
          trade_off: 'You give up: the shared path that already exists.',
          evidence: { file: 'src/b.ts', callers: 0, evidence_partial: true },
        },
      ],
      confidence: 0.8,
      requested_by: 'codex-cli',
      task_session_id: 'session-2',
      created_at: '2026-04-27T12:00:00Z',
      status: 'pending',
      ttl_until: '2026-05-27T12:00:00Z',
      invalidation_watch: [],
    };

    expect(toDecisionRecord(pendingPacket)).toBeNull();
    expect(
      validateDecisionPacket({
        ...pendingPacket,
        recommendation: 'missing',
        recommendation_reason: '',
        human_response: {
          chosen_option_key: 'missing',
          intent: 'bad',
          explanation_rounds_used: 10,
          responded_at: 'nope',
          responded_by: '',
          carry_over_scope: 'forever',
          note: 42,
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        'recommendation must reference an option_key',
        'recommendation_reason is required when recommendation is present',
        'human_response.chosen_option_key must reference an option_key',
        'human_response.intent is invalid',
        'human_response.explanation_rounds_used must be between 0 and 3',
        'human_response.responded_at must be an ISO date',
        'human_response.responded_by is required',
        'human_response.carry_over_scope is invalid',
        'human_response.note must be a string',
      ]),
    );
    expect(
      validateDecisionPacket({
        ...pendingPacket,
        options: [
          {
            option_key: '',
            label: '',
            one_line_preview: '',
            trade_off: '',
            evidence: {
              file: 1,
              last_modified: 'not-a-date',
              callers: 'many',
              similarity: 5,
              rule_match: 2,
              evidence_partial: 'yes',
            },
            technical_detail: 2,
          },
          pendingPacket.options[1],
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        'options[0].option_key is required',
        'options[0].label is required',
        'options[0].one_line_preview is required',
        'options[0].trade_off is required',
        'options[0].evidence.file must be a string',
        'options[0].evidence.last_modified must be an ISO date',
        'options[0].evidence.callers must be a number',
        'options[0].evidence.similarity must be between 0 and 1',
        'options[0].evidence.rule_match must be a string',
        'options[0].evidence.evidence_partial must be a boolean',
        'options[0].technical_detail must be a string',
      ]),
    );
    expect(validateDecisionPacket('bad')).toEqual(['packet must be an object']);
    expect(
      validateDecisionPacket({
        ...pendingPacket,
        options: [
          { ...(pendingPacket.options[0] as object), evidence: null },
          pendingPacket.options[1],
        ],
        human_response: null,
      }),
    ).toEqual(
      expect.arrayContaining([
        'options[0].evidence must be an object',
        'human_response must be an object',
      ]),
    );
    expect(
      validateDecisionPacket({
        ...pendingPacket,
        context: '',
        options: [null, pendingPacket.options[1]],
      }),
    ).toEqual(expect.arrayContaining(['context is required', 'options[0] must be an object']));
    expect(
      validateDecisionPacket({
        ...pendingPacket,
        category: 'bad-category',
        question: '',
      }),
    ).toEqual(expect.arrayContaining(['category is invalid', 'question is required']));
  });

  it('schema validation completes within the NFR-3 50ms budget per call', () => {
    const packet: DecisionPacket = {
      decision_id: 'D-8',
      fingerprint: 'sha256:perf-test',
      category: 'component-reuse',
      question: 'Reuse the component or make new?',
      context: 'We are choosing a component path.',
      options: [
        {
          option_key: 'reuse-existing',
          label: 'Reuse what exists',
          one_line_preview: 'If you pick this, we will update src/components/Button.tsx.',
          trade_off: 'You give up: a blank-slate design.',
          evidence: { file: 'src/components/Button.tsx', callers: 12, similarity: 0.91 },
        },
        {
          option_key: 'make-new',
          label: 'Make a new one',
          one_line_preview: 'If you pick this, we will create src/components/ButtonV2.tsx.',
          trade_off: 'You give up: one shared source of truth.',
          evidence: { file: 'src/components/ButtonV2.tsx', evidence_partial: true },
        },
      ],
      confidence: 0.87,
      requested_by: 'codex-cli',
      task_session_id: 'perf-session',
      created_at: '2026-04-27T12:00:00Z',
      status: 'pending',
      ttl_until: '2026-05-27T12:00:00Z',
      invalidation_watch: ['src/components/Button.tsx'],
    };

    const iterations = 100;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      validateDecisionPacket(packet);
    }
    const elapsed = (performance.now() - start) / iterations;
    expect(elapsed).toBeLessThan(50);
  });

  it('fingerprint computation completes within the NFR-4 10ms budget per call', () => {
    const iterations = 100;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      computeDecisionFingerprint({
        category: 'component-reuse',
        question: 'Reuse the component or make new?',
        option_keys: ['reuse-existing', 'make-new'],
        repo_state: { active_capabilities: ['coding'], stack: 'react', packs: ['ui'] },
      });
    }
    const elapsed = (performance.now() - start) / iterations;
    expect(elapsed).toBeLessThan(10);
  });

  it('checks recommendation reason copy and unknown chosen-option decision records', () => {
    const packet: DecisionPacket = {
      decision_id: 'D-10',
      fingerprint: 'sha256:test',
      category: 'architecture-path',
      question: 'Which path should we take?',
      context: 'We are choosing a path.',
      options: [
        {
          option_key: 'keep-current-path',
          label: 'Keep current path',
          one_line_preview: 'If you pick this, we will update src/a.ts.',
          trade_off: 'You give up: a broader refactor right now.',
          evidence: { file: 'src/a.ts', callers: 1, similarity: 0.7 },
        },
        {
          option_key: 'take-new-path',
          label: 'Take new path',
          one_line_preview: 'If you pick this, we will update src/b.ts.',
          trade_off: 'You give up: the smallest possible diff.',
          evidence: { file: 'src/b.ts', callers: 0, evidence_partial: true },
        },
      ],
      recommendation: 'keep-current-path',
      recommendation_reason: 'This extraordinarilycomplicatedreason is too long.',
      confidence: 0.7,
      requested_by: 'codex-cli',
      task_session_id: 'session-3',
      created_at: '2026-04-27T12:00:00Z',
      status: 'resolved',
      human_response: {
        chosen_option_key: 'missing',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-04-27T12:01:00Z',
        responded_by: 'haider',
        carry_over_scope: 'none',
      },
      ttl_until: '2026-05-27T12:00:00Z',
      invalidation_watch: [],
    };

    expect(lintDecisionCopy(packet)).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'recommendation_reason' })]),
    );
    expect(toDecisionRecord(packet)).toBeNull();
  });
});
