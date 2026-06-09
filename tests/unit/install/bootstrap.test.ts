import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { bootstrapFramework } from '@/install/bootstrap';
import { getRuntimeRoot } from '@/core/runtime-paths';
import { PAQAD_SCHEMA_VERSION } from '@/core/constants/schema';
import { clearEngineLogger, engineLog, getConsumerLogger } from '@/core/logger-registry';
import type { EngineLogEntry } from '@/core/types/logger';
import { VERSION } from '@/index';

describe('bootstrapFramework', () => {
  let projectRoot: string;
  let frameworkHome: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-install-project-'));
    frameworkHome = mkdtempSync(join(tmpdir(), 'paqad-install-home-'));
    // Remove the dir so bootstrapFramework can create the symlink in its place
    rmSync(frameworkHome, { recursive: true, force: true });
    originalEnv = process.env.PAQAD_FRAMEWORK_HOME;
    process.env.PAQAD_FRAMEWORK_HOME = frameworkHome;
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    if (existsSync(frameworkHome)) rmSync(frameworkHome, { recursive: true, force: true });
    if (originalEnv === undefined) {
      delete process.env.PAQAD_FRAMEWORK_HOME;
    } else {
      process.env.PAQAD_FRAMEWORK_HOME = originalEnv;
    }
  });

  it('creates a symlink at the framework home path', () => {
    bootstrapFramework(projectRoot);

    expect(existsSync(frameworkHome)).toBe(true);
    const stat = lstatSync(frameworkHome);
    expect(stat.isSymbolicLink()).toBe(true);
  });

  it('symlink points to the package runtime directory', () => {
    bootstrapFramework(projectRoot);

    expect(realpathSync(frameworkHome)).toBe(getRuntimeRoot());
  });

  it('symlink target contains expected framework content directories', () => {
    bootstrapFramework(projectRoot);

    const entries = readdirSync(frameworkHome);
    expect(entries).toContain('base');
    expect(entries).toContain('capabilities');
    expect(entries).toContain('templates');
  });

  it('is idempotent — replaces an existing symlink on re-run', () => {
    bootstrapFramework(projectRoot);
    bootstrapFramework(projectRoot); // second run should not throw

    const stat = lstatSync(frameworkHome);
    expect(stat.isSymbolicLink()).toBe(true);
  });

  it('is idempotent when the expected framework symlink already exists', () => {
    bootstrapFramework(projectRoot);

    expect(() => bootstrapFramework(projectRoot)).not.toThrow();
    expect(realpathSync(frameworkHome)).toBe(getRuntimeRoot());
  });

  it('replaces a pre-existing plain directory with a symlink', () => {
    mkdirSync(frameworkHome, { recursive: true });

    expect(() => bootstrapFramework(projectRoot)).toThrow(
      'Refusing to replace existing framework home directory',
    );
  });

  it('replaces a pre-existing non-directory symlink target with the expected symlink', () => {
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
    rmSync(frameworkHome, { force: true, recursive: true });
    symlinkSync(join(projectRoot, '.paqad'), frameworkHome);

    bootstrapFramework(projectRoot);

    const stat = lstatSync(frameworkHome);
    expect(stat.isSymbolicLink()).toBe(true);
    expect(realpathSync(frameworkHome)).toBe(getRuntimeRoot());
  });

  it('writes framework-path.txt using a machine-safe reference', () => {
    bootstrapFramework(projectRoot);

    const content = readFileSync(join(projectRoot, '.paqad/framework-path.txt'), 'utf8').trim();
    expect(content).toBe('$PAQAD_FRAMEWORK_HOME');
  });

  it('writes framework-version.txt with the current package version', () => {
    bootstrapFramework(projectRoot);

    const content = readFileSync(join(projectRoot, '.paqad/framework-version.txt'), 'utf8');
    expect(content).toContain(`version=${VERSION}`);
    expect(content).toMatch(/^updated_at=/m);
  });

  it('returns correct metadata', () => {
    const result = bootstrapFramework(projectRoot);

    expect(result.framework_home).toBe(frameworkHome);
    expect(result.project_root).toBe(projectRoot);
    expect(result.version).toBe(VERSION);
  });

  it('installs a consumer logger when one is passed (PQD-105)', () => {
    const entries: EngineLogEntry[] = [];
    try {
      bootstrapFramework(projectRoot, {
        logger: {
          log(entry) {
            entries.push(entry);
          },
        },
      });

      expect(getConsumerLogger()).not.toBeNull();
      engineLog('warn', 'after-bootstrap');
      expect(entries).toEqual([{ level: 'warn', message: 'after-bootstrap' }]);
    } finally {
      clearEngineLogger();
    }
  });

  it('leaves the logger untouched when no logger option is passed (PQD-105)', () => {
    try {
      bootstrapFramework(projectRoot);
      expect(getConsumerLogger()).toBeNull();
    } finally {
      clearEngineLogger();
    }
  });

  it('stamps the cross-artifact schema marker (PQD-95)', () => {
    bootstrapFramework(projectRoot);

    const marker = JSON.parse(
      readFileSync(join(projectRoot, '.paqad/schema-version.json'), 'utf8'),
    );
    expect(marker.paqad_schema_version).toBe(PAQAD_SCHEMA_VERSION);
    expect(marker.written_by_engine_version).toBe(VERSION);
    expect(typeof marker.written_at).toBe('string');
  });
});
