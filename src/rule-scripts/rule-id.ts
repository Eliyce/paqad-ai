import { createHash } from 'node:crypto';

const ID_PREFIX = 'RL-';
const MIN_HEX = 4;
const MAX_HEX = 12;

const MARKER_RE = /<!--\s*@rule\s+(RL-[0-9a-f]+)(?:\s+discovered:([A-Za-z0-9._-]+))?\s*-->/i;

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function ruleTextHash(text: string): string {
  return sha256(text);
}

export function parseRuleMarker(line: string): string | null {
  const m = MARKER_RE.exec(line);
  if (!m) {
    return null;
  }
  return `${ID_PREFIX}${m[1].slice(ID_PREFIX.length).toLowerCase()}`;
}

export function parseRuleMarkerRun(line: string): string | null {
  return MARKER_RE.exec(line)?.[2] ?? null;
}

export function stripRuleMarker(line: string): { text: string; id: string | null } {
  const id = parseRuleMarker(line);
  const text = line.replace(MARKER_RE, '').trimEnd();
  return { text, id };
}

export function embedRuleMarker(line: string, id: string, discovered?: string): string {
  const existing = parseRuleMarker(line);
  if (existing === id && (discovered === undefined || parseRuleMarkerRun(line) === discovered)) {
    return line;
  }
  const clean = line.replace(MARKER_RE, '').trimEnd();
  const run = discovered === undefined ? '' : ` discovered:${discovered}`;
  return `${clean} <!-- @rule ${id}${run} -->`;
}

export function mintRuleId(source: string, text: string, takenIds: ReadonlySet<string>): string {
  const digest = sha256(`${source}\x00${text}`);
  for (let len = MIN_HEX; len <= MAX_HEX; len++) {
    const candidate = `${ID_PREFIX}${digest.slice(0, len)}`;
    if (!takenIds.has(candidate)) {
      return candidate;
    }
  }
  return `${ID_PREFIX}${digest}`;
}

export function isRuleId(value: string): boolean {
  return /^RL-[0-9a-f]{4,}$/i.test(value);
}
