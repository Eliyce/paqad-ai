import { applyMetadataFilters } from '@/context/metadata-filter.js';
import type { Chunk } from '@/context/types.js';

function makeChunk(id: string, sourceFile: string): Chunk {
  return {
    id,
    source_file: sourceFile,
    ast_node_type: 'function',
    ast_node_path: id,
    exported_symbols: [],
    content: `export function ${id}() {}`,
    char_count: 20,
    content_hash: id,
  };
}

const CHUNKS = [
  makeChunk('auth', 'src/auth/service.ts'),
  makeChunk('billing', 'src/billing/invoice.ts'),
  makeChunk('session', 'src/auth/session.ts'),
  makeChunk('app', 'src/app.tsx'),
];

describe('applyMetadataFilters — file_extension', () => {
  it('retains only .ts files when filtered', () => {
    const result = applyMetadataFilters(CHUNKS, [{ type: 'file_extension', value: '.ts' }]);
    expect(result.fallback).toBe(false);
    expect(result.chunks.every((c) => c.source_file.endsWith('.ts'))).toBe(true);
  });

  it('retains only .tsx files when filtered (minFilteredSize=1)', () => {
    const result = applyMetadataFilters(CHUNKS, [{ type: 'file_extension', value: '.tsx' }], {
      minFilteredSize: 1,
    });
    expect(result.fallback).toBe(false);
    expect(result.chunks.map((c) => c.id)).toEqual(['app']);
  });
});

describe('applyMetadataFilters — module_path_prefix', () => {
  it('retains chunks under src/auth/ (minFilteredSize=2)', () => {
    const result = applyMetadataFilters(
      CHUNKS,
      [{ type: 'module_path_prefix', value: 'src/auth' }],
      { minFilteredSize: 2 },
    );
    expect(result.fallback).toBe(false);
    expect(result.chunks.map((c) => c.id)).toEqual(['auth', 'session']);
  });

  it('matches absolute source_file paths using a repo-relative prefix', () => {
    const absoluteChunks = [
      makeChunk('auth-abs', '/Users/test-user/project/src/auth/service.ts'),
      makeChunk('billing-abs', '/Users/test-user/project/src/billing/invoice.ts'),
      makeChunk('session-abs', '/Users/test-user/project/src/auth/session.ts'),
    ];
    const result = applyMetadataFilters(
      absoluteChunks,
      [{ type: 'module_path_prefix', value: 'src/auth' }],
      { minFilteredSize: 2 },
    );
    expect(result.fallback).toBe(false);
    expect(result.chunks.map((c) => c.id)).toEqual(['auth-abs', 'session-abs']);
  });

  it('falls back when filtered set is below min threshold', () => {
    // Only 'billing' matches — 1 chunk < default min 3
    const result = applyMetadataFilters(CHUNKS, [
      { type: 'module_path_prefix', value: 'src/billing' },
    ]);
    expect(result.fallback).toBe(true);
    expect(result.fallback_reason).toBe('below-min-threshold');
    // Fallback returns the full original set
    expect(result.chunks).toHaveLength(CHUNKS.length);
  });

  it('clears filter_types_applied when fallback returns the unfiltered corpus', () => {
    const result = applyMetadataFilters(CHUNKS, [
      { type: 'module_path_prefix', value: 'src/billing' },
    ]);
    expect(result.filter_types_applied).toEqual([]);
  });

  it('clears all attempted filter types when a multi-filter pipeline falls back', () => {
    const result = applyMetadataFilters(
      CHUNKS,
      [
        { type: 'module_path_prefix', value: 'src/auth' },
        { type: 'file_extension', value: '.tsx' },
      ],
      { minFilteredSize: 2 },
    );

    expect(result.fallback).toBe(true);
    expect(result.chunks).toEqual(CHUNKS);
    expect(result.filter_types_applied).toEqual([]);
  });
});

