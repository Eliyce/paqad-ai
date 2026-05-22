import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { createGzip, gzipSync } from 'node:zlib';
import { AddressInfo } from 'node:net';

import { buildNeighbourIndex, buildNodeDetail } from './detail.js';
import { extractGraphWithSidecar, type ChunkContentRecord } from './extractor.js';
import { SimilarityResolver } from './similarity.js';
import type { Graph, SimilarityRequest } from './types.js';
import { startPaqadWatcher, type RunningWatcher } from './watcher.js';

export interface GraphServerOptions {
  projectRoot: string;
  host: string;
  port: number;
  staticDir: string;
  /** If false, the server does not watch `.paqad/` for changes. */
  watch?: boolean;
  /** Quiet period for the watcher in milliseconds. Default 500. */
  watchDebounceMs?: number;
}

export interface RunningGraphServer {
  url: string;
  host: string;
  port: number;
  close: () => Promise<void>;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
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
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
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

function writeText(res: ServerResponse, body: string, status = 200): void {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
  });
  res.end(body);
}

function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  staticDir: string,
  urlPath: string,
): void {
  const safePath = normalize(urlPath).replace(/^[/\\]+/, '');
  let filePath = join(staticDir, safePath);
  const resolved = resolve(filePath);
  if (!resolved.startsWith(resolve(staticDir))) {
    writeText(res, 'Forbidden', 403);
    return;
  }
  if (!existsSync(filePath)) {
    filePath = join(staticDir, 'index.html');
    if (!existsSync(filePath)) {
      writeText(res, 'Not Found', 404);
      return;
    }
  }
  let st;
  try {
    st = statSync(filePath);
  } catch {
    writeText(res, 'Not Found', 404);
    return;
  }
  if (st.isDirectory()) {
    filePath = join(filePath, 'index.html');
    if (!existsSync(filePath)) {
      writeText(res, 'Not Found', 404);
      return;
    }
  }
  const ext = extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
  const headers: Record<string, string> = {
    'content-type': contentType,
    'cache-control': 'no-cache',
  };
  const shouldGzip =
    clientAcceptsGzip(req) &&
    /^(application\/javascript|text\/|application\/json|image\/svg)/.test(contentType);
  if (shouldGzip) {
    headers['content-encoding'] = 'gzip';
    res.writeHead(200, headers);
    createReadStream(filePath).pipe(createGzip()).pipe(res);
  } else {
    headers['content-length'] = String(st.size);
    res.writeHead(200, headers);
    createReadStream(filePath).pipe(res);
  }
}

async function tryListen(server: Server, host: string, startPort: number): Promise<number> {
  let port = startPort;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await new Promise<void>((resolveListen, rejectListen) => {
        const onError = (err: NodeJS.ErrnoException) => {
          server.off('listening', onListening);
          rejectListen(err);
        };
        const onListening = () => {
          server.off('error', onError);
          resolveListen();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
      const addr = server.address() as AddressInfo | null;
      return addr?.port ?? port;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'EADDRINUSE') {
        port += 1;
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Could not bind to any port starting at ${startPort}`);
}

export async function startGraphServer(options: GraphServerOptions): Promise<RunningGraphServer> {
  let cachedGraph: Graph | null = null;
  let cachedChunkContents: Map<string, ChunkContentRecord> = new Map();
  let cachedIndex: ReturnType<typeof buildNeighbourIndex> | null = null;
  let similarityResolver: SimilarityResolver | null = null;
  const sseClients = new Set<ServerResponse>();
  let watcher: RunningWatcher | null = null;

  async function refreshGraph(): Promise<void> {
    const result = await extractGraphWithSidecar({ projectRoot: options.projectRoot });
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
      projectRoot: options.projectRoot,
      vectorIdToNodeId: result.vectorIdToNodeId,
      nodesById,
      childrenIndex,
    });
  }

  async function getGraph(): Promise<Graph> {
    if (!cachedGraph) await refreshGraph();
    return cachedGraph!;
  }

  function broadcastSse(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) {
      try {
        res.write(payload);
      } catch {
        // ignore — failed client will be cleaned up by its 'close' handler
      }
    }
  }

  async function onArtefactChange(): Promise<void> {
    try {
      await refreshGraph();
      broadcastSse('graph-updated', {
        extracted_at: cachedGraph?.meta.extracted_at ?? new Date().toISOString(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      broadcastSse('graph-error', { message });
    }
  }

  // Warm-load so first request is fast.
  await getGraph();

  if (options.watch !== false) {
    watcher = startPaqadWatcher({
      projectRoot: options.projectRoot,
      debounceMs: options.watchDebounceMs,
      onChange: onArtefactChange,
    });
  }

  const server = createServer((req, res) => {
    void handleRequest(req, res).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      writeJson(res, req, { error: message }, 500);
    });
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${options.host}:${options.port}`);
    const pathname = url.pathname;
    if (pathname === '/api/health') {
      writeJson(res, req, { ok: true });
      return;
    }
    if (pathname === '/api/graph') {
      const graph = await getGraph();
      writeJson(res, req, graph);
      return;
    }
    if (pathname === '/api/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.write('retry: 5000\n\n');
      sseClients.add(res);
      const heartbeat = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          /* ignore */
        }
      }, 20000);
      const cleanup = (): void => {
        clearInterval(heartbeat);
        sseClients.delete(res);
      };
      req.on('close', cleanup);
      req.on('error', cleanup);
      return;
    }
    if (pathname.startsWith('/api/node/')) {
      const nodeId = decodeURIComponent(pathname.slice('/api/node/'.length));
      const graph = await getGraph();
      const detail = buildNodeDetail(graph, nodeId, {
        chunkContents: cachedChunkContents,
        index: cachedIndex ?? undefined,
      });
      if (!detail) {
        writeJson(res, req, { error: `Unknown node: ${nodeId}` }, 404);
        return;
      }
      writeJson(res, req, detail);
      return;
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
        return;
      }
      await getGraph();
      if (!similarityResolver) {
        writeJson(res, req, { error: 'Similarity resolver not initialised' }, 500);
        return;
      }
      const response = await similarityResolver.resolve({
        threshold: request.threshold,
        scope: request.scope,
        max_edges: request.max_edges,
      });
      writeJson(res, req, response);
      return;
    }
    if (pathname.startsWith('/api/chunk/') && pathname.endsWith('/content')) {
      const inner = pathname.slice('/api/chunk/'.length, -'/content'.length);
      const chunkId = decodeURIComponent(inner);
      await getGraph();
      const record = cachedChunkContents.get(chunkId);
      if (!record) {
        writeJson(res, req, { error: `Unknown chunk: ${chunkId}` }, 404);
        return;
      }
      writeJson(res, req, {
        chunk_id: record.chunkId,
        file: record.fileRelPath,
        chunk_index: record.chunkIndex,
        content: record.content,
      });
      return;
    }
    if (pathname.startsWith('/api/')) {
      writeJson(res, req, { error: `Unknown endpoint: ${pathname}` }, 404);
      return;
    }
    serveStatic(req, res, options.staticDir, pathname === '/' ? '/index.html' : pathname);
  }

  const boundPort = await tryListen(server, options.host, options.port);
  const url = `http://${options.host}:${boundPort}`;

  return {
    url,
    host: options.host,
    port: boundPort,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        watcher?.close();
        watcher = null;
        for (const res of sseClients) {
          try {
            res.end();
          } catch {
            /* ignore */
          }
        }
        sseClients.clear();
        server.close((err) => (err ? rejectClose(err) : resolveClose()));
      }),
  };
}
