import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getModuleMapConfig,
  ModuleMapValidationError,
  putModuleMap,
} from '@/dashboard/config-module-map.js';
import { contentHash, WriteConflictError } from '@/dashboard/write-pipeline.js';

const MAP_PATH = 'docs/instructions/rules/module-map.yml';
const DRIFT_PATH = '.paqad/module-map/drift.json';

const VALID_MAP = [
  'modules:',
  '  - slug: core',
  '    name: Core',
  '    sources:',
  '      - src/core/**',
  '  - slug: dashboard',
  '    name: Dashboard',
  '    sources:',
  '      - src/dashboard/**',
  '',
].join('\n');

function write(root: string, relative: string, content: string): void {
  const full = join(root, relative);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

describe('module map config endpoint logic', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-config-mm-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('getModuleMapConfig', () => {
    it('returns a missing file, no modules, and no drift on a bare project', () => {
      const config = getModuleMapConfig(root);
      expect(config.file.exists).toBe(false);
      expect(config.file.hash).toBeNull();
      expect(config.modules).toEqual([]);
      expect(config.drift).toBeNull();
    });

    it('returns the raw file, the lenient module parse, and the drift report', () => {
      write(root, MAP_PATH, VALID_MAP);
      write(
        root,
        DRIFT_PATH,
        JSON.stringify({
          generated_at: '2026-06-12T00:00:00.000Z',
          source_roots: ['src'],
          findings: [],
          blocked: null,
          counts: {},
        }),
      );
      const config = getModuleMapConfig(root);
      expect(config.file.exists).toBe(true);
      expect(config.file.content).toBe(VALID_MAP);
      expect(config.file.hash).toBe(contentHash(VALID_MAP));
      expect(config.modules.map((m) => m.slug)).toEqual(['core', 'dashboard']);
      expect(config.modules[0]?.sources).toEqual(['src/core/**']);
      expect(config.drift?.blocked).toBeNull();
    });
  });

  describe('putModuleMap', () => {
    it('validates, writes, audits, and returns the reparsed modules', () => {
      const result = putModuleMap(root, { content: VALID_MAP, baseHash: null });

      expect(result.hash).toBe(contentHash(VALID_MAP));
      expect(result.modules.map((m) => m.slug)).toEqual(['core', 'dashboard']);
      expect(readFileSync(join(root, MAP_PATH), 'utf8')).toBe(VALID_MAP);
      const audit = readFileSync(join(root, '.paqad/audit.log'), 'utf8');
      expect(audit).toContain('dashboard.config.module-map.write');
      expect(audit).toContain('actor="dashboard"');
    });

    it('accepts an entry identified by name only, mirroring the reconciler tolerance', () => {
      const named = 'modules:\n  - name: Only Named\n';
      const result = putModuleMap(root, { content: named, baseHash: null });
      expect(result.modules[0]?.name).toBe('Only Named');
    });

    it('accepts a mapping without a modules key', () => {
      const result = putModuleMap(root, { content: 'notes: hello\n', baseHash: null });
      expect(result.modules).toEqual([]);
    });

    it('rejects YAML that does not parse, with a root-level issue', () => {
      expect(() => putModuleMap(root, { content: '[unbalanced', baseHash: null })).toThrow(
        ModuleMapValidationError,
      );
      try {
        putModuleMap(root, { content: '[unbalanced', baseHash: null });
      } catch (err) {
        expect((err as ModuleMapValidationError).issues[0]?.path).toBe('/');
      }
    });

    it('rejects non-mapping YAML', () => {
      expect(() => putModuleMap(root, { content: '- a\n- b\n', baseHash: null })).toThrow(
        /YAML mapping/,
      );
    });

    it('rejects a modules key that is not an array', () => {
      let error: ModuleMapValidationError | null = null;
      try {
        putModuleMap(root, { content: 'modules: nope\n', baseHash: null });
      } catch (err) {
        error = err as ModuleMapValidationError;
      }
      expect(error).toBeInstanceOf(ModuleMapValidationError);
      expect(error?.issues[0]?.path).toBe('/modules');
    });

    it('rejects module entries without a slug or name, and writes nothing', () => {
      const invalid = 'modules:\n  - slug: ok\n  - sources:\n      - src/**\n  - plain\n';
      let error: ModuleMapValidationError | null = null;
      try {
        putModuleMap(root, { content: invalid, baseHash: null });
      } catch (err) {
        error = err as ModuleMapValidationError;
      }
      expect(error).toBeInstanceOf(ModuleMapValidationError);
      expect(error?.issues.map((issue) => issue.path)).toEqual(['/modules/1/slug', '/modules/2']);
      expect(() => readFileSync(join(root, MAP_PATH), 'utf8')).toThrow();
    });

    it('propagates a write conflict when the file changed underneath', () => {
      write(root, MAP_PATH, VALID_MAP);
      expect(() =>
        putModuleMap(root, {
          content: VALID_MAP.replace('Core', 'Kernel'),
          baseHash: contentHash('something stale'),
        }),
      ).toThrow(WriteConflictError);
    });

    it('accepts an update that echoes the current hash', () => {
      write(root, MAP_PATH, VALID_MAP);
      const updated = VALID_MAP.replace('Core', 'Kernel');
      const result = putModuleMap(root, { content: updated, baseHash: contentHash(VALID_MAP) });
      expect(result.modules[0]?.name).toBe('Kernel');
    });
  });
});
