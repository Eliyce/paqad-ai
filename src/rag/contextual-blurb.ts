import type { Chunk } from '@/context/types.js';
import { readRawModuleMap } from '@/module-map/reconciler.js';

export type BlurbChunk = Pick<Chunk, 'source_file' | 'ast_node_path' | 'exported_symbols'>;

export interface BlurbContext {
  moduleRole?: string;
}

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

export function contextualizeChunkText(
  chunk: BlurbChunk & { content: string },
  ctx: BlurbContext = {},
): string {
  return `${buildContextualBlurb(chunk, ctx)}\n${chunk.content}`;
}

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
  entries.sort((a, b) => b.prefix.length - a.prefix.length);
  return (file: string): string | undefined => {
    const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '');
    const match = entries.find(
      (entry) => normalized === entry.prefix || normalized.startsWith(`${entry.prefix}/`),
    );
    return match?.name;
  };
}
