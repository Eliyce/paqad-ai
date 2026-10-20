import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execa } from 'execa';

import { parseJscpdJson } from '@/codebase-health/gather.js';
import type { DuplicationCluster } from '@/codebase-health/detectors.js';

export type JscpdLocationKey = string;

export function locationKey(file: string, startLine: number): JscpdLocationKey {
  return `${file.replace(/\\/g, '/')}:${startLine}`;
}

export function jscpdLocationKeys(clusters: DuplicationCluster[]): Set<JscpdLocationKey> {
  const keys = new Set<JscpdLocationKey>();
  for (const cluster of clusters) {
    for (const block of cluster.blocks) {
      keys.add(locationKey(block.file, block.start_line));
    }
  }
  return keys;
}

export function isCorroborated(
  file: string,
  lineStart: number,
  lineEnd: number,
  keys: Set<JscpdLocationKey>,
): boolean {
  const normalized = file.replace(/\\/g, '/');
  for (let line = lineStart; line <= lineEnd; line += 1) {
    if (keys.has(`${normalized}:${line}`)) {
      return true;
    }
  }
  return false;
}

export async function corroborateWithJscpd(options: {
  projectRoot: string;
  changedFiles: string[];
}): Promise<Set<JscpdLocationKey>> {
  const { projectRoot, changedFiles } = options;
  if (changedFiles.length === 0) {
    return new Set();
  }
  try {
    const outDir = mkdtempSync(join(tmpdir(), 'paqad-jscpd-'));
    await execa('jscpd', ['--silent', '--reporters', 'json', '--output', outDir, ...changedFiles], {
      cwd: projectRoot,
      reject: false,
    });
    return jscpdLocationKeys(readReport(join(outDir, 'jscpd-report.json')));
  } catch {
    return new Set();
  }
}

function readReport(path: string): DuplicationCluster[] {
  /* c8 ignore start -- reached only when jscpd is installed and actually runs; the CI image has
     no jscpd on PATH, so the spawn above throws before this and the report is never written. */
  try {
    return parseJscpdJson(readFileSync(path, 'utf8'));
  } catch {
    return [];
  }
  /* c8 ignore stop */
}
