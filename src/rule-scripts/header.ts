// Parse + validate the comment header every rule script carries (issue #89).
//
//   // @paqad-rule-script
//   // rule_id: RL-7f3a
//   // source: docs/instructions/rules/coding/code-quality.md
//   // kind: deterministic
//   // scope: changed-files
//   // runtime: node
//   // requires: {"node":">=22","binaries":["git"]}
//   // last_validated_at: 2026-05-29T...
//   // false_positive_surface: "Hook files that legitimately call services."
//
// The header is validated against schemas/script-header.schema.json before the
// script is ever run against real code.

import { validateScriptHeader, type ValidationResult } from './validate.js';

export const HEADER_MARKER = '@paqad-rule-script';

export interface ScriptHeader {
  rule_id: string;
  source: string;
  kind: 'deterministic' | 'heuristic';
  scope: 'changed-files' | 'whole-tree' | 'git-diff' | 'git-history';
  runtime: 'node';
  requires?: { node?: string; binaries?: string[] };
  last_validated_at?: string;
  false_positive_surface?: string;
}

const HEADER_LINE_RE = /^\s*\/\/\s*([a-z_]+)\s*:\s*(.*)$/;

// Extract the raw key/value pairs from the leading comment block. Blank lines
// (including a bare `//` visual separator) are tolerated within the block;
// parsing stops only at the first line that is neither a comment nor blank
// (i.e. the start of real code). This matches how humans and LLMs format
// headers — a blank line after the marker must not abort the parse (D-2).
export function extractHeaderFields(content: string): Record<string, string> | null {
  const lines = content.split('\n');
  let sawMarker = false;
  const fields: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') {
      // Blank lines never terminate the header block.
      continue;
    }
    if (!trimmed.startsWith('//')) {
      // First line of real code — the header block is over.
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

// Coerce raw string fields into the typed header shape. `requires` is parsed as
// JSON; quoted scalar values are unquoted.
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
    // Canonicalise case so hand-edited headers still validate against the
    // lowercase-only schema enums: the id's hex, and the closed-set fields.
    if (key === 'rule_id') {
      out[key] = value.replace(/^RL-([0-9a-fA-F]+)$/, (_, h) => `RL-${h.toLowerCase()}`);
    } else if (key === 'kind' || key === 'scope' || key === 'runtime') {
      out[key] = value.toLowerCase();
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
