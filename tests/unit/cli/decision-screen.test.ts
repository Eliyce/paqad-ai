import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockInputPrompt, mockSelectPrompt, mockUserInfo } = vi.hoisted(() => ({
  mockInputPrompt: vi.fn(),
  mockSelectPrompt: vi.fn(),
  mockUserInfo: vi.fn(() => ({ username: 'haider' })),
}));

vi.mock('@/cli/ui/prompts.js', () => ({
  inputPrompt: mockInputPrompt,
  selectPrompt: mockSelectPrompt,
}));

vi.mock('node:os', () => ({
  userInfo: mockUserInfo,
}));

import {
  buildDecisionChoices,
  buildExplainRoundText,
  promptForDecision,
  promptForMalformedDecision,
} from '@/cli/ui/decision-screen.js';
import type { DecisionPacket } from '@/planning/decision-packet.js';

describe('decision screen', () => {
  beforeEach(() => {
    mockInputPrompt.mockReset();
    mockSelectPrompt.mockReset();
    mockUserInfo.mockReset();
    mockUserInfo.mockImplementation(() => ({ username: 'haider' }));
  });

  it('renders all six intent classes when create-new is allowed', () => {
    const choices = buildDecisionChoices(createPacket(), 0);

    expect(choices.map((choice) => choice.name)).toEqual([
      'Pick this one: Reuse what exists — src/existing.ts (4 uses)',
      'Pick that one: Make a new one — src/new.ts (usage unknown)',
      'Make a new one',
      'You decide for me',
      "I'm not sure — pick the safer one",
      'Tell me more first',
    ]);
  });

  it('omits make-a-new-one when the category forbids it and removes explain after round three', () => {
    const choices = buildDecisionChoices(
      createPacket({
        category: 'workflow-or-tool',
        options: [
          createPacket().options[0]!,
          { ...createPacket().options[1]!, label: 'Switch workflow now', option_key: 'switch' },
        ],
      }),
      3,
    );

    expect(choices.map((choice) => choice.name)).toEqual([
      'Pick this one: Reuse what exists — src/existing.ts (4 uses)',
      'Pick that one: Switch workflow now — src/new.ts (usage unknown)',
      'You decide for me',
      "I'm not sure — pick the safer one",
    ]);
  });

  it('shows the fast-lane abbreviated choices only', () => {
    const choices = buildDecisionChoices(createPacket(), 0, 'fast');

    expect(choices.map((choice) => choice.name)).toEqual([
      'Pick this one: Reuse what exists — src/existing.ts (4 uses)',
      'Pick that one: Make a new one — src/new.ts (usage unknown)',
      'You decide for me',
    ]);
  });

  it('maps option selection, delegation, safer-default, and create-new flows to intents', async () => {
    mockInputPrompt.mockResolvedValueOnce('haider').mockResolvedValueOnce('');
    mockSelectPrompt.mockResolvedValueOnce('reuse-existing').mockResolvedValueOnce('none');
    await expect(promptForDecision(createPacket())).resolves.toMatchObject({
      chosen_option_key: 'reuse-existing',
      intent: 'explicit',
      carry_over_scope: 'none',
      responded_by: 'haider',
      note: undefined,
    });

    mockInputPrompt.mockResolvedValueOnce('haider').mockResolvedValueOnce('');
    mockSelectPrompt.mockResolvedValueOnce('__delegated__').mockResolvedValueOnce('task');
    await expect(promptForDecision(createPacket())).resolves.toMatchObject({
      chosen_option_key: null,
      intent: 'delegated',
      carry_over_scope: 'task',
    });

    mockInputPrompt.mockResolvedValueOnce('haider').mockResolvedValueOnce('prefer safe');
    mockSelectPrompt.mockResolvedValueOnce('__safer__').mockResolvedValueOnce('session');
    await expect(promptForDecision(createPacket())).resolves.toMatchObject({
      chosen_option_key: 'reuse-existing',
      intent: 'safer-default',
      carry_over_scope: 'session',
      note: 'prefer safe',
    });

    mockInputPrompt.mockResolvedValueOnce('haider').mockResolvedValueOnce('');
    mockSelectPrompt.mockResolvedValueOnce('__create_new__').mockResolvedValueOnce('none');
    await expect(promptForDecision(createPacket())).resolves.toMatchObject({
      chosen_option_key: 'make-new',
      intent: 'created-new',
    });

    mockInputPrompt.mockResolvedValueOnce('haider').mockResolvedValueOnce('');
    mockSelectPrompt.mockResolvedValueOnce('make-new').mockResolvedValueOnce('none');
    await expect(promptForDecision(createPacket())).resolves.toMatchObject({
      chosen_option_key: 'make-new',
      intent: 'created-new',
    });
  });

  it('allows at most three explain rounds and rejects a fourth ask', async () => {
    mockSelectPrompt
      .mockResolvedValueOnce('__explain__')
      .mockResolvedValueOnce('__explain__')
      .mockResolvedValueOnce('__explain__')
      .mockResolvedValueOnce('__explain__')
      .mockResolvedValueOnce('__delegated__')
      .mockResolvedValueOnce('none');
    mockInputPrompt
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('haider')
      .mockResolvedValueOnce('');

    const response = await promptForDecision(
      createPacket({
        options: [
          {
            ...createPacket().options[0]!,
            technical_detail: 'This extends the shared component with one more prop.',
          },
          createPacket().options[1]!,
        ],
      }),
    );

    expect(response.intent).toBe('delegated');
    expect(response.explanation_rounds_used).toBe(3);
    expect(mockInputPrompt).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('Explain round 1/3'),
      '',
    );
    expect(mockInputPrompt).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('Related project context:'),
      '',
    );
    expect(mockInputPrompt).toHaveBeenNthCalledWith(
      4,
      'Pick one of the options or let paqad decide.',
      '',
    );
  });

  it('builds follow-up explanation text and handles malformed prompts plus fallback responder', async () => {
    expect(buildExplainRoundText(createPacket(), 1)).toContain(
      'You give up: a blank-slate implementation.',
    );
    expect(buildExplainRoundText(createPacket(), 2)).toContain('Related project context:');

    mockSelectPrompt.mockResolvedValueOnce('continue');
    await expect(promptForMalformedDecision('D-9', 'bad json')).resolves.toBe('continue');
    expect(mockSelectPrompt).toHaveBeenLastCalledWith(
      expect.stringContaining('bad json'),
      expect.any(Array),
    );

    mockSelectPrompt.mockResolvedValueOnce('stop');
    await expect(promptForMalformedDecision('D-10')).resolves.toBe('stop');
    expect(mockSelectPrompt).toHaveBeenLastCalledWith(
      'Agent tried to pause on D-10, but the request was malformed.',
      expect.any(Array),
    );

    mockUserInfo.mockImplementationOnce(() => {
      throw new Error('no user');
    });
    mockSelectPrompt.mockClear();
    mockInputPrompt.mockResolvedValueOnce('local-user').mockResolvedValueOnce('');
    mockSelectPrompt.mockResolvedValueOnce('reuse-existing').mockResolvedValueOnce('none');
    await expect(
      promptForDecision(
        createPacket({
          options: [
            {
              ...createPacket().options[0]!,
              evidence: { file: 'src/existing.ts', callers: 1, evidence_partial: false },
            },
            {
              ...createPacket().options[1]!,
              evidence: { file: 'src/new.ts', callers: 0, evidence_partial: false },
            },
          ],
        }),
      ),
    ).resolves.toMatchObject({
      responded_by: 'local-user',
    });
    expect(mockSelectPrompt).toHaveBeenNthCalledWith(
      1,
      'paqad paused for your input — Reuse this or make new?',
      expect.any(Array),
    );
    expect(mockSelectPrompt).toHaveBeenLastCalledWith(
      'How long should this preference carry forward?',
      expect.any(Array),
    );
  });

  it('covers safer-default and malformed explicit fallbacks in edge prompt states', async () => {
    expect(
      buildDecisionChoices(
        createPacket({
          recommendation: null,
          options: [
            {
              ...createPacket().options[0]!,
              evidence: { callers: 1 },
            },
            {
              ...createPacket().options[1]!,
              label: 'Start fresh',
              evidence: {},
            },
          ],
        }),
        0,
      ).map((choice) => choice.name),
    ).toEqual([
      'Pick this one: Reuse what exists — no file path (1 use)',
      'Pick that one: Start fresh — no file path (usage unknown)',
      'You decide for me',
      "I'm not sure — pick the safer one",
      'Tell me more first',
    ]);

    mockInputPrompt.mockResolvedValueOnce('haider').mockResolvedValueOnce('');
    mockSelectPrompt.mockResolvedValueOnce('__safer__').mockResolvedValueOnce('none');
    await expect(
      promptForDecision(
        createPacket({
          recommendation: null,
          options: [
            createPacket().options[0]!,
            { ...createPacket().options[1]!, label: 'Start fresh' },
          ],
        }),
      ),
    ).resolves.toMatchObject({
      chosen_option_key: 'reuse-existing',
      intent: 'safer-default',
    });

    mockInputPrompt.mockResolvedValueOnce('haider').mockResolvedValueOnce('');
    mockSelectPrompt.mockResolvedValueOnce('__safer__').mockResolvedValueOnce('none');
    await expect(
      promptForDecision({
        ...createPacket({
          recommendation: null,
          options: [],
        }),
      }),
    ).resolves.toMatchObject({
      chosen_option_key: null,
      intent: 'safer-default',
    });

    mockInputPrompt.mockResolvedValueOnce('haider').mockResolvedValueOnce('');
    mockSelectPrompt.mockResolvedValueOnce('__create_new__').mockResolvedValueOnce('none');
    await expect(
      promptForDecision(
        createPacket({
          options: [
            createPacket().options[0]!,
            { ...createPacket().options[1]!, label: 'Start fresh' },
          ],
        }),
      ),
    ).resolves.toMatchObject({
      chosen_option_key: null,
      intent: 'created-new',
    });

    mockInputPrompt.mockResolvedValueOnce('haider').mockResolvedValueOnce('');
    mockSelectPrompt.mockResolvedValueOnce('__unknown__').mockResolvedValueOnce('none');
    await expect(promptForDecision(createPacket())).resolves.toMatchObject({
      chosen_option_key: '__unknown__',
      intent: 'explicit',
    });
  });

  it('uses the abbreviated fast-lane flow without carry-over or note prompts', async () => {
    mockInputPrompt.mockResolvedValueOnce('haider');
    mockSelectPrompt.mockResolvedValueOnce('reuse-existing');

    await expect(promptForDecision(createPacket(), { mode: 'fast' })).resolves.toMatchObject({
      chosen_option_key: 'reuse-existing',
      carry_over_scope: 'none',
      note: undefined,
      responded_by: 'haider',
    });

    expect(mockInputPrompt).toHaveBeenCalledTimes(1);
    expect(mockSelectPrompt).toHaveBeenCalledTimes(1);
  });
});

