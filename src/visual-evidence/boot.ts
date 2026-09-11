// App boot for visual evidence (issue #551, Part D.2).
//
// Attaches to the app under test, spawning the dev server first when it is not already up. The
// contract lives in the profile's `app_preview` block (the single shared boot contract, NOT
// design_test.* which was never implemented). Reachability is decided by a real HTTP probe, so
// this module talks to the network + spawns a subprocess and is excluded from unit coverage
// (the pentest-engine precedent); it is exercised by the env-gated integration test.

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

/** True when the url answers with any HTTP status < 500 within `timeoutMs`. */
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

/** Kill a detached child's whole process group; swallow errors (it may already be gone). */
async function stopChild(child: ExecaChild): Promise<void> {
  try {
    if (child.pid !== undefined) {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // already exited
    }
  }
}

/**
 * Boot (or attach to) the app under test. When the url already responds, attach with a no-op
 * stop. Otherwise spawn the boot command (default `commands.dev`) in its own detached process
 * group and poll the url every second up to `wait_ms`; on timeout the process tree is killed and
 * the result is `app-not-reachable`. A missing `app_preview` block is `app-preview-not-configured`.
 * The caller MUST call `stop()` in a finally.
 */
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

  const commandString = preview.command && preview.command.trim().length > 0
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
  child.unref();

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
