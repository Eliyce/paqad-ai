import type { IncomingMessage, ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';

import { buildNeighbourIndex, buildNodeDetail } from './detail.js';
import { extractGraphWithSidecar, type ChunkContentRecord } from './extractor.js';
import { SimilarityResolver } from './similarity.js';
import type { Graph, SimilarityRequest } from './types.js';

/**
 * The read-only project-graph API, factored out of the old standalone graph
 * server (issue #159) so the dashboard server can mount it as a first-class
 * area. Exposes exactly four routes, all read-only:
 *
 *   GET  /api/graph
 *   GET  /api/node/:id
 *   GET  /api/chunk/:id/content
 *   POST /api/similar
 *
 * Extraction is lazy — the graph is built on the first `/api/graph` hit, not
 * at server boot — and `invalidate()` clears the cache so the next read
 * re-extracts after a `.paqad/` change.
 */
export interface GraphRoutes {
  /**
   * Handle a graph API request. Returns true when the path was one of the
   * graph routes (response written), false to let the caller continue routing.
   */
  handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean>;
  /** Drop the cached graph so the next `/api/graph` read re-extracts. */
  invalidate(): void;
}

function clientAcceptsGzip(req: IncomingMessage): boolean {
  const header = req.headers['accept-encoding'];
  if (!header) return false;
  const value = Array.isArray(header) ? header.join(',') : header;
  return value.toLowerCase().includes('gzip');
}

function writeJson(res: ServerResponse, req: IncomingMessage, body: unknown, status = 200): void {
  const json = JSON.stringify(body);
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  };
  if (clientAcceptsGzip(req)) {
    const gz = gzipSync(json);
    headers['content-encoding'] = 'gzip';
    headers['content-length'] = String(gz.byteLength);
    res.writeHead(status, headers);
    res.end(gz);
    return;
  }
  headers['content-length'] = String(Buffer.byteLength(json));
  res.writeHead(status, headers);
  res.end(json);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      raw += chunk;
      // Cap to 1MB to avoid pathological payloads.
      if (raw.length > 1_048_576) {
        raw = '';
      }
    });
    req.on('end', () => {
      if (!raw) return resolveBody(null);
      try {
        resolveBody(JSON.parse(raw));
      } catch {
        resolveBody(null);
      }
    });
    req.on('error', () => resolveBody(null));
  });
}

export function createGraphRoutes(projectRoot: string): GraphRoutes {
  let cachedGraph: Graph | null = null;
  let cachedChunkContents: Map<string, ChunkContentRecord> = new Map();
  let cachedIndex: ReturnType<typeof buildNeighbourIndex> | null = null;
  let similarityResolver: SimilarityResolver | null = null;

  async function refreshGraph(): Promise<void> {
    const result = await extractGraphWithSidecar({ projectRoot });
    cachedGraph = result.graph;
    cachedChunkContents = result.chunkContents;
    cachedIndex = buildNeighbourIndex(result.graph);
    const nodesById = new Map(
      result.graph.nodes.map((n) => [n.id, { id: n.id, type: n.type, parent_id: n.parent_id }]),
    );
    const childrenIndex = new Map<string, string[]>();
    for (const n of result.graph.nodes) {
      if (!n.parent_id) continue;
      const arr = childrenIndex.get(n.parent_id) ?? [];
      arr.push(n.id);
      childrenIndex.set(n.parent_id, arr);
    }
    similarityResolver = new SimilarityResolver({
      projectRoot,
      vectorIdToNodeId: result.vectorIdToNodeId,
      nodesById,
      childrenIndex,
    });
  }

  async function getGraph(): Promise<Graph> {
    if (!cachedGraph) await refreshGraph();
    return cachedGraph!;
  }

  async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const pathname = url.pathname;

    if (pathname === '/api/graph' && req.method === 'GET') {
      writeJson(res, req, await getGraph());
      return true;
    }

    if (pathname.startsWith('/api/node/') && req.method === 'GET') {
      const nodeId = decodeURIComponent(pathname.slice('/api/node/'.length));
      const graph = await getGraph();
      const detail = buildNodeDetail(graph, nodeId, {
        chunkContents: cachedChunkContents,
        index: cachedIndex ?? undefined,
      });
      if (!detail) {
        writeJson(res, req, { error: `Unknown node: ${nodeId}` }, 404);
        return true;
      }
      writeJson(res, req, detail);
      return true;
    }

    if (
      pathname.startsWith('/api/chunk/') &&
      pathname.endsWith('/content') &&
      req.method === 'GET'
    ) {
      const inner = pathname.slice('/api/chunk/'.length, -'/content'.length);
      const chunkId = decodeURIComponent(inner);
      await getGraph();
      const record = cachedChunkContents.get(chunkId);
      if (!record) {
        writeJson(res, req, { error: `Unknown chunk: ${chunkId}` }, 404);
        return true;
      }
      writeJson(res, req, {
        chunk_id: record.chunkId,
        file: record.fileRelPath,
        chunk_index: record.chunkIndex,
        content: record.content,
      });
      return true;
    }

    if (pathname === '/api/similar' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const request = body as Partial<SimilarityRequest> | null;
      if (
        !request ||
        typeof request.threshold !== 'number' ||
        !request.scope ||
        typeof request.scope.type !== 'string'
      ) {
        writeJson(res, req, { error: 'Invalid similarity request body' }, 400);
        return true;
      }
      await getGraph();
      if (!similarityResolver) {
        writeJson(res, req, { error: 'Similarity resolver not initialised' }, 500);
        return true;
      }
      const response = await similarityResolver.resolve({
        threshold: request.threshold,
        scope: request.scope,
        max_edges: request.max_edges,
      });
      writeJson(res, req, response);
      return true;
    }

    return false;
  }

  return {
    handle,
    invalidate(): void {
      cachedGraph = null;
      cachedChunkContents = new Map();
      cachedIndex = null;
      similarityResolver = null;
    },
  };
}
