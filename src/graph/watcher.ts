import { existsSync, watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

export interface WatcherOptions {
  projectRoot: string;
  debounceMs?: number;
  onChange: () => void | Promise<void>;
}

export interface RunningWatcher {
  close: () => void;
}

const IGNORED_APPEND_ONLY = ['audit.log', 'logs'];

function isAppendOnlyLog(filename: string | Buffer | null): boolean {
  if (!filename) return false;
  const posix = String(filename).replace(/\\/g, '/');
  return IGNORED_APPEND_ONLY.some((entry) => posix === entry || posix.startsWith(`${entry}/`));
}

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
    void Promise.resolve(options.onChange()).catch(() => {});
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
    watcher.on('error', () => {});
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
