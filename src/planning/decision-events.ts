import type {
  DecisionCapExceededEvent,
  DecisionDiscardedEvent,
  DecisionEventOption,
  DecisionPacketCorruptEvent,
  DecisionPausedEvent,
  DecisionResolvedEvent,
  EngineEvent,
} from '@/event-bus/types.js';

import type { DecisionOption, DecisionPacket } from './decision-packet.js';

export const DECISION_PAUSE_EVENT_TYPES = [
  'decision-paused',
  'decision-resolved',
  'decision-packet-corrupt',
  'decision-cap-exceeded',
  'decision-discarded',
] as const;

export type DecisionPauseEventType = (typeof DECISION_PAUSE_EVENT_TYPES)[number];

export type DecisionPauseEvent = Extract<EngineEvent, { kind: DecisionPauseEventType }>;

export type DecisionEventSink = (event: DecisionPauseEvent) => void;

function isoNow(): string {
  return new Date().toISOString();
}

function toEventOption(option: DecisionOption): DecisionEventOption {
  return {
    option_key: option.option_key,
    label: option.label,
    one_line_preview: option.one_line_preview,
    trade_off: option.trade_off,
    ...(option.technical_detail !== undefined ? { technical_detail: option.technical_detail } : {}),
  };
}

export function decisionPausedEvent(
  packet: DecisionPacket,
  packetPath: string,
): DecisionPausedEvent {
  return {
    kind: 'decision-paused',
    at: isoNow(),
    decisionId: packet.decision_id,
    category: packet.category,
    prompt: packet.question,
    question: packet.question,
    options: packet.options.map(toEventOption),
    recommendation: packet.recommendation ?? null,
    ...(packet.recommendation_reason !== undefined
      ? { recommendationReason: packet.recommendation_reason }
      : {}),
    packetPath,
    ...(packet.linked_slice_id !== undefined ? { linkedSliceId: packet.linked_slice_id } : {}),
  };
}

export function decisionResolvedEvent(
  packet: DecisionPacket,
  resolver: string,
): DecisionResolvedEvent {
  return {
    kind: 'decision-resolved',
    at: isoNow(),
    decisionId: packet.decision_id,
    resolution: packet.status,
    chosenOptionKey: packet.human_response?.chosen_option_key ?? null,
    resolver,
    ...(packet.human_response?.intent !== undefined
      ? { intent: packet.human_response.intent }
      : {}),
  };
}

export function decisionPacketCorruptEvent(
  decisionId: string,
  reason: string,
): DecisionPacketCorruptEvent {
  return { kind: 'decision-packet-corrupt', at: isoNow(), decisionId, reason };
}

export function decisionCapExceededEvent(
  pendingCount: number,
  cap: number,
): DecisionCapExceededEvent {
  return { kind: 'decision-cap-exceeded', at: isoNow(), pendingCount, cap };
}

export function decisionDiscardedEvent(decisionId: string, reason: string): DecisionDiscardedEvent {
  return { kind: 'decision-discarded', at: isoNow(), decisionId, reason };
}
