import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  describeOptionalEngine,
  loadOptionalPackage,
  maybeStartOptionalEngineInstall,
  resolveOptionalPackage,
} from '@/core/optional-package.js';

const FAKE = 'paqad-fake-engine';

let root: string;

const FAKE_ENTRY_SUFFIX = join('node_modules', FAKE, 'index.cjs');

function seedFakePackage(dir: string): void {
  const pkgDir = join(dir, 'node_modules', FAKE);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, 'package.json'),
    JSON.stringify({ name: FAKE, version: '1.0.0', main: 'index.cjs' }),
    'utf8',
  );
  writeFileSync(join(pkgDir, 'index.cjs'), 'module.exports = { answer: () => 42 };\n', 'utf8');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-optional-pkg-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('resolveOptionalPackage', () => {
  it('resolves a normally-installed dependency through hop 1', () => {
    const resolved = resolveOptionalPackage('execa', {});
    expect(resolved).toContain('execa');
  });

  it('returns null when the package exists in none of the three locations', () => {
    expect(resolveOptionalPackage(FAKE, { PAQAD_FRAMEWORK_HOME: join(root, 'gone') })).toBeNull();
  });

  it('resolves from ${CLAUDE_PLUGIN_DATA}/node_modules (hop 2)', () => {
    seedFakePackage(root);
    const resolved = resolveOptionalPackage(FAKE, {
      CLAUDE_PLUGIN_DATA: root,
      PAQAD_FRAMEWORK_HOME: join(root, 'gone'),
    });
    expect(resolved?.endsWith(FAKE_ENTRY_SUFFIX)).toBe(true);
  });

  it('resolves from the npm copy one level above the framework link (hop 3a)', () => {
    const pkgRoot = join(root, 'npm-copy');
    seedFakePackage(pkgRoot);
    mkdirSync(join(pkgRoot, 'runtime'), { recursive: true });
    const link = join(root, 'current');
    symlinkSync(join(pkgRoot, 'runtime'), link);
    const resolved = resolveOptionalPackage(FAKE, { PAQAD_FRAMEWORK_HOME: link });
    expect(resolved?.endsWith(FAKE_ENTRY_SUFFIX)).toBe(true);
  });
});

describe('loadOptionalPackage', () => {
  it('loads a normally-installed dependency through the bare import (hop 1)', async () => {
    const mod = await loadOptionalPackage<{ execa: unknown }>('execa', {});
    expect(typeof mod.execa).toBe('function');
  });

  it('loads a resolved package with its named exports intact', async () => {
    seedFakePackage(root);
    const mod = await loadOptionalPackage<{ answer: () => number }>(FAKE, {
      CLAUDE_PLUGIN_DATA: root,
      PAQAD_FRAMEWORK_HOME: join(root, 'gone'),
    });
    expect(mod.answer()).toBe(42);
  });

  it('rejects when the package is installed nowhere', async () => {
    await expect(
      loadOptionalPackage(FAKE, { PAQAD_FRAMEWORK_HOME: join(root, 'gone') }),
    ).rejects.toThrow(/not installed/);
  });
});

const MARKER = '.paqad-engine-install.json';
const LOCK = '.paqad-engine-install.lock';
const NONE = () => null;

