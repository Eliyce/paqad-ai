import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startGraphServer, type RunningGraphServer } from '@/graph/server';

function writeJson(path: string, data: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(data));
}

describe('startGraphServer', () => {
  let root: string;
  let staticDir: string;
  let server: RunningGraphServer | null = null;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-graph-srv-'));
    staticDir = join(root, 'static');
    mkdirSync(staticDir, { recursive: true });
    writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>ok</title>');
    writeJson(join(root, '.paqad/onboarding-manifest.json'), { framework_version: '1.0.0' });
  });

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
    rmSync(root, { recursive: true, force: true });
  });

  it('serves /api/health and /api/graph as JSON and falls back to index.html', async () => {
    server = await startGraphServer({
      projectRoot: root,
      host: '127.0.0.1',
      port: 0,
      staticDir,
    });

    const health = await fetch(`${server.url}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });

    const graph = await fetch(`${server.url}/api/graph`);
    expect(graph.status).toBe(200);
    const body = (await graph.json()) as { meta: { counts: { modules: number } } };
    expect(body.meta.counts.modules).toBe(0);

    const html = await fetch(`${server.url}/some/spa/route`);
    expect(html.status).toBe(200);
    expect((await html.text()).toLowerCase()).toContain('<title>ok</title>');

    const unknown = await fetch(`${server.url}/api/unknown`);
    expect(unknown.status).toBe(404);
  });

  it('serves /api/node/:id and /api/chunk/:id/content', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(join(root, '.paqad/context'), { recursive: true });
    mkdirSync(join(root, '.paqad/module-health'), { recursive: true });
    writeFileSync(
      join(root, '.paqad/module-health/x.json'),
      JSON.stringify({ module: 'x', tier: 'green' }),
    );
    const fakeChunk = {
      id: 'c1',
      source_file: join(root, 'src/x/a.ts'),
      ast_node_type: 'function',
      ast_node_path: 'f',
      exported_symbols: ['fn'],
      content: 'x'.repeat(800),
      char_count: 0,
      content_hash: 'h',
    };
    writeFileSync(
      join(root, '.paqad/context/chunk-index.json'),
      JSON.stringify({
        version: 1,
        generated_at: new Date().toISOString(),
        entries: [
          {
            source_file: join(root, 'src/x/a.ts'),
            source_file_hash: 'h',
            modified_at: new Date().toISOString(),
            chunks: [fakeChunk],
          },
        ],
      }),
    );

    server = await startGraphServer({
      projectRoot: root,
      host: '127.0.0.1',
      port: 0,
      staticDir,
    });
    const detailRes = await fetch(
      `${server.url}/api/node/${encodeURIComponent('file:src/x/a.ts')}`,
    );
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as { node: { id: string } };
    expect(detail.node.id).toBe('file:src/x/a.ts');

    const chunkRes = await fetch(
      `${server.url}/api/chunk/${encodeURIComponent('chunk:src/x/a.ts#0')}/content`,
    );
    expect(chunkRes.status).toBe(200);
    const chunk = (await chunkRes.json()) as { content: string };
    expect(chunk.content.length).toBe(800);

    const missing = await fetch(`${server.url}/api/node/nope`);
    expect(missing.status).toBe(404);
  });

  it('serves POST /api/similar and rejects malformed bodies', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(join(root, '.paqad/context'), { recursive: true });
    mkdirSync(join(root, '.paqad/module-health'), { recursive: true });
    mkdirSync(join(root, '.paqad/vectors'), { recursive: true });
    writeFileSync(
      join(root, '.paqad/module-health/m.json'),
      JSON.stringify({ module: 'm', tier: 'green' }),
    );
    writeFileSync(
      join(root, '.paqad/context/chunk-index.json'),
      JSON.stringify({
        version: 1,
        generated_at: new Date().toISOString(),
        entries: [
          {
            source_file: join(root, 'src/m/a.ts'),
            source_file_hash: 'h',
            modified_at: new Date().toISOString(),
            chunks: [
              {
                id: 'v1',
                source_file: join(root, 'src/m/a.ts'),
                ast_node_type: 'function',
                ast_node_path: 'f',
                exported_symbols: [],
                content: '',
                char_count: 0,
                content_hash: 'h1',
              },
              {
                id: 'v2',
                source_file: join(root, 'src/m/a.ts'),
                ast_node_type: 'function',
                ast_node_path: 'g',
                exported_symbols: [],
                content: '',
                char_count: 0,
                content_hash: 'h2',
              },
            ],
          },
        ],
      }),
    );
    writeFileSync(
      join(root, '.paqad/vectors/meta.json'),
      JSON.stringify({
        version: 1,
        provider: 'local',
        model: 't',
        built_at: '',
        chunk_count: 2,
        embedding_dimensions: 3,
      }),
    );
    writeFileSync(
      join(root, '.paqad/vectors/index.json'),
      JSON.stringify({
        version: 1,
        dimensions: 3,
        items: [
          { id: 'v1', vector: [1, 0, 0] },
          { id: 'v2', vector: [1, 0.01, 0.01] },
        ],
      }),
    );

    server = await startGraphServer({
      projectRoot: root,
      host: '127.0.0.1',
      port: 0,
      staticDir,
    });

    const bad = await fetch(`${server.url}/api/similar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(bad.status).toBe(400);

    const ok = await fetch(`${server.url}/api/similar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ threshold: 0.5, scope: { type: 'all', id: null } }),
    });
    expect(ok.status).toBe(200);
    const payload = (await ok.json()) as { edges: { source: string; target: string }[] };
    expect(payload.edges.length).toBe(1);
  });

  it('broadcasts a graph-updated SSE event when .paqad/ changes', async () => {
    const { writeFileSync } = await import('node:fs');
    server = await startGraphServer({
      projectRoot: root,
      host: '127.0.0.1',
      port: 0,
      staticDir,
      watchDebounceMs: 60,
    });

    // Stream the SSE events. Resolve when the first graph-updated event arrives.
    const events = (async () => {
      const res = await fetch(`${server!.url}/api/events`);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.includes('event: graph-updated')) {
          reader.cancel();
          return true;
        }
      }
      reader.cancel();
      return false;
    })();
    // Give the SSE connection time to register before we trigger a change.
    await new Promise((r) => setTimeout(r, 200));
    writeFileSync(join(root, '.paqad/touched.txt'), String(Date.now()));
    const got = await events;
    expect(got).toBe(true);
  });

  it('increments to the next free port when the requested port is taken', async () => {
    const first = await startGraphServer({
      projectRoot: root,
      host: '127.0.0.1',
      port: 0,
      staticDir,
    });
    try {
      const second = await startGraphServer({
        projectRoot: root,
        host: '127.0.0.1',
        port: first.port,
        staticDir,
      });
      expect(second.port).not.toBe(first.port);
      await second.close();
    } finally {
      await first.close();
    }
  });
});
