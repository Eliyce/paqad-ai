import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

import { isTestFile } from '@/pipeline/change-evidence.js';
import { ownsFile, type Workstream } from '@/planning/slicing.js';
import { extractTitlesAndTags, namesCriterion } from '@/traceability/change-map.js';

export const SLICE_GATE_LIMIT_MS = 10 * 60 * 1000;
export const SLICE_GATE_TEST_WORKERS = 2;

export interface SliceGateSubject {
  id: string;
  owned_files: string[];
  acs: string[];
  seams: Workstream['provides_seams'];
}

export type SliceGateStep = (files: string[], testFiles: string[]) => Promise<string[]> | string[];

export interface SliceGateOptions {
  projectRoot: string;
  subject: SliceGateSubject;
  changedFiles: readonly string[];
  steps?: Partial<Record<'format' | 'lint' | 'typecheck' | 'rules' | 'tests', SliceGateStep>>;
  nowMs?: () => number;
  limitMs?: number;
  gitBinary?: string;
}

export interface SliceGateResult {
  passed: boolean;
  failures: string[];
  digest: string;
  files: string[];
  slowest_step: string | null;
  timed_out: boolean;
}

const SUFFIX_TEST = /(?:^|\/)[^/]+_test\.[A-Za-z0-9]+$/;
const HEAVY_CALL =
  /\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|execa|execaSync|execaCommand)\s*\(([^)]*)\)/g;
const HEAVY_COMMAND =
  /\bvitest[\s'",]+run\b|\bjest\b|\b(?:pnpm|npm|yarn)\b[\s'",[\]]+(?:run[\s'",[\]]+)?(?:test|build|lint)\b|\bgo[\s'",[\]]+test[\s'",[\]]+\.\/\.\.\.|\beslint\b|\btsc\b/;

export function sliceFiles(subject: SliceGateSubject, changedFiles: readonly string[]): string[] {
  return [...new Set(changedFiles)].filter((file) => ownsFile(subject, file)).sort();
}

function isSliceTest(file: string): boolean {
  return isTestFile(file) || SUFFIX_TEST.test(file);
}

function readText(projectRoot: string, file: string): string | null {
  try {
    return readFileSync(join(projectRoot, file), 'utf8');
  } catch {
    return null;
  }
}

export function heavyRunFailures(projectRoot: string, testFiles: readonly string[]): string[] {
  const failures: string[] = [];
  for (const file of testFiles) {
    const text = readText(projectRoot, file);
    if (text === null) continue;
    HEAVY_CALL.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = HEAVY_CALL.exec(text)) !== null) {
      const args = match[1] ?? '';
      if (HEAVY_COMMAND.test(args)) {
        failures.push(`heavy run: ${file} starts a full suite, build or lint run`);
        break;
      }
    }
  }
  return failures;
}

export function acTagFailures(
  projectRoot: string,
  acs: readonly string[],
  testFiles: readonly string[],
): string[] {
  const texts = testFiles.flatMap((file) => {
    const text = readText(projectRoot, file);
    return text === null ? [] : extractTitlesAndTags(text);
  });
  return acs
    .filter((ac) => !texts.some((text) => namesCriterion(text, ac)))
    .map((ac) => `ac tag: no owned test names ${ac}`);
}

function stripExtension(path: string): string {
  return path.replace(/\.(?:[cm]?[jt]sx?)$/, '').replace(/\/index$/, '');
}

function resolveSpecifier(testFile: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) return stripExtension(`src/${specifier.slice(2)}`);
  if (specifier.startsWith('.')) {
    return stripExtension(
      normalize(join(dirname(testFile), specifier))
        .split('\\')
        .join('/'),
    );
  }
  return null;
}

