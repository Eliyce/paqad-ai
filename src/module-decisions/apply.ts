// Atomic apply path for module-map mutations.
// Issue #80, Phase 1 §4.6 — the single writer for module-map.yml going forward.
//
// Sequence (all-or-nothing on a best-effort basis):
//   1. Pre-mutation snapshot to .paqad/module-map/history/<ts>-<via>.yml
//   2. module-map.yml rewritten atomically (write-temp + rename)
//   3. Caller's decision record updated (handled by caller, via callback)
//   4. .paqad/module-map/events.jsonl appended
//
// The rename in step 2 is the atomic point. If steps 3-4 fail after the
// rename, the snapshot in step 1 lets the user (or the reconciler) roll back.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { toPosixPath } from '@/core/path-utils.js';

import { appendModuleMapEvent, type ModuleMapEvent } from './events.js';

export interface ApplyOptions {
  projectRoot: string;
  // The complete YAML string of the new module-map. Caller is responsible for
  // producing this (e.g. by mutating ModuleMap and calling serializeModuleMap).
  newMapYaml: string;
  // Free-form identifier of what triggered the apply (e.g. "MD-0001",
  // "reconciler:2026-05-28T12:00Z"). Used in the snapshot filename and the
  // event payload's `via` field.
  via: string;
  // Event details written after the rename.
  event: Omit<ModuleMapEvent, 'ts'>;
}

export interface ApplyResult {
  snapshot_path: string;
  applied_at: string;
}

function moduleMapPath(projectRoot: string): string {
  return join(projectRoot, PATHS.MODULE_MAP);
}

function historyDir(projectRoot: string): string {
  return join(projectRoot, PATHS.MODULE_MAP_HISTORY_DIR);
}

function sanitiseVia(via: string): string {
  return via.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
}

function timestampForFilename(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-');
}

// Snapshot the existing module-map.yml (if any) under
// .paqad/module-map/history/. Returns the snapshot path. If no module-map
// exists yet, an empty snapshot is written so the history is still complete.
export function snapshotModuleMap(
  projectRoot: string,
  via: string,
  now: Date = new Date(),
): string {
  const mapPath = moduleMapPath(projectRoot);
  const histDir = historyDir(projectRoot);
  mkdirSync(histDir, { recursive: true });
  const filename = `${timestampForFilename(now)}-${sanitiseVia(via)}.yml`;
  const snapPath = join(histDir, filename);
  const existing = existsSync(mapPath) ? readFileSync(mapPath, 'utf8') : '';
  writeFileSync(snapPath, existing, 'utf8');
  return toPosixPath(snapPath);
}

// Atomic write of the new module-map.yml via temp+rename. The temp file lives
// next to the destination so rename() stays on the same filesystem.
export function atomicWriteModuleMap(projectRoot: string, newMapYaml: string): void {
  const mapPath = moduleMapPath(projectRoot);
  mkdirSync(dirname(mapPath), { recursive: true });
  const tmpPath = `${mapPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, newMapYaml, 'utf8');
  renameSync(tmpPath, mapPath);
}

export function applyModuleMapMutation(opts: ApplyOptions): ApplyResult {
  const now = new Date();
  const snapshot = snapshotModuleMap(opts.projectRoot, opts.via, now);
  atomicWriteModuleMap(opts.projectRoot, opts.newMapYaml);
  appendModuleMapEvent(opts.projectRoot, {
    ts: now.toISOString(),
    ...opts.event,
  });
  return { snapshot_path: snapshot, applied_at: now.toISOString() };
}
