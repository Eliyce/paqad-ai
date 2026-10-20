import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import fg from 'fast-glob';

import { scanImports } from '@/graph/import-scanner.js';
import { discoverSourceRoots } from '@/module-map/source-roots.js';
import { readGitChangedFiles } from '@/pipeline/change-evidence.js';
import type { ComplianceReport } from '@/compliance/types.js';
import type { VerificationEvidence } from '@/core/types/verification-evidence.js';
import { VERIFICATION_EVIDENCE_RELATIVE_PATH } from '@/verification/evidence.js';
import { toPosixPath } from '@/core/path-utils.js';
import type { Lane } from '@/core/types/routing.js';
import type {
  BuildTraceabilityMapInput,
  CodeMarker,
  DeliveryEntry,
  ProofEntry,
  PromiseRef,
} from '@/core/types/traceability.js';

const SOURCE_GLOBS = ['.ts', '.tsx'];
const SOURCE_EXCLUDES = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/.paqad/**',
  '**/coverage/**',
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/tests/**',
];

const CODE_MARKER_PATTERN = /@(?:obligation|ac)\s+([A-Z][A-Z0-9._-]*)\b/g;

export interface GatherOptions {
  projectRoot: string;
  lane: Lane;
  now?: () => string;
}

async function listSourceFiles(projectRoot: string, roots: string[]): Promise<string[]> {
  const patterns = roots.flatMap((r) =>
    SOURCE_GLOBS.map((ext) => `${r.replace(/\/+$/, '')}/**/*${ext}`),
  );
  const files = await fg(patterns, {
    cwd: projectRoot,
    onlyFiles: true,
    dot: false,
    ignore: SOURCE_EXCLUDES,
    followSymbolicLinks: false,
  });
  return files.map(toPosixPath).sort();
}

function readComplianceReports(projectRoot: string): ComplianceReport[] {
  const dir = join(projectRoot, '.paqad', 'compliance');
  if (!existsSync(dir)) return [];
  const files = fg.sync('**/report.json', { cwd: dir, absolute: true });
  const reports: ComplianceReport[] = [];
  for (const file of files) {
    try {
      const report = JSON.parse(readFileSync(file, 'utf8')) as ComplianceReport;
      if (Array.isArray(report.obligations)) reports.push(report);
    } catch {}
  }
  return reports;
}

function readEvidenceFailingPromiseIds(projectRoot: string): Set<string> {
  const failing = new Set<string>();
  const path = join(projectRoot, VERIFICATION_EVIDENCE_RELATIVE_PATH);
  if (!existsSync(path)) return failing;
  let evidence: VerificationEvidence;
  try {
    evidence = JSON.parse(readFileSync(path, 'utf8')) as VerificationEvidence;
  } catch {
    return failing;
  }
  if (!Array.isArray(evidence.gates)) return failing;
  for (const gate of evidence.gates) {
    for (const failure of gate.failures ?? []) {
      if (failure.ac_id) failing.add(failure.ac_id);
    }
  }
  return failing;
}

export function readObligationPromises(projectRoot: string): {
  promises: PromiseRef[];
  proofs: ProofEntry[];
} {
  const promises: PromiseRef[] = [];
  const proofs: ProofEntry[] = [];
  const seenPromise = new Set<string>();
  for (const report of readComplianceReports(projectRoot)) {
    for (const obligation of report.obligations) {
      if (seenPromise.has(obligation.obligation_id)) continue;
      seenPromise.add(obligation.obligation_id);
      promises.push({
        promise_id: obligation.obligation_id,
        description: obligation.description,
        source: 'obligation',
      });
      const checks = (obligation.evidence ?? []).map(toPosixPath);
      if (checks.length > 0) proofs.push({ promise_id: obligation.obligation_id, checks });
    }
  }
  return { promises, proofs };
}

function scanCodeMarkers(projectRoot: string, files: string[]): CodeMarker[] {
  const markers: CodeMarker[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(join(projectRoot, file), 'utf8');
    } catch {
      continue;
    }
    CODE_MARKER_PATTERN.lastIndex = 0;
    const ids = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = CODE_MARKER_PATTERN.exec(content)) !== null) {
      ids.add(m[1]!);
    }
    if (ids.size > 0) markers.push({ file, promise_ids: [...ids].sort() });
  }
  return markers;
}

export async function gatherTraceabilityInputs(
  options: GatherOptions,
): Promise<BuildTraceabilityMapInput> {
  const { projectRoot, lane } = options;
  const now = options.now ?? (() => new Date().toISOString());

  const discovered = discoverSourceRoots(projectRoot);
  const roots = discovered.source_roots ?? ['src'];
  const codeUniverse = await listSourceFiles(projectRoot, roots);
  const edges = await scanImports({ projectRoot, files: codeUniverse, aliases: { '@/': 'src/' } });

  const { promises, proofs: obligationProofs } = readObligationPromises(projectRoot);
  const failing = readEvidenceFailingPromiseIds(projectRoot);
  const proofs = obligationProofs.filter((proof) => !failing.has(proof.promise_id));

  const markers = scanCodeMarkers(projectRoot, codeUniverse);
  const delivery: DeliveryEntry[] = [];

  return {
    lane,
    now,
    promises,
    delivery,
    proofs,
    edges,
    codeUniverse,
    changedFiles: await readGitChangedFiles(projectRoot),
    markers,
  };
}
