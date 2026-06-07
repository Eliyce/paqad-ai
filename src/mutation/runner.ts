// Mutation run orchestration. Issue #105.
//
// Ties the pieces together: pick the per-language tool (adapter), scope to the
// changed code (scope), run the tool, normalise its report, assert the tree is
// clean afterward, and compute the outcome (outcome). Lane-gated — the `fast`
// lane skips mutation entirely to stay light — and only runs once the suite is
// already green, so survivors mean "a wrong implementation would pass," not
// "the build is broken."
//
// Every external effect (running the tool, reading its report, checking the
// tree) is injectable so the orchestration is unit-testable without spawning a
// real mutation run. The default deps provide a working Stryker integration for
// this repo's TypeScript; other languages plug in a `parse` adapter.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { execaCommand } from 'execa';

import type { DetectedStackProfile } from '@/core/types/introspection.js';
import type { Lane } from '@/core/types/routing.js';
import type {
  MutationConfidence,
  MutationResult,
  MutationSkipReason,
  MutationToolDescriptor,
  RawMutant,
} from '@/core/types/mutation.js';

import { selectMutationTool } from './adapter.js';
import { computeMutationOutcome } from './outcome.js';
import { scopeMutationTargets } from './scope.js';

export interface MutationCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface MutationRunnerDeps {
  // Whether the onboarded project has actually configured the tool.
  detectTool?: (descriptor: MutationToolDescriptor, projectRoot: string) => Promise<boolean>;
  // Run the tool, scoped to the changed files.
  execute?: (command: string, options: { cwd: string }) => Promise<MutationCommandResult>;
  // Normalise the tool's report into mutants. Returns null when the report
  // could not be interpreted (no parser for this tool yet).
  parse?: (
    descriptor: MutationToolDescriptor,
    projectRoot: string,
    run: MutationCommandResult,
  ) => Promise<RawMutant[] | null>;
  // Assert the working tree is clean (no mutant left behind).
  isTreeClean?: (projectRoot: string) => Promise<boolean>;
}

export interface RunMutationGateOptions {
  projectRoot: string;
  changedFiles: string[];
  lane: Lane;
  stackProfile: DetectedStackProfile | null;
  // Mutation only runs on an already-green suite.
  testsGreen: boolean;
  deps?: MutationRunnerDeps;
}

function skipped(
  descriptor: MutationToolDescriptor,
  scopedFiles: string[],
  reason: MutationSkipReason,
  confidence: MutationConfidence = descriptor.confidence,
): MutationResult {
  return {
    tool: descriptor.tool === 'generic' ? null : descriptor.tool,
    language: descriptor.languages[0] ?? null,
    confidence,
    scoped_files: scopedFiles,
    total_mutants: 0,
    killed: 0,
    survived: 0,
    equivalent_set_aside: 0,
    kill_rate: null,
    surviving_mutants: [],
    tree_clean: true,
    status: 'skipped',
    skipped_reason: reason,
  };
}

/**
 * Run mutation testing on the changed code and return a result for the
 * verification evidence. Never throws: any failure to run is recorded as a
 * skipped result so the gate decides what to do, not the orchestration.
 */
export async function runMutationGate(options: RunMutationGateOptions): Promise<MutationResult> {
  const descriptor = selectMutationTool(options.stackProfile);
  const deps = options.deps ?? {};
  const detectTool = deps.detectTool ?? defaultDetectTool;
  const execute = deps.execute ?? defaultExecute;
  const parse = deps.parse ?? defaultParse;
  const isTreeClean = deps.isTreeClean ?? defaultIsTreeClean;

  // Lane gate: trivial work skips mutation to stay light.
  if (options.lane === 'fast') {
    return skipped(descriptor, [], 'fast-lane');
  }

  // Only mutate an already-green suite — otherwise survivors are noise.
  if (!options.testsGreen) {
    return skipped(descriptor, [], 'tests-not-green');
  }

  const scopedFiles = scopeMutationTargets(options.changedFiles);
  if (scopedFiles.length === 0) {
    return skipped(descriptor, [], 'no-changed-code');
  }

  const available = await detectTool(descriptor, options.projectRoot);
  if (!available) {
    return skipped(descriptor, scopedFiles, 'tool-not-configured');
  }

  let run: MutationCommandResult;
  let mutants: RawMutant[] | null;
  try {
    run = await execute(buildCommand(descriptor, scopedFiles), {
      cwd: options.projectRoot,
    });
    mutants = await parse(descriptor, options.projectRoot, run);
  } catch {
    return skipped(descriptor, scopedFiles, 'run-failed');
  }

  if (mutants === null) {
    return skipped(descriptor, scopedFiles, 'run-failed');
  }

  const treeClean = await isTreeClean(options.projectRoot);

  return computeMutationOutcome({
    mutants,
    confidence: descriptor.confidence,
    tree_clean: treeClean,
    scoped_files: scopedFiles,
    tool: descriptor.tool,
    language: descriptor.languages[0] ?? null,
  });
}

