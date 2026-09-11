// Playwright browser provisioning (issue #551, Part D).
//
// Visual evidence captures with Playwright + Chromium, but paqad must NEVER take Playwright as
// a dependency and must NEVER import it from the target project's node_modules (a deliberate
// reversal of the design-test pattern: capture must not depend on the user's project setup).
// Instead paqad provisions its own runtime under `~/.paqad-ai/ve-runtime/` and dynamic-imports
// Playwright resolved from THERE. All subprocesses run through execa with tokenized args.
//
// This module does real npm installs and dynamic imports, so it is excluded from unit coverage
// (the pentest-engine / site-map-gatherer precedent) and exercised by the env-gated integration
// test (`PAQAD_VE_INTEGRATION=1`).

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { execa } from 'execa';

/** Whether the provisioned browser runtime is ready, absent, or present-but-unusable. */
export type BrowserStatus = 'provisioned' | 'missing' | 'broken';

export interface ProvisionRecord {
  schema_version: number;
  playwright_version: string;
  provisioned_at: string;
}

/** The `~/.paqad-ai/ve-runtime/` directory (home via os.homedir, which honours USERPROFILE). */
export function resolveVeRuntimeDir(): string {
  return join(homedir(), '.paqad-ai', 've-runtime');
}

function provisionRecordPath(veRuntime: string): string {
  return join(veRuntime, 'provision.json');
}

function browsersPath(veRuntime: string): string {
  return join(veRuntime, 'browsers');
}

/** Resolve the Playwright entry point from the ve-runtime (never from the target project). */
export function resolvePlaywrightModulePath(veRuntime: string): string {
  const req = createRequire(join(veRuntime, 'package.json'));
  return req.resolve('playwright');
}

/**
 * The current status of the provisioned browser runtime. `missing` when nothing is provisioned;
 * `broken` when the dir exists but Playwright cannot be resolved or its record cannot be read;
 * `provisioned` when the record is present and Playwright resolves.
 */
export function browserStatus(veRuntime: string = resolveVeRuntimeDir()): BrowserStatus {
  // Read the record directly and catch — never stat-then-read (the TOCTOU race CodeQL flags,
  // mirroring bundle-completeness-gate's readFileSafe). An absent record file with no dir is
  // `missing`; an absent record beside an existing dir, or an unusable Playwright, is `broken`.
  let raw: string;
  try {
    raw = readFileSync(provisionRecordPath(veRuntime), 'utf8');
  } catch {
    return existsSync(veRuntime) ? 'broken' : 'missing';
  }
  try {
    JSON.parse(raw);
    resolvePlaywrightModulePath(veRuntime);
    return 'provisioned';
  } catch {
    return 'broken';
  }
}

/** Read the provision record; throws when absent or unparseable. */
export function readProvisionRecord(veRuntime: string): ProvisionRecord {
  return JSON.parse(readFileSync(provisionRecordPath(veRuntime), 'utf8')) as ProvisionRecord;
}

/**
 * Provision Playwright + Chromium into the ve-runtime. Creates `package.json` if missing, then
 * `npm install playwright@^1` and `npx playwright install chromium` (Chromium into the runtime's
 * own `browsers/` dir), and records the outcome. All subprocesses via execa with tokenized args
 * and no shell interpretation. Throws on any subprocess failure — callers turn that into the
 * `playwright-not-provisioned` environmental skip rather than a crash.
 */
export async function provisionBrowser(
  veRuntime: string = resolveVeRuntimeDir(),
  now: () => string = () => new Date().toISOString(),
): Promise<ProvisionRecord> {
  mkdirSync(veRuntime, { recursive: true });
  const pkgPath = join(veRuntime, 'package.json');
  // Fixed, idempotent content — write unconditionally rather than check-then-write (no
  // file-system race). It only marks the dir as a private npm root for the install below.
  writeFileSync(pkgPath, `${JSON.stringify({ private: true }, null, 2)}\n`, 'utf8');
  const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath(veRuntime) };
  await execa('npm', ['install', 'playwright@^1', '--no-audit', '--no-fund'], {
    cwd: veRuntime,
    env,
  });
  await execa('npx', ['playwright', 'install', 'chromium'], { cwd: veRuntime, env });

  const playwrightVersion = readInstalledPlaywrightVersion(veRuntime);
  const record: ProvisionRecord = {
    schema_version: 1,
    playwright_version: playwrightVersion,
    provisioned_at: now(),
  };
  writeFileSync(provisionRecordPath(veRuntime), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return record;
}

/** Read the installed Playwright version from its package.json in the ve-runtime. */
function readInstalledPlaywrightVersion(veRuntime: string): string {
  const req = createRequire(join(veRuntime, 'package.json'));
  const pkg = JSON.parse(readFileSync(req.resolve('playwright/package.json'), 'utf8')) as {
    version: string;
  };
  return pkg.version;
}

/** The Chromium browsers path passed to Playwright at launch (PLAYWRIGHT_BROWSERS_PATH). */
export function veBrowsersPath(veRuntime: string = resolveVeRuntimeDir()): string {
  return browsersPath(veRuntime);
}
