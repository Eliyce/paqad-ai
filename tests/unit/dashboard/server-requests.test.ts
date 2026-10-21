import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startDashboardServer, type RunningDashboardServer } from '@/dashboard/server';

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

function send(
  server: RunningDashboardServer,
  method: string,
  path: string,
  options: { body?: string; headers?: Record<string, string> } = {},
): Promise<Reply> {
  return new Promise((resolveReply, rejectReply) => {
    const req = httpRequest(
      { host: server.host, port: server.port, method, path, headers: options.headers ?? {} },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolveReply({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', rejectReply);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

function json(reply: Reply): { error?: string } {
  return JSON.parse(reply.body.toString('utf8')) as { error?: string };
}

describe('dashboard server request handling', () => {
  let root: string;
  let staticDir: string;
  let server: RunningDashboardServer | null;
  let blocker: Server | null;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-dash-req-'));
    staticDir = mkdtempSync(join(tmpdir(), 'paqad-dash-req-static-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(
      join(root, '.paqad/onboarding-manifest.json'),
      JSON.stringify({ framework_version: '1.0.0', project_root: '.' }),
    );
    server = null;
    blocker = null;
  });

  afterEach(async () => {
    if (server) await server.close();
    if (blocker) await new Promise<void>((done) => blocker!.close(() => done()));
    rmSync(root, { recursive: true, force: true });
    rmSync(staticDir, { recursive: true, force: true });
  });

  async function start(): Promise<RunningDashboardServer> {
    server = await startDashboardServer({
      projectRoot: root,
      host: '127.0.0.1',
      port: 0,
      staticDir,
      watch: false,
    });
    return server;
  }

  it.each([
    ['PUT', '/api/config/delivery-policy', 'Body must include the policy `content` as a string.'],
    ['PUT', '/api/files/instructions/a.md', 'Body must include the file `content` as a string.'],
    ['PUT', '/api/config/module-map', 'Body must include the module map `content` as a string.'],
    ['PUT', '/api/config/design-tokens', 'Body must include the tokens `content` as a string.'],
    ['POST', '/api/capabilities/coding', 'Body must include `enabled` as a boolean.'],
    ['POST', '/api/packs/install', 'Body must include the pack `source` as a string.'],
    ['POST', '/api/packs/remove', 'Body must include the pack `name` as a string.'],
    ['POST', '/api/site-map/journeys/curate', 'Body must include a non-empty `id` string.'],
  ])('rejects %s %s without the required field', async (method, path, message) => {
    const running = await start();
    const reply = await send(running, method, path, {
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
    expect(reply.status).toBe(400);
    expect(json(reply).error).toBe(message);
  });

  it('rejects a curate request whose action is neither confirm nor reject', async () => {
    const running = await start();
    const reply = await send(running, 'POST', '/api/site-map/journeys/curate', {
      body: JSON.stringify({ id: 'checkout', action: 'archive' }),
    });
    expect(reply.status).toBe(400);
    expect(json(reply).error).toBe("Body `action` must be 'confirm' or 'reject'.");
  });

  it('treats an empty request body as an empty object', async () => {
    const running = await start();
    const reply = await send(running, 'PUT', '/api/config/module-map');
    expect(reply.status).toBe(400);
    expect(json(reply).error).toBe('Body must include the module map `content` as a string.');
  });

  it('refuses mutations whose host is not this machine', async () => {
    const running = await start();
    const reply = await send(running, 'PUT', '/api/config/module-map', {
      body: '{}',
      headers: { host: 'example.com' },
    });
    expect(reply.status).toBe(403);
    expect(json(reply).error).toBe('Mutations are accepted from this machine only.');
  });

  it('answers without gzip when the client does not accept it', async () => {
    const running = await start();
    const reply = await send(running, 'GET', '/api/health');
    expect(reply.headers['content-encoding']).toBeUndefined();
    expect(JSON.parse(reply.body.toString('utf8'))).toEqual({ ok: true });
  });

  it('serves static files with a type, gzip for text and octet-stream for unknown types', async () => {
    writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>x</title>');
    writeFileSync(join(staticDir, 'app.js'), 'console.log(1);');
    writeFileSync(join(staticDir, 'data.bin'), 'raw');
    const running = await start();

    const js = await send(running, 'GET', '/app.js', { headers: { 'accept-encoding': 'gzip' } });
    expect(js.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(js.body).toString('utf8')).toBe('console.log(1);');

    const bin = await send(running, 'GET', '/data.bin');
    expect(bin.headers['content-type']).toBe('application/octet-stream');
    expect(bin.body.toString('utf8')).toBe('raw');
  });

  it('serves a directory index and 404s a directory without one', async () => {
    writeFileSync(join(staticDir, 'index.html'), 'root');
    mkdirSync(join(staticDir, 'docs'));
    writeFileSync(join(staticDir, 'docs', 'index.html'), 'docs index');
    mkdirSync(join(staticDir, 'empty'));
    const running = await start();

    const docs = await send(running, 'GET', '/docs', { headers: { 'accept-encoding': 'gzip' } });
    expect(gunzipSync(docs.body).toString('utf8')).toBe('docs index');
    const empty = await send(running, 'GET', '/empty');
    expect(empty.status).toBe(404);
    expect(empty.body.toString('utf8')).toBe('Not Found');
  });

  it('404s an unknown page when the static build has no index', async () => {
    const running = await start();
    const reply = await send(running, 'GET', '/somewhere');
    expect(reply.status).toBe(404);
    expect(reply.body.toString('utf8')).toBe('Not Found');
  });

  it('moves to the next port when the requested one is taken', async () => {
    blocker = createServer();
    const taken = await new Promise<number>((done) => {
      blocker!.listen(0, '127.0.0.1', () => {
        const address = blocker!.address();
        done(typeof address === 'object' && address !== null ? address.port : 0);
      });
    });
    server = await startDashboardServer({
      projectRoot: root,
      host: '127.0.0.1',
      port: taken,
      staticDir,
      watch: false,
    });
    expect(server.port).toBeGreaterThan(taken);
  });
});
