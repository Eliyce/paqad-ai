// The test-plan resolver (issue #554, Part B.4). Pure: it maps the recorded `testing` decision,
// injected OS facts (so a unit test never depends on the host's real core count) and the config
// knobs to a concrete `{ command, mode, processes, reason }`. It decides parallel vs sequential
// and the process count; it does not run anything.

import {
  CONTAINER_PROCESS_CAP,
  CONTAINER_WRAPPERS,
  LOW_MEMORY_BYTES,
  LOW_MEMORY_PROCESS_CAP,
  MAX_PROCESSES,
  MIN_CORES_FOR_PARALLEL_TESTS,
  MIN_PROCESSES,
} from '@/checks/constants.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';

export type TestPlanMode = 'native' | 'parallel' | 'sequential';

export interface TestPlan {
  /** The exact command to run for the verdict, with `<processes>` already substituted. */
  command: string;
  mode: TestPlanMode;
  /** The parallel process count; null for native and sequential. */
  processes: number | null;
  /** Why sequential was chosen (`disabled`, `too-few-cores`, `<pkg>-missing`, `unknown`, …). */
  reason: string | null;
}

/** OS facts injected so the resolver is pure and testable. */
export interface OsFacts {
  availableParallelism: number;
  totalmem: number;
}

export interface TestPlanKnobs {
  checksParallel: boolean;
  /** 0 = auto (cores minus one, capped by memory and container limits). */
  checksMaxProcesses: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** True when the command runs through a container wrapper (its DB/socket contention caps procs). */
function runsInContainer(command: string): boolean {
  return CONTAINER_WRAPPERS.some((wrapper) => command.includes(wrapper));
}

/** Process count: cores minus one, clamped, then capped by memory, container, and the knob. */
export function computeProcessCount(os: OsFacts, isContainer: boolean, maxOverride: number): number {
  let count = clamp(os.availableParallelism - 1, MIN_PROCESSES, MAX_PROCESSES);
  if (os.totalmem < LOW_MEMORY_BYTES) count = Math.min(count, LOW_MEMORY_PROCESS_CAP);
  if (isContainer) count = Math.min(count, CONTAINER_PROCESS_CAP);
  if (maxOverride > 0) count = Math.min(count, maxOverride);
  return Math.max(count, MIN_PROCESSES);
}

/**
 * Resolve the test command to run for the verdict. The five branches (issue #554, B.4):
 * 1. `checks_parallel=false` → sequential, reason `disabled`.
 * 2. `testing.parallel = native` → the sequential command (it already parallelizes), mode `native`.
 * 3. `available` and ≥ 4 cores → the parallel command with `<processes>` substituted, mode `parallel`.
 * 4. `available` but < 4 cores → sequential, reason `too-few-cores`.
 * 5. `unavailable`/`unknown`/absent → sequential, reason from the record.
 */
export function resolveTestPlan(
  profile: Pick<ProjectProfile, 'commands' | 'testing'>,
  os: OsFacts,
  knobs: TestPlanKnobs,
): TestPlan {
  const sequential = profile.commands.test;

  if (!knobs.checksParallel) {
    return { command: sequential, mode: 'sequential', processes: null, reason: 'disabled' };
  }

  const testing = profile.testing;
  if (!testing || testing.parallel === 'unavailable' || testing.parallel === 'unknown') {
    return {
      command: sequential,
      mode: 'sequential',
      processes: null,
      reason: testing?.reason ?? 'unknown',
    };
  }

  if (testing.parallel === 'native') {
    return { command: sequential, mode: 'native', processes: null, reason: null };
  }

  // testing.parallel === 'available'
  if (os.availableParallelism < MIN_CORES_FOR_PARALLEL_TESTS) {
    return { command: sequential, mode: 'sequential', processes: null, reason: 'too-few-cores' };
  }

  const parallelCommand = profile.commands.test_parallel;
  if (!parallelCommand) {
    // Recorded available but no command to run — degrade rather than guess one.
    return {
      command: sequential,
      mode: 'sequential',
      processes: null,
      reason: 'no-parallel-command',
    };
  }

  const processes = computeProcessCount(
    os,
    runsInContainer(parallelCommand),
    knobs.checksMaxProcesses,
  );
  return {
    command: parallelCommand.replace(/<processes>/g, String(processes)),
    mode: 'parallel',
    processes,
    reason: null,
  };
}
