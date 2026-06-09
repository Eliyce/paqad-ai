import type { RedactionAllowlist } from '../types/logging.js';

/** Literal token substituted for any allowlisted sensitive field value. */
export const REDACTION_PLACEHOLDER = '[REDACTED]';

/**
 * Canonical, engine-authoritative list of sensitive field names. All three
 * runtimes import this rather than defining their own copy.
 */
export const DEFAULT_REDACTION_ALLOWLIST: RedactionAllowlist = Object.freeze([
  'credential',
  'prompt',
  'user_content',
]);

/** A plain object is a non-null, non-array object literal. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Returns a copy of `fields` with the value of any key that matches the
 * allowlist replaced by {@link REDACTION_PLACEHOLDER}. Redaction is applied at
 * the top level and one level deep inside plain nested objects. `count` is the
 * number of values replaced, so callers can drive an operational counter.
 */
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
