// The production HealthGatherer: wires the real world (StackIntrospector, the
// code-knowledge index, and shell-outs to osv-scanner / gitleaks / jscpd / git).
// This file is excluded from coverage (like the pentest engine) because its work
// is real subprocesses and fs the unit suite cannot exercise; the pure logic it
// composes (parsers, detectors, assembly) is fully covered on its own. The
// orchestration around it (`runHealthAudit`) is covered via an injected fake.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import fg from 'fast-glob';

import { PATHS } from '@/core/constants/paths.js';
import { toPosixPath } from '@/core/path-utils.js';
import { StackIntrospector } from '@/introspection/stack-introspector.js';
import { readCodeKnowledgeIndex } from '@/code-knowledge/store.js';
import { queryOsv } from '@/pentest/osv.js';
import { createDeliveryShell } from '@/delivery/shell.js';
import type { DeliveryShell } from '@/delivery/runner.js';
import type { InstalledPackage } from '@/core/types/introspection.js';
import type { HealthBlockedCheck } from '@/core/types/codebase-health.js';

import type { DuplicationCluster } from './detectors.js';
import {
  builtinSecretScan,
  gatherStaleDocCandidates,
  parseGitleaksJson,
  parseJscpdJson,
  parseNpmAuditJson,
  parseOsvScannerJson,
  type DocTimestampInput,
} from './gather.js';
import type { HealthGatherer } from './run.js';
import { HEALTH_TOOLS, healthToolSpec, isToolAvailable, resolveToolAvailability } from './tools.js';

/** Wire the real world: StackIntrospector, code-knowledge index, and shell-outs. */
export function createHealthGatherer(
  projectRoot: string,
  shell: DeliveryShell = createDeliveryShell(projectRoot),
): HealthGatherer {
  const availability = resolveToolAvailability();
  let packagesCache: InstalledPackage[] | null = null;

  async function packages(): Promise<InstalledPackage[]> {
    if (packagesCache) return packagesCache;
    const snapshot = await new StackIntrospector().snapshot(projectRoot, { persist: false });
    packagesCache = snapshot.packages;
    return packagesCache;
  }

  return {
    availability: () => availability,
    async stack() {
      const snapshot = await new StackIntrospector().snapshot(projectRoot, { persist: false });
      packagesCache = snapshot.packages;
      return {
        primary:
          snapshot.profile.frameworks[0] ?? snapshot.profile.toolchains[0]?.ecosystem ?? 'unknown',
        traits: snapshot.profile.traits,
        toolchains: snapshot.toolchains.map((toolchain) => toolchain.ecosystem),
      };
    },
    loadIndex: () => readCodeKnowledgeIndex(projectRoot),
    async vulnerabilities(offline) {
      if (isToolAvailable(availability, 'osv-scanner')) {
        const result = await shell.run('osv-scanner', ['--format', 'json', '--recursive', '.']);
        return { records: parseOsvScannerJson(result.stdout), blocked: [] };
      }
      if (offline) {
        return {
          records: [],
          blocked: [
            blockedFor(
              'vulnerable-dependency',
              'osv-scanner is not on PATH and the run is offline',
            ),
          ],
        };
      }
      const audit = await shell.run('npm', ['audit', '--json']);
      const nativeRecords = parseNpmAuditJson(audit.stdout);
      if (nativeRecords.length > 0) return { records: nativeRecords, blocked: [] };
      return { records: await queryOsv(await packages()), blocked: [] };
    },
    async secrets() {
      if (isToolAvailable(availability, 'gitleaks')) {
        const result = await shell.run('gitleaks', [
          'detect',
          '--no-banner',
          '--report-format',
          'json',
          '--report-path',
          '/dev/stdout',
        ]);
        return { matches: parseGitleaksJson(result.stdout) };
      }
      return { matches: builtinSecretScan(await trackedFileContents(projectRoot, shell)) };
    },
    async duplication() {
      if (!isToolAvailable(availability, 'jscpd')) {
        return { clusters: [], blocked: [blockedFor('duplication', 'jscpd is not on PATH')] };
      }
      const outDir = join(PATHS.HEALTH_RUNS_DIR, 'jscpd');
      await shell.run('jscpd', ['--silent', '--reporters', 'json', '--output', outDir, '.']);
      const clusters = readJscpdReport(join(projectRoot, outDir, 'jscpd-report.json'));
      return { clusters, blocked: [] };
    },
    async deprecations(offline) {
      if (offline) {
        return {
          records: [],
          blocked: [
            blockedFor(
              'deprecated-dependency',
              'deprecation checks need the network; the run is offline',
            ),
          ],
        };
      }
      return {
        records: [],
        blocked: [blockedFor('deprecated-dependency', 'no deprecation source configured')],
      };
    },
    async staleDocs() {
      return gatherStaleDocCandidates(await docTimestampInputs(projectRoot, shell));
    },
  };
}

function blockedFor(category: string, reason: string): HealthBlockedCheck {
  const spec = HEALTH_TOOLS.find((tool) => tool.used_for.includes(category as never));
  const hint =
    category === 'deprecated-dependency'
      ? 'Run online (drop --offline) to check the registry for deprecations.'
      : (spec?.install_hint ?? healthToolSpec(category)?.install_hint ?? 'No fallback available.');
  return { check: category, reason, install_hint: hint };
}

function readJscpdReport(path: string): DuplicationCluster[] {
  try {
    return parseJscpdJson(readFileSync(path, 'utf8'));
  } catch {
    return [];
  }
}

async function trackedFileContents(
  projectRoot: string,
  shell: DeliveryShell,
): Promise<Array<{ path: string; content: string }>> {
  const listed = await shell.run('git', ['ls-files']);
  const files = listed.stdout.split('\n').filter(Boolean).slice(0, 5000);
  const out: Array<{ path: string; content: string }> = [];
  for (const file of files) {
    try {
      out.push({ path: toPosixPath(file), content: readFileSync(join(projectRoot, file), 'utf8') });
    } catch {
      // unreadable / binary — skip
    }
  }
  return out;
}

async function docTimestampInputs(
  projectRoot: string,
  shell: DeliveryShell,
): Promise<DocTimestampInput[]> {
  const docs = await fg('docs/**/*.md', { cwd: projectRoot, dot: false });
  const inputs: DocTimestampInput[] = [];
  for (const doc of docs) {
    const docCommittedAt = await lastCommitEpoch(shell, doc);
    if (docCommittedAt === null) continue;
    const content = safeRead(join(projectRoot, doc));
    const references = extractReferencedSources(content, projectRoot);
    const withTimes = await Promise.all(
      references.map(async (source) => ({
        source,
        committed_at: await lastCommitEpoch(shell, source),
      })),
    );
    inputs.push({ doc: toPosixPath(doc), doc_committed_at: docCommittedAt, references: withTimes });
  }
  return inputs;
}

function extractReferencedSources(content: string, projectRoot: string): string[] {
  const found = new Set<string>();
  const pattern = /(?:src|runtime|scripts)\/[A-Za-z0-9_./-]+\.[a-z]{2,4}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const rel = match[0];
    try {
      readFileSync(join(projectRoot, rel), 'utf8');
      found.add(rel);
    } catch {
      // referenced path no longer exists — skip
    }
  }
  return [...found].slice(0, 20);
}

async function lastCommitEpoch(shell: DeliveryShell, path: string): Promise<number | null> {
  const result = await shell.run('git', ['log', '-1', '--format=%ct', '--', path]);
  const epoch = Number.parseInt(result.stdout.trim(), 10);
  return Number.isFinite(epoch) && epoch > 0 ? epoch : null;
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}
