// Deterministic markdown rule-file parsing + marker embedding (issue #89).
//
// A "rule" is a markdown list bullet under docs/instructions/rules/** that is
// not inside a fenced code block. The rule-analyzer skill calls embedRuleIds()
// to assign + persist stable ids before classifying each rule. Re-running is
// idempotent: bullets that already carry a marker keep their id and produce no
// text churn.

import { embedRuleMarker, mintRuleId, ruleTextHash, stripRuleMarker } from './rule-id.js';

const BULLET_RE = /^(\s*)([-*])\s+(\S.*)$/;
const FENCE_RE = /^\s*(```|~~~)/;

export interface ParsedRule {
  // 0-based line index within the file.
  line: number;
  indent: string;
  // Clean rule text with any marker stripped and trailing whitespace removed.
  text: string;
  text_hash: string;
  // Existing id from the marker, or null when the bullet is unmarked.
  id: string | null;
}

// Parse a rule file into its rule bullets, skipping fenced code blocks.
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
    // Re-strip the bullet prefix from the cleaned text to get just the rule.
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
  // Ids present in the file after embedding, in document order.
  rules: { id: string; text: string; text_hash: string; isNew: boolean }[];
}

// Assign stable ids to every unmarked bullet and return the rewritten file
// content. `takenIds` seeds collision avoidance across the whole project so
// ids stay unique beyond a single file. The set is mutated with newly minted
// ids so callers can chain files.
export function embedRuleIds(
  source: string,
  content: string,
  takenIds: Set<string>,
): EmbedResult {
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
