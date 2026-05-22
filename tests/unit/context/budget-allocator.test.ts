import { BudgetAllocator } from '@/context/budget-allocator.js';
import type { Chunk } from '@/context/types.js';

describe('BudgetAllocator', () => {
  describe('packChunks', () => {
    it('skips duplicate chunks that share the same content hash', () => {
      const allocator = new BudgetAllocator();
      const chunks: Chunk[] = [
        makeChunk('first', 'same-hash', 'duplicate body'),
        makeChunk('second', 'same-hash', 'duplicate body'),
        makeChunk('third', 'unique-hash', 'unique body'),
      ];

      expect(allocator.packChunks(chunks, 100).map((chunk) => chunk.id)).toEqual([
        'first',
        'third',
      ]);
    });

    it('falls back to normalized content when content hashes are missing', () => {
      const allocator = new BudgetAllocator();
      const chunks: Chunk[] = [
        makeChunk('first', '', 'const total = value + 1;\n'),
        makeChunk('second', '', 'const total = value + 1;'),
        makeChunk('third', '', 'const total = value + 2;'),
      ];

      expect(allocator.packChunks(chunks, 100).map((chunk) => chunk.id)).toEqual([
        'first',
        'third',
      ]);
    });
  });

  describe('allocate — default ratios (no hints)', () => {
    it('uses 40/45/15 split when no hints are provided', () => {
      const allocator = new BudgetAllocator();
      const result = allocator.allocate(1000);

      expect(result.critical_budget).toBe(400);
      expect(result.task_relevant_budget).toBe(450);
      expect(result.supporting_budget).toBe(150);
    });

    it('uses default ratios when hints object is provided but both fields are undefined', () => {
      const allocator = new BudgetAllocator();
      const result = allocator.allocate(1000, {});

      expect(result.critical_budget).toBe(400);
      expect(result.task_relevant_budget).toBe(450);
      expect(result.supporting_budget).toBe(150);
    });

    it('uses default ratios for medium complexity with no scope', () => {
      const allocator = new BudgetAllocator();
      const result = allocator.allocate(1000, { complexity: 'medium' });

      expect(result.critical_budget).toBe(400);
      expect(result.task_relevant_budget).toBe(450);
      expect(result.supporting_budget).toBe(150);
    });
  });

  describe('allocate — trivial / single-file preset (55/40/5)', () => {
    it('uses minimal supporting budget for trivial complexity', () => {
      const allocator = new BudgetAllocator();
      const result = allocator.allocate(1000, { complexity: 'trivial' });

      expect(result.critical_budget).toBe(550);
      expect(result.task_relevant_budget).toBe(400);
      expect(result.supporting_budget).toBe(50);
    });

    it('uses minimal supporting budget for single-file scope', () => {
      const allocator = new BudgetAllocator();
      const result = allocator.allocate(1000, { scope: 'single-file' });

      expect(result.critical_budget).toBe(550);
      expect(result.task_relevant_budget).toBe(400);
      expect(result.supporting_budget).toBe(50);
    });

    it('trivial complexity takes priority over low scope signal', () => {
      const allocator = new BudgetAllocator();
      // trivial matches first preset before low/single-module can match
      const result = allocator.allocate(1000, { complexity: 'trivial', scope: 'single-module' });

      expect(result.critical_budget).toBe(550);
      expect(result.supporting_budget).toBe(50);
    });
  });

  describe('allocate — low / single-module preset (50/42/8)', () => {
    it('uses small supporting budget for low complexity', () => {
      const allocator = new BudgetAllocator();
      const result = allocator.allocate(1000, { complexity: 'low' });

      expect(result.critical_budget).toBe(500);
      expect(result.task_relevant_budget).toBe(420);
      expect(result.supporting_budget).toBe(80);
    });

    it('uses small supporting budget for single-module scope', () => {
      const allocator = new BudgetAllocator();
      const result = allocator.allocate(1000, { scope: 'single-module' });

      expect(result.critical_budget).toBe(500);
      expect(result.task_relevant_budget).toBe(420);
      expect(result.supporting_budget).toBe(80);
    });
  });

  describe('allocate — very-high / system-wide preset (35/40/25)', () => {
    it('uses large supporting budget for very-high complexity', () => {
      const allocator = new BudgetAllocator();
      const result = allocator.allocate(1000, { complexity: 'very-high' });

      expect(result.critical_budget).toBe(350);
      expect(result.task_relevant_budget).toBe(400);
      expect(result.supporting_budget).toBe(250);
    });

    it('uses large supporting budget for system-wide scope', () => {
      const allocator = new BudgetAllocator();
      const result = allocator.allocate(1000, { scope: 'system-wide' });

      expect(result.critical_budget).toBe(350);
      expect(result.task_relevant_budget).toBe(400);
      expect(result.supporting_budget).toBe(250);
    });
  });

  describe('allocate — high / multi-module preset (38/42/20)', () => {
    it('uses moderately large supporting budget for high complexity', () => {
      const allocator = new BudgetAllocator();
      const result = allocator.allocate(1000, { complexity: 'high' });

      expect(result.critical_budget).toBe(380);
      expect(result.task_relevant_budget).toBe(420);
      expect(result.supporting_budget).toBe(200);
    });

    it('uses moderately large supporting budget for multi-module scope', () => {
      const allocator = new BudgetAllocator();
      const result = allocator.allocate(1000, { scope: 'multi-module' });

      expect(result.critical_budget).toBe(380);
      expect(result.task_relevant_budget).toBe(420);
      expect(result.supporting_budget).toBe(200);
    });
  });

  describe('allocate — floor rounding', () => {
    it('floors fractional token values', () => {
      const allocator = new BudgetAllocator();
      // 100 * 0.4 = 40 exactly, 100 * 0.45 = 45 exactly, 100 * 0.15 = 15 exactly
      const result = allocator.allocate(100);

      expect(result.critical_budget).toBe(40);
      expect(result.task_relevant_budget).toBe(45);
      expect(result.supporting_budget).toBe(15);
    });

    it('floors fractional values under trivial preset', () => {
      const allocator = new BudgetAllocator();
      // 7 * 0.55 = 3.85 → 3, 7 * 0.4 = 2.8 → 2, 7 * 0.05 = 0.35 → 0
      const result = allocator.allocate(7, { complexity: 'trivial' });

      expect(result.critical_budget).toBe(3);
      expect(result.task_relevant_budget).toBe(2);
      expect(result.supporting_budget).toBe(0);
    });
  });

  describe('allocate — supporting budget decreases for simpler work', () => {
    it('trivial requests have a smaller supporting budget than medium', () => {
      const allocator = new BudgetAllocator();
      const trivial = allocator.allocate(1000, { complexity: 'trivial' });
      const medium = allocator.allocate(1000, { complexity: 'medium' });

      expect(trivial.supporting_budget).toBeLessThan(medium.supporting_budget);
    });

    it('system-wide requests have a larger supporting budget than medium', () => {
      const allocator = new BudgetAllocator();
      const systemWide = allocator.allocate(1000, { scope: 'system-wide' });
      const medium = allocator.allocate(1000, { complexity: 'medium' });

      expect(systemWide.supporting_budget).toBeGreaterThan(medium.supporting_budget);
    });
  });
});

function makeChunk(id: string, contentHash: string, content: string): Chunk {
  return {
    id,
    source_file: `${id}.ts`,
    ast_node_type: 'fallback',
    ast_node_path: id,
    exported_symbols: [],
    content,
    char_count: content.replace(/\s/g, '').length,
    content_hash: contentHash,
  };
}
