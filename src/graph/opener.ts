import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { isAbsolute } from 'node:path';

export interface OpenBrowserOptions {
  url: string;
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

export function isOpenableTarget(target: string): boolean {
  if (target.trim().length === 0 || target.startsWith('-')) return false;
  if (URL.canParse(target)) {
    const { protocol } = new URL(target);
    if (protocol === 'http:' || protocol === 'https:') return true;
  }
  return isAbsolute(target) && existsSync(target);
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
  if (!isOpenableTarget(url)) {
    return { opened: false, reason: 'not an http(s) URL or an existing file path' };
  }
  const os = platform();
  const command = os === 'darwin' ? 'open' : os === 'win32' ? 'explorer.exe' : 'xdg-open';
  try {
    const child = spawn(command, [url], { detached: true, stdio: 'ignore', shell: false });
    child.on('error', () => {});
    child.unref();
    return { opened: true };
  } catch (err) {
    return { opened: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