describe('applyMetadataFilters — framework', () => {
  it('matches chunks whose source file contains the framework name', () => {
    const reactChunks = [
      makeChunk('header', 'src/react/Header.tsx'),
      makeChunk('footer', 'src/vue/Footer.vue'),
    ];
    const result = applyMetadataFilters(reactChunks, [{ type: 'framework', value: 'react' }], {
      minFilteredSize: 1,
    });
    expect(result.chunks.map((c) => c.id)).toEqual(['header']);
  });

  it('matches react chunks by .tsx extension when framework name is not in path', () => {
    const chunks = [
      makeChunk('component', 'src/components/App.tsx'),
      makeChunk('service', 'src/services/api.ts'),
      makeChunk('page', 'src/pages/index.jsx'),
    ];
    const result = applyMetadataFilters(chunks, [{ type: 'framework', value: 'react' }], {
      minFilteredSize: 1,
    });
    expect(result.fallback).toBe(false);
    expect(result.chunks.map((c) => c.id)).toEqual(expect.arrayContaining(['component', 'page']));
    expect(result.chunks.map((c) => c.id)).not.toContain('service');
  });

  it('matches laravel chunks by .php extension when framework name is not in path', () => {
    const chunks = [
      makeChunk('controller', 'app/Http/Controllers/UserController.php'),
      makeChunk('model', 'app/Models/User.php'),
      makeChunk('config', 'config/app.ts'),
    ];
    const result = applyMetadataFilters(chunks, [{ type: 'framework', value: 'laravel' }], {
      minFilteredSize: 2,
    });
    expect(result.fallback).toBe(false);
    expect(result.chunks.map((c) => c.id)).toEqual(expect.arrayContaining(['controller', 'model']));
    expect(result.chunks.map((c) => c.id)).not.toContain('config');
  });

  it('matches vue chunks by .vue extension', () => {
    const chunks = [makeChunk('app-vue', 'src/App.vue'), makeChunk('app-tsx', 'src/App.tsx')];
    const result = applyMetadataFilters(chunks, [{ type: 'framework', value: 'vue' }], {
      minFilteredSize: 1,
    });
    expect(result.fallback).toBe(false);
    expect(result.chunks.map((c) => c.id)).toEqual(['app-vue']);
  });

  it('falls back when an unknown framework has no path or extension matches', () => {
    const result = applyMetadataFilters(CHUNKS, [{ type: 'framework', value: 'sveltekit' }], {
      minFilteredSize: 1,
    });
    expect(result.fallback).toBe(true);
    expect(result.fallback_reason).toBe('below-min-threshold');
  });
});

describe('applyMetadataFilters — recency_cutoff_ms', () => {
  it('accepts all chunks without modified_at_ms (no data available)', () => {
    const result = applyMetadataFilters(CHUNKS, [{ type: 'recency_cutoff_ms', value: 1000 }]);
    // No modified_at_ms on any chunk → all accepted (conservative)
    expect(result.chunks).toHaveLength(CHUNKS.length);
  });

  it('filters by modified_at_ms when available', () => {
    const now = Date.now();
    const recentChunk = { ...makeChunk('recent', 'src/recent.ts'), modified_at_ms: now - 100 };
    const oldChunk = { ...makeChunk('old', 'src/old.ts'), modified_at_ms: now - 100_000 };

    const result = applyMetadataFilters(
      [recentChunk, oldChunk] as Chunk[],
      [{ type: 'recency_cutoff_ms', value: 1000 }],
      { minFilteredSize: 1 },
    );
    expect(result.chunks.map((c) => c.id)).toContain('recent');
    expect(result.chunks.map((c) => c.id)).not.toContain('old');
  });

  it('does not false-match sibling module names when filtering by module_path_prefix', () => {
    const chunks = [
      makeChunk('auth', '/repo/src/auth/service.ts'),
      makeChunk('authz', '/repo/src/authz/policy.ts'),
    ];
    const result = applyMetadataFilters(
      chunks,
      [{ type: 'module_path_prefix', value: 'src/auth' }],
      { minFilteredSize: 1 },
    );

    expect(result.fallback).toBe(false);
    expect(result.chunks.map((c) => c.id)).toEqual(['auth']);
  });
});

describe('applyMetadataFilters — edge cases', () => {
  it('returns all chunks when filters array is empty', () => {
    const result = applyMetadataFilters(CHUNKS, []);
    expect(result.chunks).toHaveLength(CHUNKS.length);
    expect(result.fallback).toBe(false);
    expect(result.filter_types_applied).toHaveLength(0);
  });

  it('returns empty-corpus fallback for empty input', () => {
    const result = applyMetadataFilters([], [{ type: 'file_extension', value: '.ts' }]);
    expect(result.fallback).toBe(true);
    expect(result.fallback_reason).toBe('empty-corpus');
  });

  it('respects custom minFilteredSize', () => {
    // Only 1 .tsx file; with minFilteredSize=1 it should NOT fall back
    const result = applyMetadataFilters(CHUNKS, [{ type: 'file_extension', value: '.tsx' }], {
      minFilteredSize: 1,
    });
    expect(result.fallback).toBe(false);
    expect(result.chunks).toHaveLength(1);
  });

  it('returns the original chunks for unknown filter types at runtime', () => {
    const result = applyMetadataFilters(
      CHUNKS,
      [
        { type: 'unknown-filter', value: 'x' } as unknown as {
          type: 'file_extension';
          value: string;
        },
      ],
      { minFilteredSize: 1 },
    );
    expect(result.fallback).toBe(false);
    expect(result.chunks).toEqual(CHUNKS);
  });
});
