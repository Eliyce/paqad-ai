import { userInfo } from 'node:os';

import { inputPrompt, selectPrompt } from './prompts.js';
import type {
  DecisionCategory,
  DecisionCarryOverScope,
  DecisionHumanResponse,
  DecisionPacket,
} from '@/planning/decision-packet.js';
import { DECISION_CATEGORY_DEFAULTS } from '@/planning/decision-packet.js';

export interface DecisionPromptOptions {
  mode?: 'full' | 'fast';
}

export async function promptForDecision(
  packet: DecisionPacket,
  options: DecisionPromptOptions = {},
): Promise<DecisionHumanResponse> {
  const mode = options.mode ?? 'full';
  let explanationRoundsUsed = 0;

  while (true) {
    const choices = buildDecisionChoices(packet, explanationRoundsUsed, mode);

    const selected = await selectPrompt(screenHeader(packet), choices);

    if (selected === '__explain__') {
      if (explanationRoundsUsed >= 3) {
        await inputPrompt('Pick one of the options or let paqad decide.', '');
        continue;
      }
      explanationRoundsUsed += 1;
      await showExplanation(packet, explanationRoundsUsed);
      continue;
    }

    const respondedBy = await inputPrompt('Who is answering this decision?', defaultResponder());
    const carryOverScope = mode === 'fast' ? 'none' : await promptForCarryOver();
    const note =
      mode === 'fast' ? undefined : await inputPrompt('Optional note for this decision record', '');

    if (selected === '__delegated__') {
      return buildResponse({
        chosen_option_key: null,
        intent: 'delegated',
        explanation_rounds_used: explanationRoundsUsed,
        responded_by: respondedBy,
        carry_over_scope: carryOverScope,
        note,
      });
    }
    if (selected === '__safer__') {
      return buildResponse({
        chosen_option_key: packet.recommendation ?? packet.options[0]?.option_key ?? null,
        intent: 'safer-default',
        explanation_rounds_used: explanationRoundsUsed,
        responded_by: respondedBy,
        carry_over_scope: carryOverScope,
        note,
      });
    }
    if (selected === '__create_new__') {
      const createNew = findCreateNewOption(packet);
      return buildResponse({
        chosen_option_key: createNew?.option_key ?? null,
        intent: 'created-new',
        explanation_rounds_used: explanationRoundsUsed,
        responded_by: respondedBy,
        carry_over_scope: carryOverScope,
        note,
      });
    }

    return buildResponse({
      chosen_option_key: selected,
      intent:
        (packet.options
          .find((option) => option.option_key === selected)
          ?.label.toLowerCase()
          .includes('new') ?? false)
          ? 'created-new'
          : 'explicit',
      explanation_rounds_used: explanationRoundsUsed,
      responded_by: respondedBy,
      carry_over_scope: carryOverScope,
      note,
    });
  }
}

export async function promptForMalformedDecision(
  decisionId: string,
  details?: string,
): Promise<'continue' | 'stop'> {
  const message = details
    ? `Agent tried to pause on ${decisionId}, but the request was malformed. ${details}`
    : `Agent tried to pause on ${decisionId}, but the request was malformed.`;
  return (await selectPrompt(message, [
    { name: 'Continue with a rebuilt pause request', value: 'continue' },
    { name: 'Stop and fix the malformed request', value: 'stop' },
  ])) as 'continue' | 'stop';
}

export function buildDecisionChoices(
  packet: DecisionPacket,
  explanationRoundsUsed: number,
  mode: 'full' | 'fast' = 'full',
) {
  if (mode === 'fast') {
    return [
      ...packet.options.slice(0, 2).map((option, index) => ({
        name: `${index === 0 ? 'Pick this one' : 'Pick that one'}: ${option.label} — ${summarizeEvidence(option.evidence)}`,
        value: option.option_key,
      })),
      { name: 'You decide for me', value: '__delegated__' },
    ];
  }

  return [
    ...packet.options.map((option, index) => ({
      name: `${index === 0 ? 'Pick this one' : 'Pick that one'}: ${option.label} — ${summarizeEvidence(option.evidence)}`,
      value: option.option_key,
    })),
    ...(supportsCreateNew(packet.category, packet)
      ? [{ name: 'Make a new one', value: '__create_new__' }]
      : []),
    { name: 'You decide for me', value: '__delegated__' },
    { name: "I'm not sure — pick the safer one", value: '__safer__' },
    ...(explanationRoundsUsed < 3 ? [{ name: 'Tell me more first', value: '__explain__' }] : []),
  ];
}

function summarizeEvidence(evidence: DecisionPacket['options'][number]['evidence']): string {
  const location = evidence.file ?? 'no file path';
  const callers =
    typeof evidence.callers === 'number'
      ? `${evidence.callers} use${evidence.callers === 1 ? '' : 's'}`
      : 'usage unknown';
  return `${location} (${callers})`;
}

async function promptForCarryOver(): Promise<DecisionCarryOverScope> {
  return (await selectPrompt('How long should this preference carry forward?', [
    { name: 'This session', value: 'session' },
    { name: 'This task only', value: 'task' },
    { name: 'Just this decision', value: 'none' },
  ])) as DecisionCarryOverScope;
}

export function buildExplainRoundText(packet: DecisionPacket, round: number): string {
  if (round === 1) {
    return packet.options
      .map(
        (option) =>
          `${option.label}: ${option.technical_detail ?? option.one_line_preview} ${option.trade_off}`,
      )
      .join('\n\n');
  }

  return [
    packet.context,
    'Related project context:',
    ...packet.options.map(
      (option) =>
        `${option.label}: ${option.one_line_preview} Evidence: ${summarizeEvidence(option.evidence)}`,
    ),
  ].join('\n\n');
}

async function showExplanation(packet: DecisionPacket, round: number): Promise<void> {
  const detail = buildExplainRoundText(packet, round);
  await inputPrompt(
    `Explain round ${round}/3\n\n${detail}\n\nPress enter to go back to the choices.`,
    '',
  );
}

function screenHeader(packet: DecisionPacket): string {
  const limitedEvidence = packet.options.some((option) => option.evidence.evidence_partial);
  return limitedEvidence
    ? `paqad paused for your input — ${packet.question} Some options have limited information.`
    : `paqad paused for your input — ${packet.question}`;
}

function supportsCreateNew(category: DecisionCategory, packet: DecisionPacket): boolean {
  if (!DECISION_CATEGORY_DEFAULTS[category].create_new) {
    return false;
  }
  return findCreateNewOption(packet) !== undefined;
}

function findCreateNewOption(packet: DecisionPacket) {
  return packet.options.find((option) => option.label.toLowerCase().includes('new'));
}

function defaultResponder(): string {
  try {
    return userInfo().username;
  } catch {
    return 'local-user';
  }
}

function buildResponse(input: Omit<DecisionHumanResponse, 'responded_at'>): DecisionHumanResponse {
  return {
    ...input,
    responded_at: new Date().toISOString(),
    note: input.note?.trim() || undefined,
  };
}