const IMPORT_SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;
const MOCK_CALL = /\b(?:vi\.mock|jest\.mock|mock\.module)\s*\(\s*['"]([^'"]+)['"]/g;

export function wiredFailures(
  projectRoot: string,
  seams: SliceGateSubject['seams'],
  testFiles: readonly string[],
): string[] {
  const failures: string[] = [];
  for (const seam of seams) {
    const target = stripExtension(seam.entry_file);
    const naming = testFiles.filter((file) => {
      const text = readText(projectRoot, file);
      return (
        text !== null && extractTitlesAndTags(text).some((t) => namesCriterion(t, seam.wired_ac))
      );
    });
    if (naming.length === 0) continue;
    const wired = naming.some((file) => {
      const text = readText(projectRoot, file) ?? '';
      const specs = (re: RegExp): string[] => {
        re.lastIndex = 0;
        const out: string[] = [];
        let match: RegExpExecArray | null;
        while ((match = re.exec(text)) !== null) out.push(match[1]!);
        return out;
      };
      const imports = specs(IMPORT_SPEC).map((s) => resolveSpecifier(file, s));
      const mocks = specs(MOCK_CALL).map((s) => resolveSpecifier(file, s));
      return imports.includes(target) && !mocks.includes(target);
    });
    if (!wired) {
      failures.push(`wired: ${seam.wired_ac} does not import ${seam.entry_file} without a mock`);
    }
  }
  return failures;
}

export function sliceDigest(
  projectRoot: string,
  id: string,
  files: readonly string[],
  gitBinary = 'git',
): string {
  const workDir = join(
    projectRoot,
    '.paqad',
    'tmp',
    `slice-gate-${id}-${process.pid}-${Date.now()}`,
  );
  const index = join(workDir, 'index');
  mkdirSync(workDir, { recursive: true });
  try {
    const env = { ...process.env, GIT_INDEX_FILE: index };
    const git = (args: string[]): string =>
      execFileSync(gitBinary, args, {
        cwd: projectRoot,
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    try {
      git(['read-tree', '--empty']);
      const present = files.filter((file) => existsSync(join(projectRoot, file)));
      if (present.length > 0) git(['add', '-f', '--', ...present]);
      const tree = git(['write-tree']).trim();
      const missing = files.filter((file) => !present.includes(file));
      return createHash('sha256')
        .update(`${tree}\n${missing.join('\n')}`)
        .digest('hex');
    } catch {
      const hash = createHash('sha256');
      for (const file of files) hash.update(`${file}\0${readText(projectRoot, file) ?? ''}\0`);
      return hash.digest('hex');
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

export async function runSliceGate(options: SliceGateOptions): Promise<SliceGateResult> {
  const nowMs = options.nowMs ?? Date.now;
  const limit = options.limitMs ?? SLICE_GATE_LIMIT_MS;
  const started = nowMs();
  const files = sliceFiles(options.subject, options.changedFiles);
  const testFiles = files.filter(isSliceTest);
  const failures: string[] = [];
  const timings: Array<[string, number]> = [];
  let timedOut = false;

  const steps: Array<[string, SliceGateStep]> = [
    ['format', options.steps?.format ?? (() => [])],
    ['rules', options.steps?.rules ?? (() => [])],
    ['typecheck', options.steps?.typecheck ?? (() => [])],
    ['lint', options.steps?.lint ?? (() => [])],
    ['ac-tags', () => acTagFailures(options.projectRoot, options.subject.acs, testFiles)],
    ['wired', () => wiredFailures(options.projectRoot, options.subject.seams, testFiles)],
    ['heavy-run', () => heavyRunFailures(options.projectRoot, testFiles)],
    ['tests', options.steps?.tests ?? (() => [])],
  ];
  for (const [name, step] of steps) {
    const before = nowMs();
    failures.push(...(await step(files, testFiles)));
    timings.push([name, nowMs() - before]);
    if (nowMs() - started > limit) {
      timedOut = true;
      break;
    }
  }
  const slowest = timings.reduce<[string, number] | null>(
    (max, entry) => (max === null || entry[1] > max[1] ? entry : max),
    null,
  );
  if (timedOut) {
    failures.push(
      `time limit: the slice gate ran past ${Math.round(limit / 60_000)} minutes; slowest step: ${slowest?.[0] ?? 'unknown'}`,
    );
  }
  return {
    passed: failures.length === 0,
    failures,
    digest: sliceDigest(options.projectRoot, options.subject.id, files, options.gitBinary),
    files,
    slowest_step: slowest?.[0] ?? null,
    timed_out: timedOut,
  };
}
