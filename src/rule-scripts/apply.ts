// Atomic apply path for rule-script-map mutations (issue #89).
//
// Mirrors src/module-decisions/apply.ts: this is the single writer of
// rule-script-map.yml. There is no lockfile — atomicity is the rename in
// step 2, and the pre-mutation snapshot in step 1 enables rollback.
//
// Sequence:
//   1. Pre-mutation snapshot to .paqad/scripts/rules/.history/<ts>-<via>.yml
//   2. rule-script-map.yml rewritten atomically (write-temp + rename)
//   3. .paqad/scripts/rules/.history/events.jsonl appended

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { toPosixPath } from '@/core/path-utils.js';
import { writeCapabilityDigest } from '@/kernel/capability-lock.js';

import { computeRuleScriptsDigest } from './integrity.js';
import { ruleScriptMapPath, serializeRuleScriptMap } from './map.js';
import type { RuleScriptMap } from './types.js';

export interface RuleScriptMapEvent {
  ts: string;
  via: string;
  action: 'analyze' | 'generate' | 'edit' | 'remove' | 'downgrade' | 'reconcile';
  rule_ids: string[];
  note?: string;
}

export interface ApplyRuleScriptMapOptions {
  projectRoot: string;
  map: RuleScriptMap;
  // Identifier of what triggered the apply (e.g. "rule-analyzer",
  // "rule-editor:RL-7f3a"). Used in the snapshot filename and event payload.
  via: string;
  event: Omit<RuleScriptMapEvent, 'ts' | 'via'>;
}

export interface ApplyRuleScriptMapResult {
  snapshot_path: string;
  applied_at: string;
}

function historyDir(projectRoot: string): string {
  return join(projectRoot, PATHS.RULE_SCRIPT_MAP_HISTORY_DIR);
}

function eventsLog(projectRoot: string): string {
  return join(projectRoot, PATHS.RULE_SCRIPT_MAP_EVENTS_LOG);
}

function sanitiseVia(via: string): string {
  return via.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
}

function timestampForFilename(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-');
}

// Monotonic per-process counter so two snapshots in the same millisecond with
// the same `via` don't collide and overwrite each other (D-3).
let snapshotSeq = 0;

export function snapshotRuleScriptMap(
  projectRoot: string,
  via: string,
  now: Date = new Date(),
): string {
  const mapPath = ruleScriptMapPath(projectRoot);
  const histDir = historyDir(projectRoot);
  mkdirSync(histDir, { recursive: true });
  const unique = `${process.pid}-${(snapshotSeq++).toString(36)}`;
  const snapPath = join(histDir, `${timestampForFilename(now)}-${sanitiseVia(via)}-${unique}.yml`);
  const existing = existsSync(mapPath) ? readFileSync(mapPath, 'utf8') : '';
  writeFileSync(snapPath, existing, 'utf8');
  return toPosixPath(snapPath);
}

export function atomicWriteRuleScriptMap(projectRoot: string, yaml: string): void {
  const mapPath = ruleScriptMapPath(projectRoot);
  mkdirSync(dirname(mapPath), { recursive: true });
  const tmpPath = `${mapPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, yaml, 'utf8');
  renameSync(tmpPath, mapPath);
}

function appendEvent(projectRoot: string, event: RuleScriptMapEvent): void {
  const log = eventsLog(projectRoot);
  mkdirSync(dirname(log), { recursive: true });
  appendFileSync(log, `${JSON.stringify(event)}\n`, 'utf8');
}

export function applyRuleScriptMap(opts: ApplyRuleScriptMapOptions): ApplyRuleScriptMapResult {
  const now = new Date();
  const snapshot = snapshotRuleScriptMap(opts.projectRoot, opts.via, now);
  atomicWriteRuleScriptMap(opts.projectRoot, serializeRuleScriptMap(opts.map));
  appendEvent(opts.projectRoot, {
    ts: now.toISOString(),
    via: opts.via,
    ...opts.event,
  });
  // Buildout F5 (decision D1, audit) — bless the new state in the capability lock
  // so the enforcement seam can later detect a hand-edit. Computed from the
  // just-written map + its referenced scripts (the on-disk blessed state). A
  // null digest (no map after write) is impossible here but skipped defensively.
  const digest = computeRuleScriptsDigest(opts.projectRoot);
  if (digest !== null) {
    writeCapabilityDigest(opts.projectRoot, 'rule-scripts', digest, now);
  }
  return { snapshot_path: snapshot, applied_at: now.toISOString() };
}
