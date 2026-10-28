import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { cosineSimilarity } from '@/core/math/cosine.js';

import type {
  GraphEdge,
  SimilarityRequest,
  SimilarityRequestScope,
  SimilarityResponse,
} from './types.js';

interface VectorItem {
  id: string;
  vector: number[];
}

interface VectorIndexFile {
  version: number;
  dimensions: number;
  items: VectorItem[];
}

export interface SimilarityResolverOptions {
  projectRoot: string;
  vectorIdToNodeId: Map<string, string>;
  nodesById: Map<string, { id: string; type: string; parent_id: string | null }>;
  childrenIndex: Map<string, string[]>;
  cacheSize?: number;
  defaultMaxEdges?: number;
}

interface ResolvedScope {
  candidates: Set<string> | null;
  echo: SimilarityRequestScope;
}

interface CacheEntry {
  response: SimilarityResponse;
}

function descendantChunks(
  rootId: string,
  nodes: Map<string, { id: string; type: string; parent_id: string | null }>,
  children: Map<string, string[]>,
): Set<string> {
  const out = new Set<string>();
  const stack: string[] = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    const node = nodes.get(id);
    if (!node) continue;
    if (node.type === 'chunk') {
      out.add(id);
      continue;
    }
    const kids = children.get(id);
    if (kids) for (const k of kids) stack.push(k);
  }
  return out;
}

function resolveScope(
  scope: SimilarityRequestScope,
  nodes: Map<string, { id: string; type: string; parent_id: string | null }>,
  children: Map<string, string[]>,
): ResolvedScope {
  if (scope.type === 'all' || !scope.id) {
    return { candidates: null, echo: { type: scope.type, id: scope.id ?? null } };
  }
  if (scope.type === 'chunk') {
    return { candidates: new Set([scope.id]), echo: scope };
  }
  return { candidates: descendantChunks(scope.id, nodes, children), echo: scope };
}

export class SimilarityResolver {
  private vectorPath: string;
  private vectorItems: VectorItem[] | null = null;
  private loadedAtMtimeMs: number = -1;
  private nodeIdByVectorId: Map<string, string>;
  private cache = new Map<string, CacheEntry>();
  private readonly cacheSize: number;
  private readonly defaultMaxEdges: number;
  private readonly nodes: Map<string, { id: string; type: string; parent_id: string | null }>;
  private readonly children: Map<string, string[]>;

  constructor(options: SimilarityResolverOptions) {
    this.vectorPath = join(options.projectRoot, PATHS.VECTOR_INDEX);
    this.nodeIdByVectorId = options.vectorIdToNodeId;
    this.cacheSize = options.cacheSize ?? 16;
    this.defaultMaxEdges = options.defaultMaxEdges ?? 10000;
    this.nodes = options.nodesById;
    this.children = options.childrenIndex;
  }

  isAvailable(): boolean {
    return existsSync(this.vectorPath);
  }

  currentMtimeMs(): number | null {
    try {
      return statSync(this.vectorPath).mtimeMs;
    } catch {
      return null;
    }
  }

  invalidate(): void {
    this.cache.clear();
    this.vectorItems = null;
    this.loadedAtMtimeMs = -1;
  }

  private async loadIfNeeded(): Promise<void> {
    const mtime = this.currentMtimeMs();
    if (mtime === null) {
      this.vectorItems = [];
      this.loadedAtMtimeMs = -1;
      return;
    }
    if (this.vectorItems && mtime === this.loadedAtMtimeMs) return;
    const raw = await readFile(this.vectorPath, 'utf8');
    const parsed = JSON.parse(raw) as VectorIndexFile;
    this.vectorItems = parsed.items ?? [];
    this.loadedAtMtimeMs = mtime;
    this.cache.clear();
  }

  async resolve(request: SimilarityRequest): Promise<SimilarityResponse> {
    if (!this.isAvailable()) {
      return { threshold: request.threshold, scope: request.scope, edges: [], capped: false };
    }
    const threshold = clamp(request.threshold, 0, 1);
    const maxEdges = request.max_edges ?? this.defaultMaxEdges;
    await this.loadIfNeeded();
    const mtime = this.loadedAtMtimeMs;
    const cacheKey = cacheKeyFor(request.scope, threshold, maxEdges, mtime);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      return cached.response;
    }

    const { candidates } = resolveScope(request.scope, this.nodes, this.children);
    const items = this.vectorItems ?? [];

    const projected: { nodeId: string; vec: number[] }[] = [];
    for (const item of items) {
      const nodeId = this.nodeIdByVectorId.get(item.id);
      if (!nodeId) continue;
      projected.push({ nodeId, vec: item.vector });
    }

    const edges: GraphEdge[] = [];
    const seenPairs = new Set<string>();
    let capped = false;

    if (candidates && candidates.size === 1 && request.scope.type === 'chunk') {
      const anchorId = request.scope.id!;
      const anchor = projected.find((p) => p.nodeId === anchorId);
      if (anchor) {
        for (const other of projected) {
          if (other.nodeId === anchor.nodeId) continue;
          const score = cosineSimilarity(anchor.vec, other.vec);
          if (score < threshold) continue;
          const pairKey = pairKeyOf(anchor.nodeId, other.nodeId);
          if (seenPairs.has(pairKey)) continue;
          seenPairs.add(pairKey);
          edges.push(makeEdge(anchor.nodeId, other.nodeId, score));
          if (edges.length >= maxEdges) {
            capped = true;
            break;
          }
        }
      }
    } else {
      const scoped = candidates ? projected.filter((p) => candidates.has(p.nodeId)) : projected;
      outer: for (let i = 0; i < scoped.length; i++) {
        const a = scoped[i]!;
        for (let j = i + 1; j < scoped.length; j++) {
          const b = scoped[j]!;
          const score = cosineSimilarity(a.vec, b.vec);
          if (score < threshold) continue;
          const pairKey = pairKeyOf(a.nodeId, b.nodeId);
          if (seenPairs.has(pairKey)) continue;
          seenPairs.add(pairKey);
          edges.push(makeEdge(a.nodeId, b.nodeId, score));
          if (edges.length >= maxEdges) {
            capped = true;
            break outer;
          }
        }
      }
    }

    const response: SimilarityResponse = {
      threshold,
      scope: request.scope,
      edges,
      capped,
    };
    if (this.cache.size >= this.cacheSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(cacheKey, { response });
    return response;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function pairKeyOf(a: string, b: string): string {
  return a < b ? `${a}\x01${b}` : `${b}\x01${a}`;
}

function makeEdge(a: string, b: string, score: number): GraphEdge {
  const [s, t] = a < b ? [a, b] : [b, a];
  return {
    id: `e:similar:${s}->${t}`,
    type: 'similar',
    source: s,
    target: t,
    weight: score,
    attributes: { depth: null },
  };
}

function cacheKeyFor(
  scope: SimilarityRequestScope,
  threshold: number,
  maxEdges: number,
  mtime: number,
): string {
  return `${scope.type}|${scope.id ?? ''}|${threshold.toFixed(4)}|${maxEdges}|${mtime}`;
}
