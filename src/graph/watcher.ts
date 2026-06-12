import { existsSync, watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

export interface WatcherOptions {
  projectRoot: string;
  /** Quiet period in milliseconds before emitting a debounced change. */
  debounceMs?: number;
  /** Called once a debounced batch of changes has settled. */
  onChange: () => void | Promise<void>;
}

export interface RunningWatcher {
  close: () => void;
}

// Append-only logs that report builds and dashboard mutations write as side
// effects. Reacting to them would loop: build → append → event → build again.
const IGNORED_APPEND_ONLY = ['audit.log', 'logs'];

function isAppendOnlyLog(filename: string | Buffer | null): boolean {
  if (!filename) return false;
  const posix = String(filename).replace(/\\/g, '/');
  return IGNORED_APPEND_ONLY.some((entry) => posix === entry || posix.startsWith(`${entry}/`));
}

/**
 * Watches the project's .paqad/ directory for any change (any depth) and
 * fires `onChange` after `debounceMs` of quiet. Multiple rapid changes
 * coalesce into a single onChange call (FR-6 debounce contract).
 */
export function startPaqadWatcher(options: WatcherOptions): RunningWatcher {
  const debounceMs = options.debounceMs ?? 500;
  const watchPath = join(options.projectRoot, PATHS.AGENCY_DIR);
  if (!existsSync(watchPath)) {
    return { close: () => undefined };
  }

  let timer: NodeJS.Timeout | null = null;
  let closed = false;

  const fire = (): void => {
    if (closed) return;
    void Promise.resolve(options.onChange()).catch(() => {
      // swallow — the server is expected to handle its own logging
    });
  };

  const onAny = (): void => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, debounceMs);
  };

  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(watchPath, { recursive: true }, (_event, filename) => {
      if (isAppendOnlyLog(filename)) return;
      onAny();
    });
    watcher.on('error', () => {
      // recursive watch can fail on unusual filesystems — degrade silently
    });
  } catch {
    return { close: () => undefined };
  }

  return {
    close: () => {
      closed = true;
      if (timer) clearTimeout(timer);
      watcher?.close();
    },
  };
}