function createPacket(overrides: Partial<DecisionPacket> = {}): DecisionPacket {
  return {
    decision_id: 'D-2',
    fingerprint: 'sha256:test',
    category: 'create-vs-reuse',
    question: 'Reuse this or make new?',
    context: 'This task is choosing between the shared path and a blank-slate path.',
    options: [
      {
        option_key: 'reuse-existing',
        label: 'Reuse what exists',
        one_line_preview: 'If you pick this, we will update src/existing.ts.',
        trade_off: 'You give up: a blank-slate implementation.',
        evidence: { file: 'src/existing.ts', callers: 4 },
      },
      {
        option_key: 'make-new',
        label: 'Make a new one',
        one_line_preview: 'If you pick this, we will create src/new.ts.',
        trade_off: 'You give up: the shared path that already exists.',
        evidence: { file: 'src/new.ts', evidence_partial: true },
      },
    ],
    recommendation: 'reuse-existing',
    recommendation_reason: 'This path is already shared.',
    confidence: 0.4,
    requested_by: 'codex-cli',
    task_session_id: 'task-a',
    created_at: '2026-04-27T12:00:00Z',
    status: 'pending',
    ttl_until: '2099-12-31T12:00:00Z',
    invalidation_watch: ['src/existing.ts'],
    ...overrides,
  };
}
