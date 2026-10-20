import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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
  | 'RS-CONFLICT'
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
  blocked: boolean;
}

function emptyCounts(): Record<RuleScriptFindingCode, number> {
  return {
    'RS-RULE-ADDED': 0,
    'RS-RULE-EDITED': 0,
    'RS-RULE-REMOVED': 0,
    'RS-SCRIPT-STALE': 0,
    'RS-FIXTURE-FAIL': 0,
    'RS-CONFLICT': 0,
    'RS-CACHE-INVALID': 0,
  };
}

function driftPath(projectRoot: string): string {
  return join(projectRoot, PATHS.RULE_SCRIPTS_DRIFT);
}

const CONFLICT_CODES: ReadonlySet<RuleScriptFindingCode> = new Set(['RS-CONFLICT']);

function mergeDrift(
  projectRoot: string,
  ownedCodes: ReadonlySet<RuleScriptFindingCode>,
  ownFindings: RuleScriptDriftFinding[],
): RuleScriptDriftReport {
  const path = driftPath(projectRoot);
  if (existsSync(path) && readDrift(projectRoot) === null) {
    try {
      renameSync(path, `${path}.corrupt-${Date.now()}`);
    } catch {}
  }
  const existing = readDrift(projectRoot);
  const preserved = (existing?.findings ?? []).filter((f) => !ownedCodes.has(f.code));
  const findings = [...preserved, ...ownFindings];
  const counts = emptyCounts();
  for (const f of findings) {
    counts[f.code]++;
  }
  const report: RuleScriptDriftReport = {
    generated_at: new Date().toISOString(),
    findings,
    counts,
    blocked: findings.some((f) => f.code !== 'RS-CACHE-INVALID'),
  };
  writeDrift(projectRoot, report);
  return report;
}

export function reconcileRuleScripts(projectRoot: string): RuleScriptDriftReport {
  const findings: RuleScriptDriftFinding[] = [];
  const map = loadRuleScriptMap(projectRoot);

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

  for (const [id, disk] of onDisk) {
    const entry = mapById.get(id);
    if (!entry) {
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

  const report = readReport(projectRoot);
  if (report && files.length > 0 && findings.length === 0) {
    const currentHash = computeRuleFilesHash(projectRoot, files);
    if (report.rule_files_hash && report.rule_files_hash !== currentHash) {
      findings.push({
        code: 'RS-CACHE-INVALID',
        message:
          'Cached findings report is stale (rule_files_hash mismatch). It will be recomputed.',
      });
    }
  }

  const reconcilerOwned = new Set(
    (Object.keys(emptyCounts()) as RuleScriptFindingCode[]).filter((c) => !CONFLICT_CODES.has(c)),
  );
  return mergeDrift(projectRoot, reconcilerOwned, findings);
}

function writeDrift(projectRoot: string, report: RuleScriptDriftReport): void {
  const path = driftPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

export function readDrift(projectRoot: string): RuleScriptDriftReport | null {
  const path = driftPath(projectRoot);
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as RuleScriptDriftReport;
  } catch {
    return null;
  }
}

export interface RuleConflict {
  rule_ids: string[];
  message: string;
}

export function recordConflictFindings(
  projectRoot: string,
  conflicts: RuleConflict[],
): RuleScriptDriftReport {
  const findings: RuleScriptDriftFinding[] = conflicts
    .filter((c) => Array.isArray(c.rule_ids) && c.rule_ids.length > 0)
    .map((c) => ({
      code: 'RS-CONFLICT' as const,
      rule_id: c.rule_ids[0],
      message: `${c.message} (conflicting rules: ${c.rule_ids.join(', ')})`,
    }));
  return mergeDrift(projectRoot, CONFLICT_CODES, findings);
}
