// Issue #109 — gather the traceability builder's inputs from reality (the
// current source tree, import edges, compliance reports, and code markers). All
// reads are best-effort and defensive: a missing or corrupt artifact degrades
// the map (fewer anchors → orphan flagging suppressed) but never throws. This
// is what makes the map "rebuilt from reality each run" rather than a
// hand-maintained file.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import fg from 'fast-glob';

import { PATHS } from '@/core/constants/paths.js';
import { scanImports } from '@/graph/import-scanner.js';
import { discoverSourceRoots } from '@/module-map/source-roots.js';
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

// `@obligation <ID>` / `@ac <ID>` in implementation source — explicit code →
// promise markers (open decision #2: infer by default, markers sharpen).
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

function readChangedFiles(projectRoot: string): string[] {
  const path = join(projectRoot, PATHS.CHANGED_FILES);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { files?: unknown };
    if (!Array.isArray(parsed.files)) return [];
    return parsed.files.filter((f): f is string => typeof f === 'string').map(toPosixPath);
  } catch {
    return [];
  }
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
    } catch {
      // Skip corrupt reports — the map degrades, it does not break.
    }
  }
  return reports;
}

// Verification evidence ties a check to an AC via `ac_id` — the "proves it"
// link. A gate carrying an ac_id is a check targeting that promise, so we fold
// it into the proof index (joining, not forking, the evidence subsystem).
function readEvidenceProofs(projectRoot: string): ProofEntry[] {
  const path = join(projectRoot, VERIFICATION_EVIDENCE_RELATIVE_PATH);
  if (!existsSync(path)) return [];
  let evidence: VerificationEvidence;
  try {
    evidence = JSON.parse(readFileSync(path, 'utf8')) as VerificationEvidence;
  } catch {
    return [];
  }
  if (!Array.isArray(evidence.gates)) return [];
  const checksByPromise = new Map<string, Set<string>>();
  for (const gate of evidence.gates) {
    for (const failure of gate.failures ?? []) {
      if (!failure.ac_id) continue;
      const bucket = checksByPromise.get(failure.ac_id) ?? new Set<string>();
      bucket.add(`gate:${gate.name}`);
      checksByPromise.set(failure.ac_id, bucket);
    }
  }
  return [...checksByPromise].map(([promise_id, checks]) => ({
    promise_id,
    checks: [...checks].sort(),
  }));
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

/**
 * Assemble the builder input from on-disk reality. Promises + proofs come from
 * the compliance reports (the concrete spec→test artifact); delivery (code →
 * promise) is inferred from explicit code markers. When neither yields an
 * anchor, the builder suppresses orphan flagging rather than guessing.
 */
export async function gatherTraceabilityInputs(
  options: GatherOptions,
): Promise<BuildTraceabilityMapInput> {
  const { projectRoot, lane } = options;
  const now = options.now ?? (() => new Date().toISOString());

  const discovered = discoverSourceRoots(projectRoot);
  const roots = discovered.source_roots ?? ['src'];
  const codeUniverse = await listSourceFiles(projectRoot, roots);
  const edges = await scanImports({ projectRoot, files: codeUniverse, aliases: { '@/': 'src/' } });

  const reports = readComplianceReports(projectRoot);
  const promises: PromiseRef[] = [];
  const proofs: ProofEntry[] = [];
  const seenPromise = new Set<string>();
  for (const report of reports) {
    for (const obligation of report.obligations) {
      if (seenPromise.has(obligation.obligation_id)) continue;
      seenPromise.add(obligation.obligation_id);
      promises.push({
        promise_id: obligation.obligation_id,
        description: obligation.description,
        source: 'obligation',
      });
      const checks = obligation.evidence.map(toPosixPath);
      if (checks.length > 0) proofs.push({ promise_id: obligation.obligation_id, checks });
    }
  }
  proofs.push(...readEvidenceProofs(projectRoot));

  // Code → promise comes from explicit markers (the concrete, non-circular
  // signal available at runtime); the builder folds them into the delivery
  // index. Inference from the change set / module map can sharpen `delivery`
  // further in future without changing the join.
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
    changedFiles: readChangedFiles(projectRoot),
    markers,
  };
}
