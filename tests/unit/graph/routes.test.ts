import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startDashboardServer, type RunningDashboardServer } from '@/dashboard/server';

function writeJson(path: string, data: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(data));
}

/**
 * The graph API is now mounted on the dashboard server (issue #159). These
 * tests drive the read-only graph routes through that single front door.
 */
describe('graph routes on the dashboard server', () => {
  let root: string;
  let staticDir: string;
  let server: RunningDashboardServer | null = null;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-graph-routes-'));
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

  it('serves /api/graph as JSON and falls back to index.html', async () => {
    server = await startDashboardServer({
      projectRoot: root,
      host: '127.0.0.1',
      port: 0,
      staticDir,
      watch: false,
    });

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

  it('keeps the graph API read-only: a write to /api/graph is rejected', async () => {
    server = await startDashboardServer({
      projectRoot: root,
      host: '127.0.0.1',
      port: 0,
      staticDir,
      watch: false,
    });

    // No mutating graph endpoint exists, so a forced write falls through to the
    // unknown-endpoint 404 rather than mutating anything.
    const put = await fetch(`${server.url}/api/graph`, { method: 'PUT' });
    expect(put.status).toBe(404);
  });

  it('serves /api/node/:id and /api/chunk/:id/content', async () => {
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

    server = await startDashboardServer({
      projectRoot: root,
      host: '127.0.0.1',
      port: 0,
      staticDir,
      watch: false,
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

    server = await startDashboardServer({
      projectRoot: root,
      host: '127.0.0.1',
      port: 0,
      staticDir,
      watch: false,
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
    server = await startDashboardServer({
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
});
