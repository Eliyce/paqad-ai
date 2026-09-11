// Tunable constants for the fast checks stage (issue #554). Kept in one module so the plan
// resolver, the scheduler, the isolated-re-run verdict and the report share exactly one set of
// numbers — a divergent copy would silently change the quality bar.

/** Below this core count the parallel test command is never attempted (Decision log: Fallback). */
export const MIN_CORES_FOR_PARALLEL_TESTS = 4;

/** Process-count clamp for the runner's own parallel mode. */
export const MIN_PROCESSES = 2;
export const MAX_PROCESSES = 16;

/** A machine with less than this much total RAM caps parallel test processes low. */
export const LOW_MEMORY_BYTES = 8 * 1024 ** 3;
export const LOW_MEMORY_PROCESS_CAP = 4;

/** A test command run through a container wrapper caps processes here (DB/socket contention). */
export const CONTAINER_PROCESS_CAP = 8;

/** Command prefixes that mean the test runs inside a container — capped at CONTAINER_PROCESS_CAP. */
export const CONTAINER_WRAPPERS = [
  'vendor/bin/sail',
  'sail',
  'docker compose',
  'docker-compose',
] as const;

/** Skip the isolated re-runs and report red when failures exceed this absolute count. */
export const RERUN_MAX_FAILURES = 10;

/** …or when they exceed this fraction of the executed tests. A mass failure is a real failure. */
export const RERUN_MAX_FAILURE_RATIO = 0.05;

/** How many trailing lines of a red command's combined output the report keeps. */
export const OUTPUT_TAIL_LINES = 100;
