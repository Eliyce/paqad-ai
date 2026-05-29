// Retrospective drift detector for rules-as-scripts (issue #89, Phase 4).
//
// Mirrors src/module-map/reconciler.ts. Compares rule-script-map.yml against the
// rule markdown on disk + the registered scripts, emits RS-* findings into
// .paqad/scripts/rules/.cache/drift.json, and reports whether planning is
// blocked. Read-only — never embeds markers or mutates the map (that is the
// rule-analyzer / rule-editor job).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import { collectRuleFiles, computeRuleFilesHash } from './analyzer.js';
import { runFixtures } from './fixture-runner.js';
import { loadRuleScriptMap } from './map.js';
import { readReport } from './runner.js';
import { parseRuleFile } from './rule-file.js';

export type RuleScriptFindingCode =
  | 'RS-RULE-ADDED'
  | 'RS-RULE-EDITED'
  | 'RS-RULE-REMOVED'
  | 'RS-SCRIPT-STALE'
  | 'RS-FIXTURE-FAIL'
  | 'RS-CACHE-INVALID';

export interface RuleScriptDriftFinding {
  code: RuleScriptFindingCode;
  rule_id?: string;
  source?: string;
  message: string;
}

export interface RuleScriptDriftReport {
  generated_at: string;
  findings: RuleScriptDriftFinding[];
  counts: Record<RuleScriptFindingCode, number>;
  // Any of the drift codes (except cache-invalid) gates planning per
  // escalation.rule_scripts_stale.
  blocked: boolean;
}

function emptyCounts(): Record<RuleScriptFindingCode, number> {
  return {
    'RS-RULE-ADDED': 0,
    'RS-RULE-EDITED': 0,
    'RS-RULE-REMOVED': 0,
    'RS-SCRIPT-STALE': 0,
    'RS-FIXTURE-FAIL': 0,
    'RS-CACHE-INVALID': 0,
  };
}

function driftPath(projectRoot: string): string {
  return join(projectRoot, PATHS.RULE_SCRIPTS_DRIFT);
}

export function reconcileRuleScripts(projectRoot: string): RuleScriptDriftReport {
  const now = new Date().toISOString();
  const findings: RuleScriptDriftFinding[] = [];
  const map = loadRuleScriptMap(projectRoot);

  // On-disk inventory (read-only — no marker embedding).
  const files = collectRuleFiles(projectRoot);
  const onDisk = new Map<string, { source: string; text_hash: string }>();
  for (const rel of files) {
    const parsed = parseRuleFile(readFileSync(join(projectRoot, rel), 'utf8'));
    for (const rule of parsed) {
      if (rule.id === null) {
        findings.push({
          code: 'RS-RULE-ADDED',
          source: rel,
          message: `Unmarked rule bullet in ${rel}: "${rule.text}". Run \`analyze rules\`.`,
        });
        continue;
      }
      onDisk.set(rule.id, { source: rel, text_hash: rule.text_hash });
    }
  }

  const mapById = new Map((map?.rules ?? []).map((r) => [r.id, r]));

  // RS-RULE-EDITED + RS-SCRIPT-STALE: marker present, text changed.
  for (const [id, disk] of onDisk) {
    const entry = mapById.get(id);
    if (!entry) {
      // Marked on disk but not in the map — treat as an ungated addition.
      findings.push({
        code: 'RS-RULE-ADDED',
        rule_id: id,
        source: disk.source,
        message: `Rule ${id} is marked on disk but absent from the map. Run \`analyze rules\`.`,
      });
      continue;
    }
    if (entry.text_hash !== disk.text_hash) {
      findings.push({
        code: 'RS-RULE-EDITED',
        rule_id: id,
        source: disk.source,
        message: `Rule ${id} text changed since the map was written. Run \`edit rule ${id}\` or \`generate rule scripts\`.`,
      });
      if (entry.scripts.length > 0) {
        findings.push({
          code: 'RS-SCRIPT-STALE',
          rule_id: id,
          source: disk.source,
          message: `Rule ${id} was edited but its ${entry.scripts.length} script(s) were not regenerated.`,
        });
      }
    }
  }

  // RS-RULE-REMOVED: in the map but no marker on disk.
  for (const entry of map?.rules ?? []) {
    if (!onDisk.has(entry.id)) {
      findings.push({
        code: 'RS-RULE-REMOVED',
        rule_id: entry.id,
        source: entry.source,
        message: `Rule ${entry.id} is in the map but its marker is gone from ${entry.source}. Run \`remove rule ${entry.id}\`.`,
      });
    }
  }

  // RS-FIXTURE-FAIL: a registered script no longer passes its own fixtures.
  for (const entry of map?.rules ?? []) {
    for (const script of entry.scripts) {
      const abs = join(projectRoot, script.path);
      if (!existsSync(abs)) {
        continue;
      }
      const result = runFixtures(abs);
      if (!result.passed) {
        findings.push({
          code: 'RS-FIXTURE-FAIL',
          rule_id: entry.id,
          source: script.path,
          message: `Script ${script.path} no longer passes its fixtures. Run \`regenerate scripts for rule ${entry.id}\`.`,
        });
      }
    }
  }

  // RS-CACHE-INVALID: a findings report exists but its rule_files_hash no longer
  // reconciles with the current rule files.
  const report = readReport(projectRoot);
  if (report && files.length > 0) {
    const currentHash = computeRuleFilesHash(projectRoot, files);
    if (report.rule_files_hash && report.rule_files_hash !== currentHash) {
      findings.push({
        code: 'RS-CACHE-INVALID',
        message:
          'Cached findings report is stale (rule_files_hash mismatch). It will be recomputed.',
      });
    }
  }

  const counts = emptyCounts();
  for (const f of findings) {
    counts[f.code]++;
  }
  const blocked = findings.some((f) => f.code !== 'RS-CACHE-INVALID');

  const driftReport: RuleScriptDriftReport = { generated_at: now, findings, counts, blocked };
  writeDrift(projectRoot, driftReport);
  return driftReport;
}

function writeDrift(projectRoot: string, report: RuleScriptDriftReport): void {
  const path = driftPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
