import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ContextDeduplicator } from '@/resolver/deduplicator.js';
import { goParser } from '@/introspection/ecosystems/go.js';
import { jvmParser } from '@/introspection/ecosystems/jvm.js';
import { pythonParser } from '@/introspection/ecosystems/python.js';
import { rustParser } from '@/introspection/ecosystems/rust.js';

describe('coverage dedup and ecosystems', () => {
  describe('ContextDeduplicator', () => {
    let root: string;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'paqad-dedup-'));
    });

    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it('loads file contents, deduplicates repeated content, persists stats, and supports reset', async () => {
      const deduplicator = new ContextDeduplicator();
      const a = join(root, 'a.md');
      const b = join(root, 'b.md');
      const c = join(root, 'c.md');
      writeFileSync(a, 'same content');
      writeFileSync(b, 'same content');
      writeFileSync(c, 'different');

      const result = await deduplicator.deduplicate(root, [
        { path: a, type: 'rule' },
        { path: b, type: 'rule' },
        { path: c, content: 'different', type: 'doc' },
        { path: join(root, 'missing.md'), type: 'doc' },
      ]);

      expect(result.references.get(b)).toBe(a);
      expect(result.stats).toEqual({
        total_artifacts: 4,
        deduplicated: 1,
        tokens_saved_estimate: Math.ceil('same content'.length / 4),
      });
      expect(result.artifacts[1]?.content).toBe(`[See: ${a} already loaded above]`);
      expect(result.artifacts[2]?.content).toBe('different');
      expect(result.artifacts[3]?.content).toBe('');
      expect(
        JSON.parse(readFileSync(join(root, '.paqad', 'session', 'dedup-stats.json'), 'utf8')),
      ).toEqual(result.stats);

      deduplicator.reset();
      const rerun = await deduplicator.deduplicate(root, [{ path: a, type: 'rule' }]);
      expect(rerun.references.size).toBe(0);
      expect(rerun.artifacts[0]?.content).toBe('same content');
    });
  });

  describe('ecosystem parser edge cases', () => {
    it('parses pom.xml and ignores malformed gradle and lockfile lines', () => {
      expect(
        jvmParser.parseManifest(
          [
            '<project>',
            '<dependency>',
            '<groupId>org.example</groupId>',
            '<artifactId>demo</artifactId>',
            '<version>1.2.3</version>',
            '</dependency>',
            '<dependency>',
            '<groupId>org.no-version</groupId>',
            '<artifactId>demo2</artifactId>',
            '</dependency>',
            '</project>',
          ].join('\n'),
          'pom.xml',
        ).packages,
      ).toEqual([
        { name: 'org.example:demo', constraint: undefined, isDev: false },
        { name: 'org.no-version:demo2', constraint: undefined, isDev: false },
      ]);

      expect(
        jvmParser.parseLockfile(
          '# comment\norg.example:demo=1.2.3\nbroken-line\n',
          'gradle.lockfile',
        ).packages,
      ).toEqual([{ name: 'org.example:demo', version: '1.2.3' }]);
    });

    it('parses pyproject-style manifests, Pipfile.lock, plain lockfiles, go.sum, and Cargo.lock', () => {
      expect(
        pythonParser.parseManifest(
          [
            '[project]',
            'dependencies = [',
            '"fastapi>=0.115.0",',
            '"uvicorn[standard]>=0.30.0",',
            ']',
          ].join('\n'),
          'pyproject.toml',
        ).packages,
      ).toEqual([
        { name: 'dependencies', isDev: false },
        { name: 'fastapi', isDev: false },
        { name: 'uvicorn', isDev: false },
      ]);

      expect(
        pythonParser.parseLockfile(
          JSON.stringify({
            default: { fastapi: { version: '==0.115.0' } },
            develop: { pytest: { version: '==8.0.0' } },
          }),
          'Pipfile.lock',
        ).packages,
      ).toEqual([
        { name: 'fastapi', version: '==0.115.0' },
        { name: 'pytest', version: '==8.0.0' },
      ]);

      expect(
        pythonParser.parseLockfile('fastapi==0.115.0\nuvicorn==0.30.0\n', 'poetry.lock').packages,
      ).toEqual([
        { name: 'fastapi', version: '0.115.0' },
        { name: 'uvicorn', version: '0.30.0' },
      ]);

      expect(
        goParser.parseLockfile('github.com/gin-gonic/gin v1.10.0 h1:abc\ninvalid\n', 'go.sum')
          .packages,
      ).toEqual([{ name: 'github.com/gin-gonic/gin', version: 'v1.10.0' }]);

      expect(
        rustParser.parseLockfile(
          [
            '[[package]]',
            'name = "axum"',
            'version = "0.7.0"',
            '',
            '[[package]]',
            'name = "tokio"',
            'version = "1.0.0"',
          ].join('\n'),
          'Cargo.lock',
        ).packages,
      ).toEqual([
        { name: 'axum', version: '0.7.0' },
        { name: 'tokio', version: '1.0.0' },
      ]);
    });
  });
});
