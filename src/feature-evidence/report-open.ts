// Sandbox-aware opener for the feature evidence report (issue #371).
//
// Reuses the `src/graph/opener.ts` semantics (per-OS command, detached + unref,
// fire-and-forget) and extends the skip detection so a browser never pops in a context
// where it makes no sense or would break: CI, GitHub Actions, Codespaces, an SSH session,
// Claude Code's cloud VM (`CLAUDE_CODE_REMOTE`), or a Linux session with no display (the
// exact test `xdg-open` uses). The RULE across the research (issue #371): the HOOK opens,
// never the agent — an agent-run `open` inside a host sandbox crashes (Codex on macOS) or
// is blocked (Claude's opt-in Bash sandbox). This module is only ever called from the
// unsandboxed hook / CLI layer.
//
// The opener is deliberately never `rundll32 url.dll,FileProtocolHandler` on Windows
// (LOLBAS-listed, EDR bait — poison for a compliance product); it uses the empty-title
// `cmd /c start "" "<path>"` form.

import { spawn as nodeSpawn } from 'node:child_process';
import { platform } from 'node:os';
import { pathToFileURL } from 'node:url';

/** The `spawn` shape this module needs — injectable so a test can spy without a real process. */
export type SpawnFn = (
  command: string,
  args: string[],
  options: { detached: boolean; stdio: 'ignore' },
) => { on(event: 'error', listener: () => void): unknown; unref(): void };

export interface OpenReportOptions {
  /** Absolute path to the report HTML file. */
  absPath: string;
  env?: NodeJS.ProcessEnv;
  /** Injected spawn (defaults to node:child_process spawn) for testability. */
  spawnFn?: SpawnFn;
  /** Injected platform (defaults to os.platform()) for cross-platform tests. */
  platformValue?: NodeJS.Platform;
}

export interface OpenReportResult {
  opened: boolean;
  reason?: string;
  /** The `file://` URL that was (or would be) opened. */
  url: string;
}

/**
 * Reason to SKIP auto-opening a browser, or null when a real desktop browser is safe to
 * open. Extends `shouldSkipBrowser` (graph/opener) with the CI/remote family so a
 * completion hook running in CI or a cloud VM never tries to open a GUI.
 */
export function resolveReportOpenSkip(
  env: NodeJS.ProcessEnv = process.env,
  platformValue: NodeJS.Platform = platform(),
): string | null {
  if (env.CI === 'true' || env.CI === '1') return 'CI environment';
  if (env.GITHUB_ACTIONS) return 'GitHub Actions';
  if (env.CODESPACES) return 'GitHub Codespaces';
  if (env.CLAUDE_CODE_REMOTE) return 'Claude Code remote (cloud) session';
  if (env.SSH_TTY || env.SSH_CONNECTION) return 'SSH session';
  if (platformValue === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) {
    return 'no graphical display';
  }
  return null;
}

/**
 * Open the report in the OS default browser — fire-and-forget, sandbox-aware. Returns
 * `{ opened:false, reason }` (never throws) when a skip condition applies or the spawn
 * fails, so the caller can fall back to printing the path.
 */
export function openFeatureReport(options: OpenReportOptions): OpenReportResult {
  const env = options.env ?? process.env;
  const url = pathToFileURL(options.absPath).href;
  const os = options.platformValue ?? platform();
  const skip = resolveReportOpenSkip(env, os);
  if (skip) return { opened: false, reason: skip, url };
  let command: string;
  let args: string[];
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
  /* v8 ignore next -- the real node spawn default is not exercised in tests (it would
     launch a browser); tests always inject a spawn spy. */
  const spawnFn = options.spawnFn ?? (nodeSpawn as unknown as SpawnFn);
  try {
    const child = spawnFn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {
      /* ignored — failure to open is informational, never fatal */
    });
    child.unref();
    return { opened: true, url };
  } catch (error) {
    return { opened: false, reason: error instanceof Error ? error.message : String(error), url };
  }
}
