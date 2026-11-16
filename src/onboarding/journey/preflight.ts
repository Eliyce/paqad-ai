import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import { readRun } from './run-store.js';
import type { JourneyRun } from './types.js';

export interface PreflightInput {
  asked: boolean;
  fromTray: boolean;
  isTTY: boolean;
}

export type PreflightResult =
  | { kind: 'ok'; baseline: Record<string, string | null>; docs_baseline: Record<string, string> }
  | { kind: 'attach'; run: JourneyRun }
  | { kind: 'refused'; message: string; foreign_packets: string[] };

const OPEN_STATUSES = new Set(['running', 'paused', 'failed', 'abandoned']);

export function listPendingPackets(projectRoot: string): string[] {
  try {
    return readdirSync(join(projectRoot, PATHS.DECISIONS_PENDING_DIR))
      .filter((name) => !name.startsWith('.'))
      .sort();
  } catch {
    return [];
  }
}

export function fileSha256(path: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return null;
  }
}

export function dirtyPaths(projectRoot: string): string[] {
  let output: string;
  try {
    output = execFileSync('git', ['status', '--porcelain', '-z', '--untracked-files=all'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return [];
  }
  const entries = output.split('\0').filter((entry) => entry.length > 3);
  return entries.map((entry) => entry.slice(3));
}

export function baselineOfDirty(projectRoot: string): Record<string, string | null> {
  const baseline: Record<string, string | null> = {};
  for (const path of dirtyPaths(projectRoot)) baseline[path] = fileSha256(join(projectRoot, path));
  return baseline;
}

function walkFiles(root: string, rel: string): string[] {
  try {
    return readdirSync(join(root, rel), { withFileTypes: true }).flatMap((entry) => {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) return walkFiles(root, child);
      return entry.isFile() ? [child] : [];
    });
  } catch {
    return [];
  }
}

function docsFiles(projectRoot: string): string[] {
  try {
    const output = execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'docs'],
      { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return output.split('\0').filter((path) => path.startsWith('docs/'));
  } catch {
    return walkFiles(projectRoot, 'docs');
  }
}

export function docsBaseline(projectRoot: string): Record<string, string> {
  const baseline: Record<string, string> = {};
  for (const path of [...new Set(docsFiles(projectRoot))].sort()) {
    const hash = fileSha256(join(projectRoot, path));
    if (hash !== null) baseline[path] = hash;
  }
  return baseline;
}

export function runPreflight(projectRoot: string, input: PreflightInput): PreflightResult {
  const existing = readRun(projectRoot);
  if (existing && OPEN_STATUSES.has(existing.status)) return { kind: 'attach', run: existing };
  if (!input.isTTY && !input.asked && !input.fromTray) {
    return {
      kind: 'refused',
      message:
        'Ask the person which AI tools the team uses first, then pass --asked (or --from-tray from the plugin).',
      foreign_packets: [],
    };
  }
  const packets = listPendingPackets(projectRoot);
  if (packets.length > 0) {
    return {
      kind: 'refused',
      message: `Answer or close these pending decisions before onboarding starts (they are left as they are): ${packets.join(', ')}`,
      foreign_packets: packets,
    };
  }
  return {
    kind: 'ok',
    baseline: baselineOfDirty(projectRoot),
    docs_baseline: docsBaseline(projectRoot),
  };
}
