// Issue #121 — the PII redaction pass.
//
// The exporter's risk surface: `detail` carries free-form messages (filenames,
// error strings) and `authorship.accepting_human` is a human identity. With
// `--redact`, both are replaced with a constant sentinel before formatting.
// Everything else — verdicts, digests, hashes, grades — is non-identifying
// provenance and is preserved, so a redacted export is still useful evidence.

import type { SiemEvent } from './types.js';

export const REDACTED = '[REDACTED]';

/** Return a copy of the event with free-text detail and human identity removed. */
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
