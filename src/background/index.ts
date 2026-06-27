/**
 * Background-worker harness (RAG buildout F1) — the keystone "never block
 * coding" mechanism. A single reusable way to keep any precomputed artifact
 * fresh in a detached worker, while the prompt path only ever reads the finished
 * artifact. Reused by smart rule loading, the branch-aware vector index, and the
 * codebase-memory tier.
 *
 * Parent side (a hook): {@link triggerRefresh} — debounce → single-flight →
 * detached spawn, returning immediately.
 * Worker side (the spawned process): {@link runRefreshJob} wrapping a build that
 * writes through {@link buildAndSwap}, then releasing the lock.
 */
export { atomicWriteFile, buildAndSwap } from './atomic-artifact.js';
export { shouldDebounce, touchMarker } from './debounce-marker.js';
export { releaseLock, tryAcquireLock } from './single-flight-lock.js';
export { runRefreshJob, spawnDetachedWorker, triggerRefresh } from './worker-harness.js';
export type {
  LockOutcome,
  RefreshJobSpec,
  TriggerDeps,
  TriggerResult,
  WorkerCommand,
} from './types.js';
