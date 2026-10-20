export const MIN_CORES_FOR_PARALLEL_TESTS = 4;

export const MIN_PROCESSES = 2;
export const MAX_PROCESSES = 16;

export const LOW_MEMORY_BYTES = 8 * 1024 ** 3;
export const LOW_MEMORY_PROCESS_CAP = 4;

export const CONTAINER_PROCESS_CAP = 8;

export const CONTAINER_WRAPPERS = [
  'vendor/bin/sail',
  'sail',
  'docker compose',
  'docker-compose',
] as const;

export const RERUN_MAX_FAILURES = 10;

export const RERUN_MAX_FAILURE_RATIO = 0.05;

export const OUTPUT_TAIL_LINES = 100;
