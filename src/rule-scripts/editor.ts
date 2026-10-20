import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import { collectRuleFiles } from './analyzer.js';
import { loadRuleScriptMap } from './map.js';
import {
  embedRuleMarker,
  mintRuleId,
  parseRuleMarker,
  ruleTextHash,
  stripRuleMarker,
} from './rule-id.js';

function takenIds(projectRoot: string): Set<string> {
  const taken = new Set<string>();
  for (const r of loadRuleScriptMap(projectRoot)?.rules ?? []) {
    taken.add(r.id);
  }
  for (const r of loadRuleScriptMap(projectRoot)?.archived ?? []) {
    taken.add(r.id);
  }
  for (const rel of collectRuleFiles(projectRoot)) {
    for (const line of readFileSync(join(projectRoot, rel), 'utf8').split('\n')) {
      const id = parseRuleMarker(line);
      if (id) {
        taken.add(id);
      }
    }
  }
  return taken;
}

export function cleanRuleText(input: string): string {
  return input.trim().replace(/^[-*]\s+/, '');
}

export interface AddedRule {
  id: string;
  source: string;
  text: string;
  text_hash: string;
}

function assertRuleSource(sourceRel: string): void {
  const normalized = sourceRel.split('\\').join('/');
  if (!normalized.startsWith(`${PATHS.RULES_DIR}/`) || !normalized.endsWith('.md')) {
    throw new Error(
      `addRule: source must be a .md file under ${PATHS.RULES_DIR}/ (got "${sourceRel}")`,
    );
  }
}

export function addRule(projectRoot: string, sourceRel: string, text: string): AddedRule {
  assertRuleSource(sourceRel);
  const abs = join(projectRoot, sourceRel);
  const clean = cleanRuleText(text);
  const id = mintRuleId(sourceRel, clean, takenIds(projectRoot));
  const bullet = embedRuleMarker(`- ${clean}`, id);

  let existing = '';
  try {
    existing = readFileSync(abs, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
  const sep = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  writeFileSync(abs, `${existing}${sep}${bullet}\n`, 'utf8');
  return { id, source: sourceRel, text: clean, text_hash: ruleTextHash(clean) };
}

interface LocatedRule {
  source: string;
  line: number;
  lines: string[];
}

function locateRule(projectRoot: string, ruleId: string): LocatedRule | null {
  for (const rel of collectRuleFiles(projectRoot)) {
    const lines = readFileSync(join(projectRoot, rel), 'utf8').split('\n');
    const line = lines.findIndex((l) => parseRuleMarker(l) === ruleId);
    if (line >= 0) {
      return { source: rel, line, lines };
    }
  }
  return null;
}

export function editRuleText(
  projectRoot: string,
  ruleId: string,
  newText: string,
): { source: string } | null {
  const located = locateRule(projectRoot, ruleId);
  if (!located) {
    return null;
  }
  const original = located.lines[located.line];
  const indent = /^(\s*)/.exec(original)?.[1] ?? '';
  const marker = /^[-*]/.exec(stripRuleMarker(original).text.trim())?.[0] ?? '-';
  const clean = cleanRuleText(newText);
  located.lines[located.line] = embedRuleMarker(`${indent}${marker} ${clean}`, ruleId);
  writeFileSync(join(projectRoot, located.source), located.lines.join('\n'), 'utf8');
  return { source: located.source };
}

export function removeRuleBullet(projectRoot: string, ruleId: string): { source: string } | null {
  const located = locateRule(projectRoot, ruleId);
  if (!located) {
    return null;
  }
  located.lines.splice(located.line, 1);
  writeFileSync(join(projectRoot, located.source), located.lines.join('\n'), 'utf8');
  return { source: located.source };
}
