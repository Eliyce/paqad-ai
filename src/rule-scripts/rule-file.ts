import { embedRuleMarker, mintRuleId, ruleTextHash, stripRuleMarker } from './rule-id.js';

const BULLET_RE = /^(\s*)([-*])\s+(\S.*)$/;
const FENCE_RE = /^\s*(```|~~~)/;

export interface ParsedRule {
  line: number;
  indent: string;
  text: string;
  text_hash: string;
  id: string | null;
}

export function parseRuleFile(content: string): ParsedRule[] {
  const lines = content.split('\n');
  const rules: ParsedRule[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    const m = BULLET_RE.exec(line);
    if (!m) {
      continue;
    }
    const { text, id } = stripRuleMarker(line);
    const bulletBody = stripRuleMarker(m[3]).text;
    rules.push({
      line: i,
      indent: m[1],
      text: bulletBody,
      text_hash: ruleTextHash(bulletBody),
      id,
    });
    void text;
  }

  return rules;
}

export interface EmbedResult {
  content: string;
  rules: { id: string; text: string; text_hash: string; isNew: boolean }[];
}

export function embedRuleIds(source: string, content: string, takenIds: Set<string>): EmbedResult {
  const lines = content.split('\n');
  const parsed = parseRuleFile(content);
  const rules: EmbedResult['rules'] = [];

  for (const rule of parsed) {
    let id = rule.id;
    const isNew = id === null;
    if (id === null) {
      id = mintRuleId(source, rule.text, takenIds);
    }
    takenIds.add(id);
    lines[rule.line] = embedRuleMarker(lines[rule.line], id);
    rules.push({ id, text: rule.text, text_hash: rule.text_hash, isNew });
  }

  return { content: lines.join('\n'), rules };
}
