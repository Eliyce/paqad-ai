/**
 * Deterministic contextual blurbs (RAG buildout F24).
 *
 * A bare code chunk embeds and lexically-matches poorly because it has lost the context
 * that says what it IS — which file it lives in, the symbol it belongs to, the module it
 * serves. Prepending a short, deterministic "blurb" with that context before embedding
 * (and before BM25) restores it, which is a large, cheap retrieval-quality win with NO
 * per-chunk LLM call (the published cAST/contextual-retrieval result is a ~49% drop in
 * retrieval failures).
 *
 * Everything here is pure and deterministic — built from the chunk's own fields plus the
 * project module map. The stored `chunk.content` is never modified; only the text fed to
 * the embedder / lexical index is contextualised, so the slice the model is shown stays
 * clean. Enabling blurbs changes what the index holds, so it rides the `CHUNKER_VERSION`
 * seam (F22): a pre-blurb index reads as a mismatch and is cleanly rebuilt.
 */
import type { Chunk } from '@/context/types.js';
import { readRawModuleMap } from '@/module-map/reconciler.js';

/** The chunk fields a blurb is built from (a subset of {@link Chunk}). */
export type BlurbChunk = Pick<Chunk, 'source_file' | 'ast_node_path' | 'exported_symbols'>;

export interface BlurbContext {
  /** The module-map role/name for the chunk's file, when known (index-time enrichment). */
  moduleRole?: string;
}

/**
 * Build the one-line blurb: file path, then the enclosing signature (the chunk's AST
 * node path), then any exported symbols, then the module-map role when supplied. Each
 * part is omitted when empty, so a fallback chunk with no symbols still gets at least its
 * path. Deterministic and allocation-light.
 */
export function buildContextualBlurb(chunk: BlurbChunk, ctx: BlurbContext = {}): string {
  const parts: string[] = [chunk.source_file];
  const signature = chunk.ast_node_path?.trim();
  if (signature && signature !== 'full') {
    parts.push(`› ${signature}`);
  }
  if (chunk.exported_symbols && chunk.exported_symbols.length > 0) {
    parts.push(`exports ${chunk.exported_symbols.join(', ')}`);
  }
  if (ctx.moduleRole) {
    parts.push(`module: ${ctx.moduleRole}`);
  }
  return `[${parts.join(' · ')}]`;
}

/** Prepend the blurb to the chunk content — the text actually embedded / lexically indexed. */
export function contextualizeChunkText(
  chunk: BlurbChunk & { content: string },
  ctx: BlurbContext = {},
): string {
  return `${buildContextualBlurb(chunk, ctx)}\n${chunk.content}`;
}

/**
 * A file -> module-role resolver built once from the project module map. Returns the
 * module NAME for the longest matching source prefix, or undefined (no map, or no match).
 * Globs/extensions are stripped to a directory/file prefix for matching. Best-effort:
 * any failure yields a resolver that always returns undefined, so blurbs degrade to the
 * path+signature form rather than throwing.
 */
export function buildModuleRoleResolver(projectRoot: string): (file: string) => string | undefined {
  let map: ReturnType<typeof readRawModuleMap>;
  try {
    map = readRawModuleMap(projectRoot);
  } catch {
    return () => undefined;
  }
  if (!map) {
    return () => undefined;
  }
  const entries: { prefix: string; name: string }[] = [];
  for (const mod of map.modules) {
    if (!mod.name) {
      continue;
    }
    for (const source of mod.sources) {
      const prefix = source
        .replace(/\\/g, '/')
        .replace(/[*?[].*$/, '')
        .replace(/\/+$/, '');
      if (prefix) {
        entries.push({ prefix, name: mod.name });
      }
    }
  }
  // Longest prefix wins, so a nested module beats its parent.
  entries.sort((a, b) => b.prefix.length - a.prefix.length);
  return (file: string): string | undefined => {
    const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '');
    const match = entries.find(
      (entry) => normalized === entry.prefix || normalized.startsWith(`${entry.prefix}/`),
    );
    return match?.name;
  };
}
