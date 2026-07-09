/**
 * Background-worker harness types (RAG buildout F1).
 *
 * The harness is the one place the "never block coding" guarantee physically
 * lives: a reusable mechanism to keep ANY precomputed artifact fresh in a
 * detached worker, while the prompt path only ever reads the finished artifact.
 * Rules, the vector index, and the codebase-memory tier all ride on it.
 */

/** Where and how a background refresh job is spawned and serialised. */
export interface RefreshJobSpec {
  /**
   * Stable id for the artifact this job keeps fresh (e.g. `rag-index`,
   * `rule-manifest`). Used only for diagnostics and log lines.
   */
  jobId: string;
  /**
   * Directory whose atomic creation is the single-flight lock. While it exists,
   * a worker is assumed to be running and new triggers no-op. The worker removes
   * it on completion; a crash leaves it behind to be reclaimed once it ages past
   * `staleLockMs`.
   */
  lockDir: string;
  /**
   * File whose mtime records the last spawn. A trigger that arrives within
   * `debounceMs` of that mtime is coalesced away so a burst of prompts produces
   * at most one spawn.
   */
  markerPath: string;
  /** Coalesce window in ms: triggers within this of the last spawn are dropped. */
  debounceMs: number;
  /** A lock older than this (ms) is treated as abandoned and reclaimed. */
  staleLockMs: number;
  /** The detached worker process to launch when a refresh is actually needed. */
  worker: WorkerCommand;
}

/** The command a {@link RefreshJobSpec} launches in a detached child process. */
export interface WorkerCommand {
  /** Absolute path to the Node module the worker process runs. */
  modulePath: string;
  /** Extra argv passed after the module path. */
  args?: string[];
  /** Extra environment variables merged over `process.env`. */
  env?: Record<string, string>;
}

/** Why {@link triggerRefresh} did or did not spawn a worker. */
export type TriggerResult =
  { spawned: true } | { spawned: false; reason: 'debounced' | 'in-flight' };

/** Outcome of a single-flight lock acquisition attempt. */
export type LockOutcome = { acquired: true; reclaimedStale: boolean } | { acquired: false };

/** Injectable seams so the harness is deterministic under test. */
export interface TriggerDeps {
  /** Current epoch time in ms. Defaults to `Date.now`. */
  now?: () => number;
  /**
   * Launches the detached worker. Defaults to a real `child_process.spawn` with
   * `detached`/`unref`/`windowsHide`. Injected in tests to avoid real processes.
   */
  spawnWorker?: (worker: WorkerCommand) => void;
}
