import { execa, parseCommandString } from 'execa';

import type { AppPreviewConfig, ProjectProfile } from '@/core/types/project-profile.js';

type ExecaChild = ReturnType<typeof execa>;

export type BootResult =
  | { ok: true; url: string; stop: () => Promise<void> }
  | {
      ok: false;
      reason: 'app-preview-not-configured' | 'app-not-reachable';
      detail: string;
    };

export async function isReachable(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopChild(child: ExecaChild): Promise<void> {
  try {
    if (child.pid !== undefined) {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {}
  }
}

export async function bootApp(
  projectRoot: string,
  profile: ProjectProfile | null,
): Promise<BootResult> {
  const preview: AppPreviewConfig | undefined = profile?.app_preview;
  if (!preview || !preview.url) {
    return {
      ok: false,
      reason: 'app-preview-not-configured',
      detail:
        'no app_preview block in project-profile.yaml — add app_preview.url (and optionally command/wait_ms) so visual evidence can reach the app',
    };
  }

  const { url } = preview;
  if (await isReachable(url, 2000)) {
    return { ok: true, url, stop: async () => undefined };
  }

  const commandString =
    preview.command && preview.command.trim().length > 0
      ? preview.command
      : (profile?.commands?.dev ?? '');
  if (commandString.trim().length === 0) {
    return {
      ok: false,
      reason: 'app-not-reachable',
      detail: `app_preview.url ${url} did not respond and no boot command is configured (app_preview.command / commands.dev)`,
    };
  }

  const [bin, ...args] = parseCommandString(commandString.trim());
  const child = execa(bin!, args, {
    cwd: projectRoot,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.nodeChildProcess.unref();
  child.catch(() => {});

  const waitMs = preview.wait_ms ?? 30000;
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (await isReachable(url, 2000)) {
      return { ok: true, url, stop: () => stopChild(child) };
    }
    await sleep(1000);
  }

  await stopChild(child);
  return {
    ok: false,
    reason: 'app-not-reachable',
    detail: `app_preview.url ${url} did not respond within ${waitMs}ms after starting "${commandString}"`,
  };
}