/** Build the scoped run command for a tool. Exported for testing. */
export function buildCommand(descriptor: MutationToolDescriptor, scopedFiles: string[]): string {
  // Stryker accepts an explicit mutate glob list; other tools take the files
  // positionally. Either way we pass only the changed files so the run stays
  // scoped and quick.
  if (descriptor.tool === 'stryker') {
    const globs = scopedFiles.join(',');
    return `${descriptor.run_command} --mutate "${globs}"`;
  }
  return `${descriptor.run_command} ${scopedFiles.join(' ')}`.trim();
}

async function defaultDetectTool(
  descriptor: MutationToolDescriptor,
  projectRoot: string,
): Promise<boolean> {
  if (descriptor.config_markers.some((marker) => existsSync(join(projectRoot, marker)))) {
    return true;
  }

  // Node tools (Stryker) may be configured purely via a package.json dependency.
  if (descriptor.tool === 'stryker') {
    try {
      const manifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...manifest.dependencies, ...manifest.devDependencies };
      return Object.keys(deps).some((name) => name.includes('stryker'));
    } catch {
      return false;
    }
  }

  return false;
}

/* v8 ignore start -- thin execa adapter; the real mutation tool only runs in
   onboarded projects, not in unit tests (which inject `execute`). */
async function defaultExecute(
  command: string,
  options: { cwd: string },
): Promise<MutationCommandResult> {
  const result = await execaCommand(command, {
    cwd: options.cwd,
    reject: false,
    shell: true,
  });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
/* v8 ignore stop */

// Stryker JSON report locations, in priority order.
const STRYKER_REPORT_PATHS = [
  'reports/mutation/mutation.json',
  'reports/mutation/mutation-report.json',
];

interface StrykerReport {
  files?: Record<
    string,
    {
      mutants?: {
        status?: string;
        location?: { start?: { line?: number } };
        mutatorName?: string;
        replacement?: string;
      }[];
    }
  >;
}

function mapStrykerStatus(status: string): RawMutant['status'] {
  switch (status) {
    case 'Killed':
      return 'killed';
    case 'Timeout':
      return 'timeout';
    case 'Survived':
      return 'survived';
    case 'NoCoverage':
      return 'no-coverage';
    case 'Ignored':
      return 'equivalent';
    /* v8 ignore next 4 -- defensive: RuntimeError/CompileError map to set-aside */
    default:
      return 'error';
  }
}

async function defaultParse(
  descriptor: MutationToolDescriptor,
  projectRoot: string,
): Promise<RawMutant[] | null> {
  // Only Stryker's report is parsed by default; other tools inject a `parse`.
  if (descriptor.tool !== 'stryker') {
    return null;
  }

  const reportPath = STRYKER_REPORT_PATHS.map((relative) => join(projectRoot, relative)).find(
    (candidate) => existsSync(candidate),
  );
  if (reportPath === undefined) {
    return null;
  }

  const report = JSON.parse(await readFile(reportPath, 'utf8')) as StrykerReport;
  const mutants: RawMutant[] = [];
  for (const [file, entry] of Object.entries(report.files ?? {})) {
    for (const mutant of entry.mutants ?? []) {
      mutants.push({
        file,
        line: mutant.location?.start?.line ?? 0,
        operator: mutant.mutatorName ?? 'unknown',
        status: mapStrykerStatus(mutant.status ?? ''),
        ...(mutant.replacement ? { description: mutant.replacement } : {}),
      });
    }
  }
  return mutants;
}

async function defaultIsTreeClean(projectRoot: string): Promise<boolean> {
  try {
    const result = await execaCommand('git status --porcelain', {
      cwd: projectRoot,
      reject: false,
    });
    return result.exitCode === 0 && result.stdout.trim() === '';
  } catch {
    /* v8 ignore next 2 -- git invocation failure is environment-specific */
    return false;
  }
}
