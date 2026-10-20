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
  command: string;
  mode: TestPlanMode;
  processes: number | null;
  reason: string | null;
}

export interface OsFacts {
  availableParallelism: number;
  totalmem: number;
}

export interface TestPlanKnobs {
  checksParallel: boolean;
  checksMaxProcesses: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function runsInContainer(command: string): boolean {
  return CONTAINER_WRAPPERS.some((wrapper) => command.includes(wrapper));
}

export function computeProcessCount(
  os: OsFacts,
  isContainer: boolean,
  maxOverride: number,
): number {
  let count = clamp(os.availableParallelism - 1, MIN_PROCESSES, MAX_PROCESSES);
  if (os.totalmem < LOW_MEMORY_BYTES) count = Math.min(count, LOW_MEMORY_PROCESS_CAP);
  if (isContainer) count = Math.min(count, CONTAINER_PROCESS_CAP);
  if (maxOverride > 0) count = Math.min(count, maxOverride);
  return Math.max(count, MIN_PROCESSES);
}

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

  if (os.availableParallelism < MIN_CORES_FOR_PARALLEL_TESTS) {
    return { command: sequential, mode: 'sequential', processes: null, reason: 'too-few-cores' };
  }

  const parallelCommand = profile.commands.test_parallel;
  if (!parallelCommand) {
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
