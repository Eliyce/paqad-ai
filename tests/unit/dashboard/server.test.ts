import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';

import { startDashboardServer, type RunningDashboardServer } from '@/dashboard/server';

const STATIC_DIR = mkdtempSync(join(tmpdir(), 'paqad-dash-static-'));
writeFileSync(join(STATIC_DIR, 'index.html'), '<!doctype html><title>x</title>');

function bootstrap(root: string): void {
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(
    join(root, '.paqad/onboarding-manifest.json'),
    JSON.stringify({ framework_version: '1.0.0', project_root: '.' }),
  );
  writeFileSync(
    join(root, '.paqad/project-profile.yaml'),
    YAML.stringify({
      project: { name: 'demo', id: 'demo', description: '' },
      commands: { install: 'pnpm i', test: 'pnpm test', build: 'pnpm build' },
      intelligence: { rag_enabled: false },
      mcp: { servers: [] },
      routing: { domain: 'coding' },
    }),
  );
}

describe('startDashboardServer', () => {
  let root: string;
  let server: RunningDashboardServer | null;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-dash-srv-'));
    server = null;
  });

  afterEach(async () => {
    if (server) await server.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('serves /api/health and /api/dashboard', async () => {
    bootstrap(root);
    server = await startDashboardServer({
      projectRoot: root,
      host: '127.0.0.1',
      port: 0,
      staticDir: STATIC_DIR,
      watch: false,
    });

    const health = await fetch(`${server.url}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });

    const dashboard = await fetch(`${server.url}/api/dashboard`);
    expect(dashboard.status).toBe(200);
    const body = (await dashboard.json()) as { schemaVersion: number; projectName: string | null };
    expect(body.schemaVersion).toBe(1);
    expect(body.projectName).toBe('demo');
  });

  it('serves the Markdown form on /api/dashboard/markdown', async () => {
    bootstrap(root);
    server = await startDashboardServer({
      projectRoot: root,
      host: '127.0.0.1',
      port: 0,
      staticDir: STATIC_DIR,
      watch: false,
    });
    const md = await fetch(`${server.url}/api/dashboard/markdown`);
    expect(md.status).toBe(200);
    expect(md.headers.get('content-type')).toMatch(/text\/markdown/);
    const body = await md.text();
    expect(body).toMatch(/# paqad-ai status/);
  });

  it('returns 404 for unknown /api/ endpoints and falls back to the SPA index for the rest', async () => {
    bootstrap(root);
    server = await startDashboardServer({
      projectRoot: root,
      host: '127.0.0.1',
      port: 0,
      staticDir: STATIC_DIR,
      watch: false,
    });
    const api = await fetch(`${server.url}/api/nope`);
    expect(api.status).toBe(404);
    const spa = await fetch(`${server.url}/dashboard`);
    expect(spa.status).toBe(200);
    expect(await spa.text()).toMatch(/<!doctype html>/);
  });

  it('streams SSE events with a retry hint', async () => {
    bootstrap(root);
    server = await startDashboardServer({
      projectRoot: root,
      host: '127.0.0.1',
      port: 0,
      staticDir: STATIC_DIR,
      watch: false,
    });
    const res = await fetch(`${server.url}/api/events`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    const chunk = decoder.decode(value);
    expect(chunk).toMatch(/retry: 5000/);
    await reader.cancel();
  });
});
