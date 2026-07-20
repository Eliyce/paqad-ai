import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execaSync } from 'execa';

import type { Chunk, ChunkIndex } from '@/context/types.js';

/** Make a Chunk record for a fixture chunk index (absolute source_file, like the real index). */
export function fixtureChunk(id: string, sourceFile: string, content: string): Chunk {
  return {
    id,
    source_file: sourceFile,
    ast_node_type: 'function',
    ast_node_path: id,
    exported_symbols: [],
    content,
    char_count: content.replace(/\s/g, '').length,
    content_hash: id,
  };
}

/** Create a git-initialised tmp project and return its root. */
export function makeGitProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-dup-'));
  execaSync('git', ['init', '-q'], { cwd: root });
  execaSync('git', ['config', 'user.email', 'test@paqad.dev'], { cwd: root });
  execaSync('git', ['config', 'user.name', 'paqad test'], { cwd: root });
  return root;
}

/** Write a file (creating parent dirs) inside the project. */
export function writeProjectFile(root: string, relPath: string, content: string): void {
  const abs = join(root, relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

/** Commit everything currently in the working tree. */
export function commitAll(root: string, message = 'base'): void {
  execaSync('git', ['add', '-A'], { cwd: root });
  execaSync('git', ['commit', '-qm', message], { cwd: root });
}

/** Write a minimal code-knowledge index carrying the given symbols. */
export function writeCodeKnowledgeIndex(
  root: string,
  symbols: Array<{ name: string; file: string; line: number; caller_count: number }>,
): void {
  const index = {
    schema_version: 1,
    header: {
      generated_at: 'x',
      branch: null,
      head_commit: null,
      schema_version: 1,
      entry_point_globs: [],
    },
    symbols: symbols.map((symbol) => ({
      name: symbol.name,
      kind: 'function' as const,
      file: symbol.file,
      line: symbol.line,
      signature: `${symbol.name}()`,
      exported: true,
      module_slug: null,
      extraction_tier: 'regex' as const,
      caller_count: symbol.caller_count,
      orphan: false,
    })),
    files: [],
    import_edges: [],
    reference_edges: [],
    dependencies: [],
  };
  writeProjectFile(root, '.paqad/indexes/code-knowledge.json', JSON.stringify(index));
}

/** Write a chunk index built from `{ relPath: content }` entries (one chunk per file). */
export function writeChunkIndex(root: string, files: Record<string, string>): void {
  const entries = Object.entries(files).map(([relPath, content], index) => {
    const abs = join(root, relPath);
    return {
      source_file: abs,
      source_file_hash: `h${index}`,
      modified_at: 'x',
      chunks: [fixtureChunk(`c${index}`, abs, content.trim())],
    };
  });
  const index: ChunkIndex = { version: 1, generated_at: 'x', entries };
  writeProjectFile(root, '.paqad/context/chunk-index.json', JSON.stringify(index));
}
