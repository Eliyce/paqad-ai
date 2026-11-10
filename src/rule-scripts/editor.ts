import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { renameWithRetrySync } from '@/core/fs/atomic-rename.js';

import { collectRuleFiles } from './analyzer.js';
import { loadRuleScriptMap } from './map.js';
import {
  embedRuleMarker,
  mintRuleId,
  parseRuleMarker,
  ruleTextHash,
  stripRuleMarker,
} from './rule-id.js';

export interface RuleWriteOptions {
  discovered?: string;
}

function writeRuleFile(abs: string, text: string): void {
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.tmp`;
  writeFileSync(tmp, text, 'utf8');
  renameWithRetrySync(tmp, abs);
}

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

export function addRule(
  projectRoot: string,
  sourceRel: string,
  text: string,
  options: RuleWriteOptions = {},
): AddedRule {
  assertRuleSource(sourceRel);
  const abs = join(projectRoot, sourceRel);
  const clean = cleanRuleText(text);
  const id = mintRuleId(sourceRel, clean, takenIds(projectRoot));
  const bullet = embedRuleMarker(`- ${clean}`, id, options.discovered);

  let existing = '';
  try {
    existing = readFileSync(abs, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
  const sep = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  writeRuleFile(abs, `${existing}${sep}${bullet}\n`);
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
  options: RuleWriteOptions = {},
): { source: string } | null {
  const located = locateRule(projectRoot, ruleId);
  if (!located) {
    return null;
  }
  const original = located.lines[located.line];
  const indent = /^(\s*)/.exec(original)?.[1] ?? '';
  const marker = /^[-*]/.exec(stripRuleMarker(original).text.trim())?.[0] ?? '-';
  const clean = cleanRuleText(newText);
  located.lines[located.line] = embedRuleMarker(
    `${indent}${marker} ${clean}`,
    ruleId,
    options.discovered,
  );
  writeRuleFile(join(projectRoot, located.source), located.lines.join('\n'));
  return { source: located.source };
}

export function removeRuleBullet(projectRoot: string, ruleId: string): { source: string } | null {
  const located = locateRule(projectRoot, ruleId);
  if (!located) {
    return null;
  }
  located.lines.splice(located.line, 1);
  writeRuleFile(join(projectRoot, located.source), located.lines.join('\n'));
  return { source: located.source };
}
