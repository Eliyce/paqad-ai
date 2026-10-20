export interface RefreshJobSpec {
  jobId: string;
  lockDir: string;
  markerPath: string;
  debounceMs: number;
  staleLockMs: number;
  worker: WorkerCommand;
}

export interface WorkerCommand {
  modulePath: string;
  args?: string[];
  env?: Record<string, string>;
}

export type TriggerResult =
  { spawned: true } | { spawned: false; reason: 'debounced' | 'in-flight' };

export type LockOutcome = { acquired: true; reclaimedStale: boolean } | { acquired: false };

export interface TriggerDeps {
  now?: () => number;
  spawnWorker?: (worker: WorkerCommand) => void;
}
