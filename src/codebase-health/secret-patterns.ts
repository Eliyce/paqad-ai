import { createHash } from 'node:crypto';

export interface SecretPattern {
  rule: string;
  pattern: RegExp;
}

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  { rule: 'private-key', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
  { rule: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    rule: 'generic-api-key',
    pattern: /(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"][A-Za-z0-9/+_-]{16,}['"]/i,
  },
  { rule: 'bearer-token', pattern: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/ },
];

export function redactedFingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}
