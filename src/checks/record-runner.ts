// Validate + build the agent-discovered runner record (issue #554, Part B.5). The
// `checks record-runner` verb NEVER trusts the JSON: it checks the shape, that the parallel command
// only adds allowlisted parallel flags to the project's own runner invocation, and that its
// evidence paths exist. A rejected file is reported with the offending token and nothing is written.

import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { tokenizeCommand } from '@/checks/command-chain.js';
import type { ProjectProfile, ProjectTesting } from '@/core/types/project-profile.js';
import type { SingleTestSelector } from '@/core/types/pack.js';

/** The tokens a discovered `test_parallel` may add after the runner invocation. */
const PARALLEL_TOKEN_ALLOWLIST = new Set<string>([
  '--parallel',
  '--processes=<processes>',
  '-n',
  '<processes>',
  '--dist',
  '--dist=load',
  '--dist=loadfile',
  '--dist=loadscope',
  '--workers=<processes>',
  '--maxWorkers=<processes>',
  '--concurrency=<processes>',
  '-j',
  '--jobs=<processes>',
  '--runner',
  'WrapperRunner',
  '--runner=WrapperRunner',
  '--max-parallel-test-modules',
  '--test-threads=<processes>',
  '-p',
  // The chain operator and the arg separator are structural, never a smuggled command.
  '&&',
  '--',
]);

const METACHARACTERS = /[;|`$()<>]/;

export interface RunnerDiscovery {
  schema_version: number;
  runner_id: string;
  parallel: 'available' | 'unavailable' | 'native';
  reason: string | null;
  test_parallel: string | null;
  single_test_selector: SingleTestSelector;
  evidence: string[];
}

export type RecordRunnerResult =
  | { ok: true; testing: ProjectTesting; testParallel: string | null }
  | { ok: false; error: string };

const REQUIRED_KEYS = [
  'schema_version',
  'runner_id',
  'parallel',
  'reason',
  'test_parallel',
  'single_test_selector',
  'evidence',
];

function sharedPrefix(a: string[], b: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i] === b[i]) out.push(a[i]!);
    else break;
  }
  return out;
}

/**
 * Validate a discovery artifact against the project's `commands.test` and build the `testing` record
 * (and `test_parallel`) it should write. Returns `{ ok: false }` with a one-line reason and the
 * offending token when the artifact is rejected.
 */
export function validateRecordRunner(
  raw: unknown,
  profile: ProjectProfile,
  projectRoot: string,
  now: string,
  lockfileHashValue?: string,
): RecordRunnerResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'discovery file is not a JSON object' };
  }
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  if (keys.join(',') !== [...REQUIRED_KEYS].sort().join(',')) {
    return {
      ok: false,
      error: `discovery file must carry exactly: ${REQUIRED_KEYS.join(', ')}`,
    };
  }
  if (typeof obj.runner_id !== 'string' || obj.runner_id.length === 0) {
    return { ok: false, error: 'runner_id must be a non-empty string' };
  }
  if (obj.parallel !== 'available' && obj.parallel !== 'unavailable' && obj.parallel !== 'native') {
    return { ok: false, error: 'parallel must be available | unavailable | native' };
  }
  if (obj.single_test_selector !== 'test_id' && obj.single_test_selector !== 'file') {
    return { ok: false, error: 'single_test_selector must be test_id | file' };
  }
  if (!Array.isArray(obj.evidence) || obj.evidence.length === 0) {
    return { ok: false, error: 'evidence must be a non-empty array of paths' };
  }
  for (const path of obj.evidence) {
    if (typeof path !== 'string') return { ok: false, error: 'evidence paths must be strings' };
    const abs = isAbsolute(path) ? path : resolve(projectRoot, path);
    if (!abs.startsWith(resolve(projectRoot)) || !existsSync(abs)) {
      return { ok: false, error: `evidence path does not exist under the project: ${path}` };
    }
  }

  const discovery = obj as unknown as RunnerDiscovery;

  if (discovery.parallel === 'available') {
    if (typeof discovery.test_parallel !== 'string' || discovery.test_parallel.length === 0) {
      return { ok: false, error: 'test_parallel is required when parallel is available' };
    }
    const check = validateParallelCommand(profile.commands.test, discovery.test_parallel);
    if (!check.ok) return check;
  }

  const testing: ProjectTesting = {
    runner_id: discovery.runner_id,
    parallel: discovery.parallel,
    ...(discovery.reason ? { reason: discovery.reason } : {}),
    detected_by: 'agent',
    ...(lockfileHashValue ? { lockfile_hash: lockfileHashValue } : {}),
    recorded_at: now,
  };
  return {
    ok: true,
    testing,
    testParallel: discovery.parallel === 'available' ? discovery.test_parallel : null,
  };
}

/**
 * The parallel command must start with the project's own runner invocation (its shared leading
 * tokens, including the runner executable) and then add only allowlisted parallel flags, with
 * `<processes>` exactly once and no shell metacharacter.
 */
function validateParallelCommand(
  sequential: string,
  parallel: string,
): { ok: true } | { ok: false; error: string } {
  const seqTokens = tokenizeCommand(sequential);
  const parTokens = tokenizeCommand(parallel);
  const prefix = sharedPrefix(seqTokens, parTokens);
  const hasExecutable = prefix.some((token) => !token.startsWith('-'));
  if (!hasExecutable) {
    return {
      ok: false,
      error: `test_parallel must start with the project's own runner invocation (got "${parTokens[0] ?? ''}")`,
    };
  }

  for (const token of parTokens.slice(prefix.length)) {
    // Allowlisted parallel flags (including the `<processes>` placeholder) are trusted as-is; only an
    // UNKNOWN token is checked for a shell metacharacter, so `--jobs=<processes>` is never a false hit.
    if (PARALLEL_TOKEN_ALLOWLIST.has(token)) continue;
    if (METACHARACTERS.test(token)) {
      return { ok: false, error: `test_parallel rejected: shell metacharacter in "${token}"` };
    }
    return { ok: false, error: `test_parallel rejected: token "${token}" is not an allowed parallel flag` };
  }

  const processesCount = (parallel.match(/<processes>/g) ?? []).length;
  if (processesCount !== 1) {
    return { ok: false, error: 'test_parallel must contain <processes> exactly once' };
  }
  return { ok: true };
}