describe('maybeStartOptionalEngineInstall', () => {
  it('does nothing outside a plugin (no CLAUDE_PLUGIN_DATA)', () => {
    const start = vi.fn();
    expect(maybeStartOptionalEngineInstall({}, { startInstall: start })).toBe('no-plugin-data');
    expect(start).not.toHaveBeenCalled();
  });

  it('skips when the engine already resolves', () => {
    const start = vi.fn();
    expect(
      maybeStartOptionalEngineInstall(
        { CLAUDE_PLUGIN_DATA: root },
        { resolve: () => '/somewhere/transformers.cjs', startInstall: start },
      ),
    ).toBe('already-present');
    expect(start).not.toHaveBeenCalled();
  });

  it('declines when no pinned range can be read', () => {
    expect(
      maybeStartOptionalEngineInstall(
        { CLAUDE_PLUGIN_DATA: root },
        { resolve: NONE, readSpecs: () => [], startInstall: vi.fn() },
      ),
    ).toBe('no-pinned-range');
  });

  it('starts the install, writing the lock and installing marker', () => {
    const start = vi.fn();
    const now = () => Date.parse('2026-10-17T00:00:00.000Z');
    const outcome = maybeStartOptionalEngineInstall(
      { CLAUDE_PLUGIN_DATA: root },
      { resolve: NONE, readSpecs: () => ['pkg@^1'], startInstall: start, now },
    );
    expect(outcome).toBe('started');
    expect(start).toHaveBeenCalledWith(['pkg@^1'], root, expect.anything(), undefined);
    expect(existsSync(join(root, LOCK))).toBe(true);
    const marker = JSON.parse(readFileSync(join(root, MARKER), 'utf8')) as { status: string };
    expect(marker.status).toBe('installing');
  });

  it('hands the project root to the installer so it rebuilds the index after the install', () => {
    const start = vi.fn();
    const outcome = maybeStartOptionalEngineInstall(
      { CLAUDE_PLUGIN_DATA: root },
      { resolve: NONE, readSpecs: () => ['pkg@^1'], startInstall: start, now: () => 0 },
      { projectRoot: '/work/repo' },
    );
    expect(outcome).toBe('started');
    expect(start).toHaveBeenCalledWith(['pkg@^1'], root, expect.anything(), '/work/repo');
  });

  it('pins the real package.json ranges when readSpecs is not injected', () => {
    const pkgRoot = join(root, 'npm-copy');
    mkdirSync(join(pkgRoot, 'runtime'), { recursive: true });
    writeFileSync(
      join(pkgRoot, 'package.json'),
      JSON.stringify({
        dependencies: {
          '@huggingface/transformers': '^4.3.1',
          openai: '^7.23.0',
        },
      }),
    );
    const link = join(root, 'current');
    symlinkSync(join(pkgRoot, 'runtime'), link);
    const installDir = join(root, 'plugin-data');
    const start = vi.fn();
    const outcome = maybeStartOptionalEngineInstall(
      { CLAUDE_PLUGIN_DATA: installDir, PAQAD_FRAMEWORK_HOME: link },
      { resolve: NONE, startInstall: start, now: () => 0 },
    );
    expect(outcome).toBe('started');
    expect(start).toHaveBeenCalledWith(
      ['@huggingface/transformers@^4.3.1', 'openai@^7.23.0'],
      installDir,
      expect.anything(),
      undefined,
    );
  });

  it('declines with no pinned range when the package.json cannot be read', () => {
    const start = vi.fn();
    expect(
      maybeStartOptionalEngineInstall(
        { CLAUDE_PLUGIN_DATA: join(root, 'plugin-data'), PAQAD_FRAMEWORK_HOME: join(root, 'gone') },
        { resolve: NONE, startInstall: start, now: () => 0 },
      ),
    ).toBe('no-pinned-range');
    expect(start).not.toHaveBeenCalled();
  });

  it('is single-flight: an installing marker with a live lock reports in-progress', () => {
    writeFileSync(
      join(root, MARKER),
      JSON.stringify({ status: 'installing', attempted_at: new Date().toISOString() }),
    );
    writeFileSync(join(root, LOCK), '123');
    const start = vi.fn();
    expect(
      maybeStartOptionalEngineInstall(
        { CLAUDE_PLUGIN_DATA: root },
        { resolve: NONE, startInstall: start },
      ),
    ).toBe('in-progress');
    expect(start).not.toHaveBeenCalled();
  });

  it('throttles a retry within 24h of the last attempt', () => {
    const attempted = Date.parse('2026-10-17T00:00:00.000Z');
    writeFileSync(
      join(root, MARKER),
      JSON.stringify({ status: 'failed', attempted_at: new Date(attempted).toISOString() }),
    );
    const start = vi.fn();
    expect(
      maybeStartOptionalEngineInstall(
        { CLAUDE_PLUGIN_DATA: root },
        { resolve: NONE, startInstall: start, now: () => attempted + 60_000 },
      ),
    ).toBe('throttled');
    expect(start).not.toHaveBeenCalled();
  });

  it('retries a failed attempt older than 24h', () => {
    const attempted = Date.parse('2026-10-15T00:00:00.000Z');
    writeFileSync(
      join(root, MARKER),
      JSON.stringify({ status: 'failed', attempted_at: new Date(attempted).toISOString() }),
    );
    const start = vi.fn();
    expect(
      maybeStartOptionalEngineInstall(
        { CLAUDE_PLUGIN_DATA: root },
        {
          resolve: NONE,
          readSpecs: () => ['pkg@^1'],
          startInstall: start,
          now: () => attempted + 25 * 60 * 60 * 1000,
        },
      ),
    ).toBe('started');
    expect(start).toHaveBeenCalledOnce();
  });
});

describe('describeOptionalEngine', () => {
  it('reports ready when the engine resolves', () => {
    expect(describeOptionalEngine({}, { resolve: () => '/x/transformers.cjs' })).toEqual({
      state: 'ready',
    });
  });

  it('uses the real resolver by default (the engine is installed in this repo)', () => {
    expect(describeOptionalEngine({})).toEqual({ state: 'ready' });
  });

  it('reports not installed when it resolves nowhere and there is no plugin data', () => {
    expect(describeOptionalEngine({}, { resolve: NONE })).toEqual({ state: 'not installed' });
  });

  it('reports install failed with an empty detail when the marker has no error field', () => {
    writeFileSync(
      join(root, MARKER),
      JSON.stringify({ status: 'failed', attempted_at: new Date().toISOString() }),
    );
    const report = describeOptionalEngine({ CLAUDE_PLUGIN_DATA: root }, { resolve: NONE });
    expect(report.state).toBe('install failed');
    expect(report.detail).toBe('');
  });

  it('reports installing from the marker', () => {
    writeFileSync(
      join(root, MARKER),
      JSON.stringify({ status: 'installing', attempted_at: new Date().toISOString() }),
    );
    expect(describeOptionalEngine({ CLAUDE_PLUGIN_DATA: root }, { resolve: NONE })).toEqual({
      state: 'installing',
    });
  });

  it('reports the first error line and the network hint when the install failed', () => {
    writeFileSync(
      join(root, MARKER),
      JSON.stringify({
        status: 'failed',
        attempted_at: new Date().toISOString(),
        error: 'npm ERR! network ETIMEDOUT\nsecond line',
      }),
    );
    const report = describeOptionalEngine({ CLAUDE_PLUGIN_DATA: root }, { resolve: NONE });
    expect(report.state).toBe('install failed');
    expect(report.detail).toBe('npm ERR! network ETIMEDOUT');
    expect(report.hint).toContain('npm install @huggingface/transformers');
  });

  it('reports not installed with plugin data but no marker', () => {
    expect(describeOptionalEngine({ CLAUDE_PLUGIN_DATA: root }, { resolve: NONE })).toEqual({
      state: 'not installed',
    });
  });
});
