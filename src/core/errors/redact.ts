import { redactSecrets } from '@/rag/secrets.js';

export interface RedactPayloadResult {
  redacted: Record<string, unknown>;
  redacted_fields: string[];
}

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
