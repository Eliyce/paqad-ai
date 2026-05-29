// Deterministic markdown edits behind the rule-editor skill (issue #89, Phase 4).
//
// The skill owns orchestration (re-classify, regenerate scripts, surface diffs
// via the Decision Pause Contract). This module owns the file mechanics: add a
// bullet with a fresh stable id, edit a bullet's text by id (preserving the id),
// or remove a bullet by id. Map mutations go through src/rule-scripts/apply.ts.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { collectRuleFiles } from './analyzer.js';
import { loadRuleScriptMap } from './map.js';
import { embedRuleMarker, mintRuleId, parseRuleMarker, stripRuleMarker } from './rule-id.js';

// Every id already in use across the map and the on-disk markers, so a freshly
// minted id can never collide.
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

// Normalise raw rule input into the canonical bullet body (no leading marker,
// no surrounding whitespace). The single source of truth for "what text the
// hash is computed over" — shared with the rule-editor .mjs wrapper so the
// on-disk text and the map's text_hash can never drift apart.
export function cleanRuleText(input: string): string {
  return input.trim().replace(/^[-*]\s+/, '');
}

// Append a new rule bullet with a fresh marker to a rule file. Creates the file
// with a trailing newline if it does not yet exist. Returns the minted id.
export function addRule(projectRoot: string, sourceRel: string, text: string): { id: string } {
  const abs = join(projectRoot, sourceRel);
  const clean = cleanRuleText(text);
  const id = mintRuleId(sourceRel, clean, takenIds(projectRoot));
  const bullet = embedRuleMarker(`- ${clean}`, id);

  const existing = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
  const sep = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  writeFileSync(abs, `${existing}${sep}${bullet}\n`, 'utf8');
  return { id };
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

// Replace a rule's text in place, preserving its id marker. Returns the source
// file the rule lived in, or null when the id is not found on disk.
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

// Remove a rule bullet from its file by id. Returns the source file, or null
// when the id is not found on disk.
export function removeRuleBullet(projectRoot: string, ruleId: string): { source: string } | null {
  const located = locateRule(projectRoot, ruleId);
  if (!located) {
    return null;
  }
  located.lines.splice(located.line, 1);
  writeFileSync(join(projectRoot, located.source), located.lines.join('\n'), 'utf8');
  return { source: located.source };
}
