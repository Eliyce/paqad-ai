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
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  bootstrapFramework,
  bootstrapFrameworkHome,
  frameworkSymlinkType,
} from '@/install/bootstrap';
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

  it('bootstrapFrameworkHome writes the framework home but no project metadata', () => {
    const home = mkdtempSync(join(tmpdir(), 'paqad-home-only-'));
    const savedHome = process.env.HOME;
    const savedUserProfile = process.env.USERPROFILE;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    try {
      const result = bootstrapFrameworkHome();

      expect(result.framework_home).toBe(frameworkHome);
      expect(lstatSync(frameworkHome).isSymbolicLink()).toBe(true);
      expect(existsSync(join(home, '.claude/agents/paqad-planning.md'))).toBe(true);
      expect(existsSync(join(projectRoot, '.paqad/framework-path.txt'))).toBe(false);
      expect(existsSync(join(projectRoot, '.paqad/schema-version.json'))).toBe(false);
    } finally {
      if (savedHome === undefined) delete process.env.HOME;
      else process.env.HOME = savedHome;
      if (savedUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = savedUserProfile;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('AC-27: onboarding writes the home Claude agents only when the plugin is not installed', () => {
    const home = mkdtempSync(join(tmpdir(), 'paqad-home-plugin-'));
    const savedHome = process.env.HOME;
    const savedUserProfile = process.env.USERPROFILE;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    try {
      bootstrapFrameworkHome();
      expect(existsSync(join(home, '.claude/agents/paqad-development.md'))).toBe(true);

      rmSync(join(home, '.claude'), { recursive: true, force: true });
      mkdirSync(join(home, '.claude/plugins'), { recursive: true });
      writeFileSync(
        join(home, '.claude/plugins/installed_plugins.json'),
        JSON.stringify({ plugins: { 'paqad@eliyce': [{}] } }),
      );
      bootstrapFrameworkHome();
      expect(existsSync(join(home, '.claude/agents'))).toBe(false);
      expect(existsSync(join(home, '.codex/agents/paqad-development.toml'))).toBe(true);
    } finally {
      if (savedHome === undefined) delete process.env.HOME;
      else process.env.HOME = savedHome;
      if (savedUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = savedUserProfile;
      rmSync(home, { recursive: true, force: true });
    }
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
    bootstrapFramework(projectRoot);

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

  it('replaces a dangling framework symlink left by a deleted runtime', () => {
    const staleTarget = mkdtempSync(join(tmpdir(), 'paqad-stale-runtime-'));
    symlinkSync(staleTarget, frameworkHome);
    rmSync(staleTarget, { recursive: true, force: true });

    expect(existsSync(frameworkHome)).toBe(false);
    expect(lstatSync(frameworkHome).isSymbolicLink()).toBe(true);

    expect(() => bootstrapFramework(projectRoot)).not.toThrow();
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

  describe('stage-agent generation', () => {
    let userHome: string;
    let savedHome: string | undefined;
    let savedUserProfile: string | undefined;

    beforeEach(() => {
      userHome = mkdtempSync(join(tmpdir(), 'paqad-install-userhome-'));
      savedHome = process.env.HOME;
      savedUserProfile = process.env.USERPROFILE;
      process.env.HOME = userHome;
      process.env.USERPROFILE = userHome;
    });

    afterEach(() => {
      rmSync(userHome, { recursive: true, force: true });
      const restore = (key: 'HOME' | 'USERPROFILE', value?: string) => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      };
      restore('HOME', savedHome);
      restore('USERPROFILE', savedUserProfile);
    });

    it('writes the six stage agents and the two High Table agents (AC-46) for Claude and Codex under the user home', () => {
      bootstrapFramework(projectRoot);
      const claudeAgents = join(userHome, '.claude/agents');
      const codexAgents = join(userHome, '.codex/agents');
      expect(existsSync(claudeAgents)).toBe(true);
      expect(readdirSync(claudeAgents).filter((f) => f.endsWith('.md'))).toHaveLength(8);
      expect(readdirSync(codexAgents).filter((f) => f.endsWith('.toml'))).toHaveLength(8);
      for (const name of ['paqad-expert', 'paqad-chief-architect']) {
        expect(existsSync(join(claudeAgents, `${name}.md`))).toBe(true);
        expect(existsSync(join(codexAgents, `${name}.toml`))).toBe(true);
      }
      expect(existsSync(join(projectRoot, '.claude'))).toBe(false);
      expect(existsSync(join(projectRoot, '.codex'))).toBe(false);
    });
  });
});

describe('frameworkSymlinkType', () => {
  const original = process.platform;
  const setPlatform = (value: string) =>
    Object.defineProperty(process, 'platform', { value, configurable: true });

  afterEach(() => setPlatform(original));

  it('is a junction on Windows and the default elsewhere', () => {
    setPlatform('win32');
    expect(frameworkSymlinkType()).toBe('junction');
    setPlatform('darwin');
    expect(frameworkSymlinkType()).toBeUndefined();
  });
});
