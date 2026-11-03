import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { MigrationDeps, MigrationRecord } from '@/install/plugin-migration.js';

export interface ProjectPluginWorld {
  home: string;
  projectRoot: string;
  cleanup: () => void;
}

export function projectPluginWorld(): ProjectPluginWorld {
  const home = mkdtempSync(join(tmpdir(), 'paqad-project-plugin-home-'));
  const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-project-plugin-proj-'));
  mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
  writeFileSync(
    join(projectRoot, '.paqad', 'onboarding-manifest.json'),
    JSON.stringify({ adapter: 'claude-code', generated_artifacts: [] }),
  );
  return {
    home,
    projectRoot,
    cleanup: () => {
      rmSync(home, { recursive: true, force: true });
      rmSync(projectRoot, { recursive: true, force: true });
    },
  };
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

export function installPlugin(
  world: ProjectPluginWorld,
  scope: 'user' | 'project',
  version = '1.116.0',
): void {
  const root = join(world.home, '.claude', 'plugins', 'cache', 'eliyce', 'paqad', version);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'paqad-ai', version }));
  const entry =
    scope === 'project'
      ? { scope, projectPath: world.projectRoot, installPath: root, version }
      : { scope, installPath: root, version };
  writeJson(join(world.home, '.claude', 'plugins', 'installed_plugins.json'), {
    version: 2,
    plugins: { 'paqad@eliyce': [entry] },
  });
}

export function projectSettingsPath(world: ProjectPluginWorld, local = false): string {
  return join(world.projectRoot, '.claude', local ? 'settings.local.json' : 'settings.json');
}

export function userSettingsPath(world: ProjectPluginWorld): string {
  return join(world.home, '.claude', 'settings.json');
}

export function turnPluginOn(path: string, on: boolean, extra: Record<string, unknown> = {}): void {
  writeJson(path, { ...extra, enabledPlugins: { 'paqad@eliyce': on } });
}

export function writeRecord(world: ProjectPluginWorld, record: MigrationRecord): void {
  writeJson(join(world.home, '.paqad-ai', 'plugin-migration.json'), record);
}

export function migrationDeps(
  world: ProjectPluginWorld,
  lines: string[],
  over: Partial<MigrationDeps> = {},
): MigrationDeps {
  return {
    env: { PAQAD_PLUGIN_MIGRATION: 'on' },
    home: world.home,
    now: () => new Date('2026-11-02T12:00:00Z'),
    version: '1.116.0',
    claudeVersion: () => '2.1.302',
    runClaudeInstall: () => ({ ok: true }),
    bundledClaude: () => null,
    managedSettingsPaths: [],
    log: (message) => lines.push(message),
    ...over,
  };
}
