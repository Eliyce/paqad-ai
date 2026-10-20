import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { toPosixPath } from '@/core/path-utils.js';

import { appendModuleMapEvent, type ModuleMapEvent } from './events.js';

export interface ApplyOptions {
  projectRoot: string;
  newMapYaml: string;
  via: string;
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
