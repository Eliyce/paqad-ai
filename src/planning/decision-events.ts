/**
 * Decision-pause event family (PQD-101).
 *
 * The engine streams named, typed events whenever a decision packet is
 * persisted, resolved, found corrupt, refused for exceeding the pending cap, or
 * discarded — so a consumer (the desktop Decision Pause panel) can react live
 * without ever polling `.paqad/decisions/pending/`.
 *
 * The event *shapes* live in the unified engine event union (PQD-99,
 * {@link EngineEvent}) so every decision event is multiplexed into the single
 * stream a consumer already subscribes to. This module owns the planning-domain
 * concerns: the discriminant set, a narrowed {@link DecisionPauseEvent} alias,
 * and the builder functions {@link DecisionStore} uses to assemble each event.
 */

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

/** The `kind` discriminants that make up the decision-pause event family. */
export const DECISION_PAUSE_EVENT_TYPES = [
  'decision-paused',
  'decision-resolved',
  'decision-packet-corrupt',
  'decision-cap-exceeded',
  'decision-discarded',
] as const;

/** Union of the decision-pause event discriminants. */
export type DecisionPauseEventType = (typeof DECISION_PAUSE_EVENT_TYPES)[number];

/** The subset of {@link EngineEvent} that belongs to the decision-pause family. */
export type DecisionPauseEvent = Extract<EngineEvent, { kind: DecisionPauseEventType }>;

/** A sink that receives decision-pause events as they occur. */
export type DecisionEventSink = (event: DecisionPauseEvent) => void;

function isoNow(): string {
  return new Date().toISOString();
}

/** Project the rich planning option down to the serialisable event option. */
function toEventOption(option: DecisionOption): DecisionEventOption {
  return {
    option_key: option.option_key,
    label: option.label,
    one_line_preview: option.one_line_preview,
    trade_off: option.trade_off,
    ...(option.technical_detail !== undefined ? { technical_detail: option.technical_detail } : {}),
  };
}

/**
 * Build a `decision-paused` event from a freshly persisted packet. `packetPath`
 * is project-relative so streamed payloads never leak the user's home path.
 */
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

/** Build a `decision-resolved` event from a resolved packet. */
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

/** Build a `decision-packet-corrupt` event for a malformed pending packet. */
export function decisionPacketCorruptEvent(
  decisionId: string,
  reason: string,
): DecisionPacketCorruptEvent {
  return { kind: 'decision-packet-corrupt', at: isoNow(), decisionId, reason };
}

/** Build a `decision-cap-exceeded` event when a new pause is refused. */
export function decisionCapExceededEvent(
  pendingCount: number,
  cap: number,
): DecisionCapExceededEvent {
  return { kind: 'decision-cap-exceeded', at: isoNow(), pendingCount, cap };
}

/** Build a `decision-discarded` event for an explicitly dropped packet. */
export function decisionDiscardedEvent(decisionId: string, reason: string): DecisionDiscardedEvent {
  return { kind: 'decision-discarded', at: isoNow(), decisionId, reason };
}
