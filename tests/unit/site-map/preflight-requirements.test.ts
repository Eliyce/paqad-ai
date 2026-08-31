import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execa = vi.fn();
vi.mock('execa', () => ({ execa }));

const detectSiteMapPrerequisites = vi.fn();
vi.mock('@/site-map/prerequisites.js', () => ({ detectSiteMapPrerequisites }));

const { runPreflight } = await import('@/workflow-preflight/run.js');

const SATISFIED = { satisfied: true, missing: [], status: {} };

let dir: string;
function project(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), 'preflight-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}
const laravelComposer = JSON.stringify({ require: { 'laravel/framework': '^11.0' } });
const cliPkg = JSON.stringify({ dependencies: { commander: '^12.0' } });

/** No preflight probe may ever boot the app: assert artisan / route:list is never spawned. */
function assertNeverSpawnedArtisan(): void {
  for (const call of execa.mock.calls) {
    const args = (call[1] ?? []) as string[];
    expect(args).not.toContain('artisan');
    expect(args.join(' ')).not.toContain('route:list');
  }
}

function resultFor(res: Awaited<ReturnType<typeof runPreflight>>, id: string) {
  return res.requirements.find((r) => r.id === id);
}

describe('site-map preflight requirements', () => {
  beforeEach(() => {
    execa.mockReset();
    execa.mockResolvedValue({ exitCode: 0 });
    detectSiteMapPrerequisites.mockReset();
    detectSiteMapPrerequisites.mockReturnValue(SATISFIED);
  });
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('does not declare laravel-route-list on a non-Laravel project (AC-5)', async () => {
    const res = await runPreflight(project({ 'package.json': cliPkg }), 'site-map');
    expect(res.requirements.map((r) => r.id)).not.toContain('laravel-route-list');
    // A Node CLI project with commander maps its CLI, and the docs prereqs are satisfied.
    expect(resultFor(res, 'node-cli-program')?.outcome).toBe('ok');
    expect(res.ok).toBe(true);
    assertNeverSpawnedArtisan();
  });

  it('a Laravel project with php present gives needs-decision, never spawning artisan (AC-5)', async () => {
    const res = await runPreflight(
      project({
        'composer.json': laravelComposer,
        artisan: '#!/usr/bin/env php',
        'package.json': cliPkg,
      }),
      'site-map',
    );
    expect(resultFor(res, 'laravel-route-list')?.outcome).toBe('needs-decision');
    expect(res.questions.map((q) => q.id)).toContain('laravel-route-list');
    // The presence check went through `php --version`, and nothing else.
    expect(execa).toHaveBeenCalledWith('php', ['--version'], expect.anything());
    assertNeverSpawnedArtisan();
  });

  it('a Laravel project without php gives unavailable (AC-5)', async () => {
    execa.mockResolvedValue({ exitCode: 127 });
    const res = await runPreflight(
      project({ 'composer.json': laravelComposer, artisan: 'x', 'package.json': cliPkg }),
      'site-map',
    );
    expect(resultFor(res, 'laravel-route-list')?.outcome).toBe('unavailable');
    assertNeverSpawnedArtisan();
  });

  it('treats a thrown php probe as unavailable, never crashing preflight', async () => {
    execa.mockRejectedValue(new Error('spawn php ENOENT'));
    const res = await runPreflight(
      project({ 'composer.json': laravelComposer, artisan: 'x', 'package.json': cliPkg }),
      'site-map',
    );
    expect(resultFor(res, 'laravel-route-list')?.outcome).toBe('unavailable');
  });

  it('a Laravel project with no artisan file is unavailable', async () => {
    const res = await runPreflight(
      project({ 'composer.json': laravelComposer, 'package.json': cliPkg }),
      'site-map',
    );
    expect(resultFor(res, 'laravel-route-list')?.outcome).toBe('unavailable');
  });

  it('node-cli-program is unavailable when no CLI program is discoverable', async () => {
    const res = await runPreflight(project({ 'package.json': JSON.stringify({}) }), 'site-map');
    expect(resultFor(res, 'node-cli-program')?.outcome).toBe('unavailable');
  });

  it('node-cli-program is ok from a bin entry alone', async () => {
    const res = await runPreflight(
      project({ 'package.json': JSON.stringify({ bin: { app: './cli.js' } }) }),
      'site-map',
    );
    expect(resultFor(res, 'node-cli-program')?.outcome).toBe('ok');
  });

  it('documentation-foundation and module-docs are unavailable when the prerequisite is missing', async () => {
    detectSiteMapPrerequisites.mockReturnValue({
      satisfied: false,
      missing: [
        { workflow: 'create documentation', reason: 'x' },
        { workflow: 'create module documentation', reason: 'y' },
      ],
      status: {},
    });
    const res = await runPreflight(project({ 'package.json': cliPkg }), 'site-map');
    expect(resultFor(res, 'documentation-foundation')?.outcome).toBe('unavailable');
    expect(resultFor(res, 'module-docs')?.outcome).toBe('unavailable');
  });
});
