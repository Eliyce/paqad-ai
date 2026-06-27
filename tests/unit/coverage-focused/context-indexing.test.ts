import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { AstChunker } from '@/context/ast-chunker.js';
import { ChunkIndexManager } from '@/context/chunk-index.js';
import { buildDetectionReport } from '@/detection/report.js';

describe('coverage context indexing', () => {
  describe('AstChunker', () => {
    it('chunks TypeScript, PHP, and Dart source using language-specific parsing', () => {
      // merge=false: assert the raw boundary detection (the cAST "split"); the merge pass
      // is covered in ast-chunker.test.ts.
      const chunker = new AstChunker(40, false);
      const ts = ['export function alpha() { return 1; }', '', 'export class Beta {}'].join('\n');
      const php = ['<?php', 'class Example {}', '', 'public function save() {}'].join('\n');
      const dart = ['abstract class Example {}', '', 'void render() {}'].join('\n');

      const tsChunks = chunker.chunk('demo.ts', ts);
      const phpChunks = chunker.chunk('demo.php', php);
      const dartChunks = chunker.chunk('demo.dart', dart);

      expect(tsChunks.map((chunk) => chunk.ast_node_path)).toEqual(['alpha', 'Beta']);
      expect(tsChunks[0]?.exported_symbols).toEqual(['alpha']);
      expect(phpChunks.map((chunk) => chunk.ast_node_path)).toEqual(['Example', 'save']);
      expect(dartChunks.map((chunk) => chunk.ast_node_path)).toEqual(['class', 'render']);
    });

    it('splits large TypeScript segments at method boundaries', () => {
      const chunker = new AstChunker(20, false);
      const content = [
        'class Huge {',
        'first() { return 1; }',
        'second() { return 2; }',
        'third() { return 3; }',
        '}',
      ].join('\n');

      const chunks = chunker.chunk('huge.ts', content);

      expect(chunks.map((chunk) => chunk.ast_node_type)).toContain('method');
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('falls back for unknown files, empty paragraphs, and parser failures', () => {
      const chunker = new AstChunker(10);
      const fallback = chunker.fallbackSplit('notes.txt', 'one\n\ntwo\n\nthree');
      expect(fallback.map((chunk) => chunk.content)).toEqual(['one\n\ntwo', 'three']);

      const single = chunker.fallbackSplit('empty.txt', '   ');
      expect(single).toHaveLength(1);
      expect(single[0]?.ast_node_path).toBe('full');

      const throwing = new AstChunker();
      const throwingWithParser = throwing as AstChunker & {
        parseTypeScript: (content: string) => never;
      };
      throwingWithParser.parseTypeScript = () => {
        throw new Error('boom');
      };
      const rescued = throwing.chunk('broken.ts', 'const x = 1;');
      expect(rescued[0]?.ast_node_type).toBe('fallback');
    });
  });

  describe('ChunkIndexManager', () => {
    let root: string;
    let manager: ChunkIndexManager;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'paqad-chunk-index-'));
      manager = new ChunkIndexManager(root);
    });

    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it('loads null when the index is missing and can save and reload an index', async () => {
      expect(await manager.load()).toBeNull();

      const index = {
        version: 1 as const,
        generated_at: '2026-03-28T10:00:00.000Z',
        entries: [],
      };

      await manager.save(index);
      await expect(manager.load()).resolves.toEqual(index);
      expect(manager.indexPath).toBe(join(root, '.paqad', 'context', 'chunk-index.json'));
    });

    it('rebuilds from readable files and skips unreadable ones', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-28T10:00:00.000Z'));

      const good = join(root, 'good.ts');
      const bad = join(root, 'missing.ts');
      writeFileSync(good, 'export function alpha() { return 1; }');
      const chunker = new AstChunker();

      const index = await manager.rebuild([good, bad], chunker);

      expect(index.entries).toHaveLength(1);
      expect(index.entries[0]?.source_file).toBe(good);
      expect(index.generated_at).toBe('2026-03-28T10:00:00.000Z');
      await expect(manager.load()).resolves.toEqual(index);
    });

    it('incrementally updates changed files and skips unreadable ones', async () => {
      const file = join(root, 'alpha.ts');
      writeFileSync(file, 'export function alpha() { return 1; }');

      const chunker = new AstChunker();
      const initial = await manager.rebuild([file], chunker);

      writeFileSync(file, 'export function alpha() { return 2; }');
      const updated = await manager.incrementalUpdate(
        [file, join(root, 'missing.ts')],
        initial,
        chunker,
      );

      expect(updated.entries).toHaveLength(1);
      expect(updated.entries[0]?.source_file_hash).not.toBe(initial.entries[0]?.source_file_hash);
      expect(updated.entries[0]?.chunks[0]?.content).toContain('return 2');
    });

    it('detects stale and deleted files', async () => {
      const file = join(root, 'alpha.ts');
      const missing = join(root, 'missing.ts');
      writeFileSync(file, 'export function alpha() { return 1; }');

      const index = await manager.rebuild([file], new AstChunker());
      index.entries.push({
        source_file: missing,
        source_file_hash: 'hash',
        modified_at: new Date().toISOString(),
        chunks: [],
      });

      writeFileSync(file, 'export function alpha() { return 2; }');

      await expect(manager.isStale(index)).resolves.toEqual({
        stale: true,
        changedFiles: expect.arrayContaining([file, missing]),
      });
    });

    it('syncs from scratch, returns unchanged indexes, and handles add/change/delete flows', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-28T10:00:00.000Z'));

      const one = join(root, 'one.ts');
      const two = join(root, 'two.ts');
      const three = join(root, 'three.ts');
      writeFileSync(one, 'export function one() { return 1; }');
      writeFileSync(two, 'export function two() { return 2; }');

      const chunker = new AstChunker();

      const first = await manager.sync([two, one, one], chunker);
      expect(first.updated).toBe(true);
      expect(first.added_files).toEqual([one, two]);
      expect(first.changed_files).toEqual([]);
      expect(first.deleted_files).toEqual([]);

      const unchanged = await manager.sync([one, two], chunker);
      expect(unchanged.updated).toBe(false);
      expect(unchanged.added_files).toEqual([]);
      expect(unchanged.changed_files).toEqual([]);
      expect(unchanged.deleted_files).toEqual([]);

      rmSync(two);
      writeFileSync(one, 'export function one() { return 10; }');
      writeFileSync(three, 'export function three() { return 3; }');

      const changed = await manager.sync([one, three], chunker);
      expect(changed.updated).toBe(true);
      expect(changed.added_files).toEqual([three]);
      expect(changed.changed_files).toEqual([one]);
      expect(changed.deleted_files).toContain(two);
      expect(changed.index.entries.map((entry) => entry.source_file)).toEqual([one, three]);
    });
  });

  describe('buildDetectionReport', () => {
    it('fills defaults and preserves optional values', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-28T10:00:00.000Z'));

      expect(
        buildDetectionReport({
          domain: 'coding',
          stack: 'laravel',
          signals: [],
          confidence: 'high',
        }),
      ).toMatchObject({
        detected_domain: 'coding',
        detected_stack: 'laravel',
        detected_capabilities: [],
        matched_packs: [],
        detected_traits: [],
        recommended_capabilities: ['content'],
        timestamp: '2026-03-28T10:00:00.000Z',
      });

      expect(
        buildDetectionReport({
          domain: null,
          stack: null,
          capabilities: ['boost'],
          matchedPacks: ['laravel'],
          detectedTraits: ['sail'],
          recommendedCapabilities: ['coding', 'security'],
          detectionPhase: 'interactive-onboarding',
          signals: [],
          confidence: 'low',
          repository: { root: '/repo', files: [], indicators: [] },
        }),
      ).toMatchObject({
        detected_capabilities: ['boost'],
        matched_packs: ['laravel'],
        detected_traits: ['sail'],
        recommended_capabilities: ['coding', 'security'],
        detection_phase: 'interactive-onboarding',
        repository: { root: '/repo' },
      });
    });
  });
});
