import type { RedactionAllowlist } from '../types/logging.js';

export const REDACTION_PLACEHOLDER = '[REDACTED]';

export const DEFAULT_REDACTION_ALLOWLIST: RedactionAllowlist = Object.freeze([
  'credential',
  'prompt',
  'user_content',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function redactFields(
  fields: Record<string, unknown>,
  allowlist: RedactionAllowlist,
): { redacted: Record<string, unknown>; count: number } {
  const blocked = new Set(allowlist);
  const redacted: Record<string, unknown> = {};
  let count = 0;

  for (const [key, value] of Object.entries(fields)) {
    if (blocked.has(key)) {
      redacted[key] = REDACTION_PLACEHOLDER;
      count += 1;
      continue;
    }

    if (isPlainObject(value)) {
      const inner: Record<string, unknown> = {};
      for (const [innerKey, innerValue] of Object.entries(value)) {
        if (blocked.has(innerKey)) {
          inner[innerKey] = REDACTION_PLACEHOLDER;
          count += 1;
        } else {
          inner[innerKey] = innerValue;
        }
      }
      redacted[key] = inner;
      continue;
    }

    redacted[key] = value;
  }

  return { redacted, count };
}
