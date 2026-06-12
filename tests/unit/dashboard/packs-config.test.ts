import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  installPack,
  listPacks,
  PackNameError,
  removePack,
  type PacksRootsOverrides,
} from '@/dashboard/packs-config.js';

/**
 * Minimal pack.yaml that satisfies the stack-pack schema — the same shape
 * `paqad-ai packs create` scaffolds (mirrors runtime/.../stacks/react).
 */
function packYaml(name: string, version: string): string {
  return [
    `name: ${name}`,
    `display_name: ${name}`,
    'ecosystem: node',
    `version: ${version}`,
    `description: ${name} test pack`,
    'maintainer: tests',
    'detection:',
    '  manifests:',
    '    - file: package.json',
    `      packages: [${name}]`,
    '',
  ].join('\n');
}

function writePack(parentDir: string, name: string, version = '1.0.0'): string {
  const packRoot = join(parentDir, name);
  mkdirSync(packRoot, { recursive: true });
  writeFileSync(join(packRoot, 'pack.yaml'), packYaml(name, version));
  return packRoot;
}

function readAudit(root: string): string {
  const path = join(root, '.paqad/audit.log');
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

describe('dashboard packs config', () => {
  let projectRoot: string;
  let runtimeRoot: string;
  let globalPacksRoot: string;
  let stage: string;
  let overrides: PacksRootsOverrides;
  let builtInStacks: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-packs-project-'));
    runtimeRoot = mkdtempSync(join(tmpdir(), 'paqad-packs-runtime-'));
    globalPacksRoot = mkdtempSync(join(tmpdir(), 'paqad-packs-global-'));
    stage = mkdtempSync(join(tmpdir(), 'paqad-packs-stage-'));
    builtInStacks = join(runtimeRoot, 'capabilities', 'coding', 'stacks');
    mkdirSync(builtInStacks, { recursive: true });
    overrides = { runtimeRoot, globalPacksRoot };
  });

  afterEach(() => {
    for (const dir of [projectRoot, runtimeRoot, globalPacksRoot, stage]) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('listPacks', () => {
    it('returns an empty list when no source directory has packs', () => {
      expect(listPacks(projectRoot, overrides)).toEqual([]);
    });

    it('lists packs from every source with name, version, and validity', () => {
      writePack(builtInStacks, 'alpha', '1.0.0');
      writePack(globalPacksRoot, 'beta', '2.1.0');
      writePack(join(projectRoot, '.paqad', 'packs'), 'gamma', '0.3.0');

      expect(listPacks(projectRoot, overrides)).toEqual([
        { name: 'alpha', source: 'built-in', version: '1.0.0', valid: true },
        { name: 'beta', source: 'global', version: '2.1.0', valid: true },
        { name: 'gamma', source: 'project', version: '0.3.0', valid: true },
      ]);
    });

    it('lets a project pack win over built-in and global copies of the same name', () => {
      writePack(builtInStacks, 'alpha', '1.0.0');
      writePack(globalPacksRoot, 'alpha', '1.1.0');
      writePack(join(projectRoot, '.paqad', 'packs'), 'alpha', '2.0.0');

      expect(listPacks(projectRoot, overrides)).toEqual([
        { name: 'alpha', source: 'project', version: '2.0.0', valid: true },
      ]);
    });

    it('keeps an invalid pack visible with valid: false', () => {
      // A directory without pack.yaml is the loader's missing-manifest case.
      mkdirSync(join(globalPacksRoot, 'broken-pack'), { recursive: true });

      expect(listPacks(projectRoot, overrides)).toEqual([
        { name: 'broken-pack', source: 'global', version: '0.0.0', valid: false },
      ]);
    });

    it('skips convention and hidden directories, like the loader does', () => {
      mkdirSync(join(builtInStacks, '_shared', 'rules'), { recursive: true });
      mkdirSync(join(builtInStacks, '.git'), { recursive: true });
      writePack(builtInStacks, 'alpha');

      expect(listPacks(projectRoot, overrides).map((pack) => pack.name)).toEqual(['alpha']);
    });
  });

  describe('installPack', () => {
    it('installs a local pack into global scope and audits it', async () => {
      const source = writePack(stage, 'fresh-pack', '3.0.0');

      const result = await installPack(projectRoot, { source, roots: overrides });

      expect(result).toEqual({
        name: 'fresh-pack',
        version: '3.0.0',
        scope: 'global',
        root: join(globalPacksRoot, 'fresh-pack'),
      });
      expect(existsSync(join(globalPacksRoot, 'fresh-pack', 'pack.yaml'))).toBe(true);

      const audit = readAudit(projectRoot);
      expect(audit).toContain('dashboard.packs.install');
      expect(audit).toContain('pack="fresh-pack"');
      expect(audit).toContain('actor="dashboard"');
    });

    it('installs into project scope under .paqad/packs', async () => {
      const source = writePack(stage, 'proj-pack');

      const result = await installPack(projectRoot, {
        source,
        scope: 'project',
        roots: overrides,
      });

      expect(result.scope).toBe('project');
      expect(existsSync(join(projectRoot, '.paqad', 'packs', 'proj-pack', 'pack.yaml'))).toBe(true);
    });

    it('rejects an invalid pack before anything lands in the scope dir', async () => {
      const source = join(stage, 'invalid-pack');
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, 'pack.yaml'), 'name: Invalid Name\n');

      await expect(installPack(projectRoot, { source, roots: overrides })).rejects.toThrow(
        /error/i,
      );
      expect(existsSync(join(globalPacksRoot, 'Invalid Name'))).toBe(false);
      expect(readAudit(projectRoot)).not.toContain('dashboard.packs.install');
    });
  });

  describe('removePack', () => {
    it('rejects unsafe names before touching the filesystem', () => {
      for (const name of ['../evil', 'UPPER', 'has space', '.hidden', '']) {
        expect(() => removePack(projectRoot, { name, roots: overrides })).toThrow(PackNameError);
      }
      expect(readAudit(projectRoot)).not.toContain('dashboard.packs.remove');
    });

    it('removes a global pack and audits it', () => {
      writePack(globalPacksRoot, 'doomed-pack');

      const result = removePack(projectRoot, { name: 'doomed-pack', roots: overrides });

      expect(result).toEqual({ name: 'doomed-pack', scope: 'global', removed: true });
      expect(existsSync(join(globalPacksRoot, 'doomed-pack'))).toBe(false);

      const audit = readAudit(projectRoot);
      expect(audit).toContain('dashboard.packs.remove');
      expect(audit).toContain('pack="doomed-pack"');
    });

    it('removes a project pack when scope is project', () => {
      writePack(join(projectRoot, '.paqad', 'packs'), 'local-pack');

      removePack(projectRoot, { name: 'local-pack', scope: 'project', roots: overrides });

      expect(existsSync(join(projectRoot, '.paqad', 'packs', 'local-pack'))).toBe(false);
    });

    it('refuses to remove a built-in pack', () => {
      writePack(builtInStacks, 'alpha');

      expect(() => removePack(projectRoot, { name: 'alpha', roots: overrides })).toThrow(
        /built-in/,
      );
      expect(existsSync(join(builtInStacks, 'alpha'))).toBe(true);
    });

    it('reports a pack that is not installed in the scope', () => {
      expect(() => removePack(projectRoot, { name: 'ghost-pack', roots: overrides })).toThrow(
        /not installed/,
      );
    });
  });
});
