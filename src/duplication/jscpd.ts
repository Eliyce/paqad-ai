// Optional jscpd corroboration for the duplication detector (issue #358, FR-7).
//
// jscpd (MIT, self-contained) is a second, independent copy-paste detector. When it is on PATH
// we run it diff-scoped over the changed files and mark any duplication finding at the same
// location `corroborated: true`. Its absence changes nothing — the detector's own findings
// stand on their own. The JSON parse reuses the codebase-health workflow's `parseJscpdJson`
// (RULE-13: one canonical parser), so the two consumers can never diverge on jscpd's shape.

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execa } from 'execa';

import { parseJscpdJson } from '@/codebase-health/gather.js';
import type { DuplicationCluster } from '@/codebase-health/detectors.js';

/** A location key `file:startLine` a jscpd block covers, for finding corroboration. */
export type JscpdLocationKey = string;

/** Build the corroboration key for a file + line. Forward-slash normalized. */
export function locationKey(file: string, startLine: number): JscpdLocationKey {
  return `${file.replace(/\\/g, '/')}:${startLine}`;
}

/**
 * The set of `file:startLine` keys every jscpd block covers. Pure over already-parsed clusters
 * so it is fully fixture-tested without spawning jscpd.
 */
export function jscpdLocationKeys(clusters: DuplicationCluster[]): Set<JscpdLocationKey> {
  const keys = new Set<JscpdLocationKey>();
  for (const cluster of clusters) {
    for (const block of cluster.blocks) {
      keys.add(locationKey(block.file, block.start_line));
    }
  }
  return keys;
}

/**
 * True when a finding's location overlaps any jscpd block. A block corroborates when it is in
 * the same file and its start line falls within the finding's line span (jscpd reports the
 * clone's start, which lands inside the new code's range).
 */
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

/**
 * Run jscpd diff-scoped over `changedFiles` and return its corroboration keys, or an empty set
 * when jscpd is not on PATH or the run fails. Best-effort by contract (FR-7): every failure
 * degrades to "no corroboration", never a throw.
 */
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
    // jscpd may exit non-zero (e.g. when it finds clones under a threshold), but it still writes
    // the report; read it regardless of exit code, and let readReport degrade if it is absent.
    await execa('jscpd', ['--silent', '--reporters', 'json', '--output', outDir, ...changedFiles], {
      cwd: projectRoot,
      reject: false,
    });
    return jscpdLocationKeys(readReport(join(outDir, 'jscpd-report.json')));
  } catch {
    return new Set();
  }
}

/** Read + parse a jscpd JSON report, or empty on any read/parse failure. */
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
