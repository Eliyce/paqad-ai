import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { execa } from 'execa';

export type BrowserStatus = 'provisioned' | 'missing' | 'broken';

export interface ProvisionRecord {
  schema_version: number;
  playwright_version: string;
  provisioned_at: string;
}

export function resolveVeRuntimeDir(): string {
  return join(homedir(), '.paqad-ai', 've-runtime');
}

function provisionRecordPath(veRuntime: string): string {
  return join(veRuntime, 'provision.json');
}

function browsersPath(veRuntime: string): string {
  return join(veRuntime, 'browsers');
}

export function resolvePlaywrightModulePath(veRuntime: string): string {
  const req = createRequire(join(veRuntime, 'package.json'));
  return req.resolve('playwright');
}

export function browserStatus(veRuntime: string = resolveVeRuntimeDir()): BrowserStatus {
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

export function readProvisionRecord(veRuntime: string): ProvisionRecord {
  return JSON.parse(readFileSync(provisionRecordPath(veRuntime), 'utf8')) as ProvisionRecord;
}

export async function provisionBrowser(
  veRuntime: string = resolveVeRuntimeDir(),
  now: () => string = () => new Date().toISOString(),
): Promise<ProvisionRecord> {
  mkdirSync(veRuntime, { recursive: true });
  const pkgPath = join(veRuntime, 'package.json');
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

function readInstalledPlaywrightVersion(veRuntime: string): string {
  const req = createRequire(join(veRuntime, 'package.json'));
  const pkg = JSON.parse(readFileSync(req.resolve('playwright/package.json'), 'utf8')) as {
    version: string;
  };
  return pkg.version;
}

export function veBrowsersPath(veRuntime: string = resolveVeRuntimeDir()): string {
  return browsersPath(veRuntime);
}
