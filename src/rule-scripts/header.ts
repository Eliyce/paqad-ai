import { validateScriptHeader, type ValidationResult } from './validate.js';

export const HEADER_MARKER = '@paqad-rule-script';

export interface ScriptHeader {
  rule_id: string;
  source: string;
  kind: 'deterministic' | 'heuristic';
  scope: 'changed-files' | 'whole-tree' | 'git-diff' | 'git-history';
  runtime: 'node';
  requires?: { node?: string; binaries?: string[] };
  per_file?: boolean;
  last_validated_at?: string;
  false_positive_surface?: string;
}

const BOOLEAN_WORDS = new Map([
  ['true', true],
  ['false', false],
]);

const HEADER_LINE_RE = /^\s*\/\/\s*([a-z_]+)\s*:(.*)$/;

export function extractHeaderFields(content: string): Record<string, string> | null {
  const lines = content.split('\n');
  let sawMarker = false;
  const fields: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') {
      continue;
    }
    if (!trimmed.startsWith('//')) {
      break;
    }
    if (trimmed.includes(HEADER_MARKER)) {
      sawMarker = true;
      continue;
    }
    const m = HEADER_LINE_RE.exec(line);
    if (m) {
      fields[m[1]] = m[2].trim();
    }
  }

  return sawMarker ? fields : null;
}

function coerce(fields: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(fields)) {
    if (key === 'requires') {
      try {
        out.requires = JSON.parse(raw);
      } catch {
        out.requires = raw;
      }
      continue;
    }
    const value = raw.replace(/^"(.*)"$/, '$1');
    if (key === 'rule_id') {
      out[key] = value.replace(/^RL-([0-9a-fA-F]+)$/, (_, h) => `RL-${h.toLowerCase()}`);
    } else if (key === 'kind' || key === 'scope' || key === 'runtime') {
      out[key] = value.toLowerCase();
    } else if (key === 'per_file') {
      out[key] = BOOLEAN_WORDS.get(value.toLowerCase()) ?? value;
    } else {
      out[key] = value;
    }
  }
  return out;
}

export interface ParsedHeader {
  ok: boolean;
  header?: ScriptHeader;
  errors: string[];
}

export function parseScriptHeader(content: string): ParsedHeader {
  const fields = extractHeaderFields(content);
  if (fields === null) {
    return { ok: false, errors: [`missing ${HEADER_MARKER} header`] };
  }
  const coerced = coerce(fields);
  const result: ValidationResult = validateScriptHeader(coerced);
  if (!result.valid) {
    return { ok: false, errors: result.errors };
  }
  return { ok: true, header: coerced as unknown as ScriptHeader, errors: [] };
}
