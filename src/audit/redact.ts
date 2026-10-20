import type { SiemEvent } from './types.js';

export const REDACTED = '[REDACTED]';

export function redactEvent(event: SiemEvent): SiemEvent {
  const redacted: SiemEvent = { ...event };

  if (redacted.detail !== undefined) {
    redacted.detail = REDACTED;
  }

  const human = redacted.authorship?.accepting_human;
  if (human !== undefined) {
    redacted.authorship = {
      ...redacted.authorship,
      accepting_human: {
        ...(human.name !== undefined ? { name: REDACTED } : {}),
        ...(human.email !== undefined ? { email: REDACTED } : {}),
      },
    };
  }

  return redacted;
}
