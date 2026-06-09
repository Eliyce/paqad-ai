import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve } from 'node:path';
import { createGzip, gzipSync } from 'node:zlib';

import { engineLog } from '@/core/logger-registry.js';
import { startPaqadWatcher, type RunningWatcher } from '@/graph/watcher.js';

import { renderMarkdown } from './markdown.js';
import { buildReport } from './report.js';
import type { DashboardReport } from './types.js';

export interface DashboardServerOptions {
  projectRoot: string;
  host: string;
  port: number;
  /** Directory holding the bundled graph-ui SPA (re-used for the dashboard). */
  staticDir: string;
  /** If false, the server does not watch `.paqad/` for changes. */
  watch?: boolean;
  /** Quiet period for the watcher in milliseconds. Default 500. */
  watchDebounceMs?: number;
}

export interface RunningDashboardServer {
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

function writeText(
  res: ServerResponse,
  body: string,
  status = 200,
  contentType = 'text/plain; charset=utf-8',
): void {
  res.writeHead(status, {
    'content-type': contentType,
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
    // SPA fallback so the hash router can take over.
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
        const onError = (err: NodeJS.ErrnoException): void => {
          server.off('listening', onListening);
          rejectListen(err);
        };
        const onListening = (): void => {
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

export async function startDashboardServer(
  options: DashboardServerOptions,
): Promise<RunningDashboardServer> {
  let cachedReport: DashboardReport = buildReport(options.projectRoot);
  const sseClients = new Set<ServerResponse>();
  let watcher: RunningWatcher | null = null;

  function refreshReport(): void {
    cachedReport = buildReport(options.projectRoot);
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

  function onArtefactChange(): void {
    try {
      refreshReport();
      broadcastSse('dashboard-updated', { generatedAt: cachedReport.generatedAt });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      broadcastSse('dashboard-error', { message });
    }
  }

  if (options.watch !== false) {
    watcher = startPaqadWatcher({
      projectRoot: options.projectRoot,
      debounceMs: options.watchDebounceMs,
      onChange: onArtefactChange,
    });
  }

  const server = createServer((req, res) => {
    try {
      handleRequest(req, res);
    } catch (err) {
      engineLog('error', 'Unhandled dashboard server error', {
        error: err instanceof Error ? err.message : String(err),
      });
      writeJson(res, req, { error: 'Internal server error' }, 500);
    }
  });

  function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', `http://${options.host}:${options.port}`);
    const pathname = url.pathname;

    if (pathname === '/api/health') {
      writeJson(res, req, { ok: true });
      return;
    }
    if (pathname === '/api/dashboard') {
      // Always rebuild — the report is cheap and the watcher might have
      // lagged. Keeps SSE clients and direct hits consistent.
      refreshReport();
      writeJson(res, req, cachedReport);
      return;
    }
    if (pathname === '/api/dashboard/markdown') {
      refreshReport();
      writeText(res, renderMarkdown(cachedReport), 200, 'text/markdown; charset=utf-8');
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
