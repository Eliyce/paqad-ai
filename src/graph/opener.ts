import { spawn } from 'node:child_process';
import { platform } from 'node:os';

export interface OpenBrowserOptions {
  url: string;
  /** Skip opening the browser regardless of environment. */
  skip?: boolean;
}

export interface OpenBrowserResult {
  opened: boolean;
  reason?: string;
}

export function shouldSkipBrowser(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.SSH_TTY || env.SSH_CONNECTION) {
    return 'SSH session detected';
  }
  if (platform() === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) {
    return 'no graphical display detected';
  }
  return null;
}

export function openBrowser(options: OpenBrowserOptions): OpenBrowserResult {
  if (options.skip) {
    return { opened: false, reason: 'browser open suppressed' };
  }
  const skipReason = shouldSkipBrowser();
  if (skipReason) {
    return { opened: false, reason: skipReason };
  }
  const url = options.url;
  let command: string;
  let args: string[];
  const os = platform();
  if (os === 'darwin') {
    command = 'open';
    args = [url];
  } else if (os === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '""', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {
      /* ignored — failure to open is informational */
    });
    child.unref();
    return { opened: true };
  } catch (err) {
    return { opened: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
