// PQD-107 — strip credential material out of error payloads before they are
// surfaced to a consumer. Reuses the RAG secret-redaction logic so the engine
// has a single definition of "what is a secret".

import { redactSecrets } from '@/rag/secrets.js';

export interface RedactPayloadResult {
  redacted: Record<string, unknown>;
  /** Names of the fields whose values were altered by redaction. */
  redacted_fields: string[];
}

/**
 * Run every string-valued field of `payload` through {@link redactSecrets} and
 * report which fields were touched. Non-string fields pass through untouched.
 *
 * When `projectRoot` is omitted, or the project has no secrets configured,
 * `redactSecrets` is a no-op and the payload is returned unchanged with an empty
 * `redacted_fields` list — so error construction never fails on a missing
 * `.paqad/secrets.env` (the common case in tests and CI).
 */
export function redactPayload(
  payload: Record<string, unknown>,
  projectRoot?: string,
): RedactPayloadResult {
  if (!projectRoot) {
    return { redacted: { ...payload }, redacted_fields: [] };
  }

  const redacted: Record<string, unknown> = {};
  const redacted_fields: string[] = [];

  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string') {
      const cleaned = redactSecrets(value, projectRoot);
      redacted[key] = cleaned;
      if (cleaned !== value) {
        redacted_fields.push(key);
      }
    } else {
      redacted[key] = value;
    }
  }

  return { redacted, redacted_fields };
}
