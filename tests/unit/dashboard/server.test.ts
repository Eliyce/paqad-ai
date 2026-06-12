import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';
import type { VerificationEvidence } from '@/core/types/verification-evidence';
import { startDashboardServer, type RunningDashboardServer } from '@/dashboard/server';
import { appendEvidenceRows, buildEvidenceRow } from '@/evidence/ledger.js';
import { writeDecision } from '@/module-decisions/store.js';
import type { ModuleDecision } from '@/module-decisions/schema.js';
import { DecisionStore } from '@/planning/decision-store.js';
import type { DecisionPacket } from '@/planning/decision-packet.js';
import { VERIFICATION_EVIDENCE_RELATIVE_PATH } from '@/verification/evidence';

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

  function makePacket(overrides: Partial<DecisionPacket> = {}): DecisionPacket {
    return {
      decision_id: 'D-1',
      fingerprint: 'sha256:test',
      category: 'component-reuse',
      question: 'Use the Button we have?',
      context: 'We are adding a dashboard action.',
      options: [
        {
          option_key: 'reuse-button',
          label: 'Reuse Button',
          one_line_preview: 'If you pick this, we will update src/components/Button.tsx.',
          trade_off: 'You give up: a fresh design.',
          evidence: { file: 'src/components/Button.tsx', callers: 3, similarity: 0.9 },
        },
        {
          option_key: 'make-new',
          label: 'Make new Button',
          one_line_preview: 'If you pick this, we will create src/components/ButtonV2.tsx.',
          trade_off: 'You give up: one shared place.',
          evidence: { file: 'src/components/ButtonV2.tsx', evidence_partial: true },
        },
      ],
      confidence: 0.72,
      requested_by: 'codex-cli',
      task_session_id: 'session-1',
      created_at: '2026-04-27T12:00:00Z',
      status: 'pending',
      ttl_until: '2099-12-31T12:00:00Z',
      invalidation_watch: [],
      ...overrides,
    };
  }

  function makeProposal(over: Partial<ModuleDecision> = {}): ModuleDecision {
    return {
      id: 'MD-0001',
      state: 'proposed',
      proposed_slug: 'payments',
      proposed_name: 'Payments',
      proposed_layer: null,
      proposed_features: [],
      source_of_decision: {
        type: 'pasted-ticket',
        prompt_excerpt: 'add a payments adapter',
        detected_at: '2026-05-28T00:00:00.000Z',
      },
      confidence: 'medium',
      reasoning: 'Prompt names a module that is not on the map.',
      disposition: { collision_with: null, alternatives_offered: [] },
      created_at: '2026-05-28T00:00:00.000Z',
      updated_at: '2026-05-28T00:00:00.000Z',
      expires_at: '2099-12-31T00:00:00.000Z',
      approved_by: null,
      applied_to_map_at: null,
      applied_to_map_commit: null,
      events_log_ref: null,
      ...over,
    };
  }

  async function startServer(
    overrides: { readOnly?: boolean } = {},
  ): Promise<RunningDashboardServer> {
    server = await startDashboardServer({
      projectRoot: root,
      host: '127.0.0.1',
      port: 0,
      staticDir: STATIC_DIR,
      watch: false,
      ...overrides,
    });
    return server;
  }

  describe('approvals endpoints', () => {
    it('serves the unified inbox feed on GET /api/decisions', async () => {
      bootstrap(root);
      const store = new DecisionStore(root);
      store.initialize();
      store.writePending(makePacket());
      writeDecision(root, makeProposal());
      await startServer();

      const res = await fetch(`${server!.url}/api/decisions`);
      expect(res.status).toBe(200);
      const feed = (await res.json()) as {
        pauses: { id: string }[];
        proposals: { id: string }[];
        pendingCount: number;
      };
      expect(feed.pauses.map((p) => p.id)).toEqual(['D-1']);
      expect(feed.proposals.map((p) => p.id)).toEqual(['MD-0001']);
      expect(feed.pendingCount).toBe(2);
    });

    it('resolves a pause on POST /api/decisions/:id/resolve and reflects it in the feed', async () => {
      bootstrap(root);
      const store = new DecisionStore(root);
      store.initialize();
      store.writePending(makePacket());
      await startServer();

      const res = await fetch(`${server!.url}/api/decisions/D-1/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chosen_option_key: 'reuse-button', note: 'fine' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; result: { chosen_option_key: string } };
      expect(body.ok).toBe(true);
      expect(body.result.chosen_option_key).toBe('reuse-button');
      expect(store.readResolved('D-1')?.human_response?.responded_by).toBe('dashboard');

      const feed = (await (await fetch(`${server!.url}/api/decisions`)).json()) as {
        pendingCount: number;
      };
      expect(feed.pendingCount).toBe(0);
    });

    it('maps mutation failures onto 400/404/409', async () => {
      bootstrap(root);
      const store = new DecisionStore(root);
      store.initialize();
      store.writePending(makePacket());
      await startServer();

      const missingKey = await fetch(`${server!.url}/api/decisions/D-1/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(missingKey.status).toBe(400);

      const badJson = await fetch(`${server!.url}/api/decisions/D-1/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{nope',
      });
      expect(badJson.status).toBe(400);

      const unknown = await fetch(`${server!.url}/api/decisions/D-7/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chosen_option_key: 'reuse-button' }),
      });
      expect(unknown.status).toBe(404);

      const wrongOption = await fetch(`${server!.url}/api/decisions/D-1/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chosen_option_key: 'nope' }),
      });
      expect(wrongOption.status).toBe(409);
    });

    it('accepts and rejects module proposals, conflicting on illegal transitions', async () => {
      bootstrap(root);
      writeDecision(root, makeProposal());
      writeDecision(root, makeProposal({ id: 'MD-0002', proposed_slug: 'billing' }));
      await startServer();

      const accept = await fetch(`${server!.url}/api/module-decisions/MD-0001/accept`, {
        method: 'POST',
      });
      expect(accept.status).toBe(200);
      const reject = await fetch(`${server!.url}/api/module-decisions/MD-0002/reject`, {
        method: 'POST',
      });
      expect(reject.status).toBe(200);

      const again = await fetch(`${server!.url}/api/module-decisions/MD-0001/accept`, {
        method: 'POST',
      });
      expect(again.status).toBe(409);

      const missing = await fetch(`${server!.url}/api/module-decisions/MD-9999/accept`, {
        method: 'POST',
      });
      expect(missing.status).toBe(404);
    });
  });

  describe('mutation guardrails', () => {
    it('refuses every mutation with 403 in read-only mode', async () => {
      bootstrap(root);
      const store = new DecisionStore(root);
      store.initialize();
      store.writePending(makePacket());
      await startServer({ readOnly: true });

      const res = await fetch(`${server!.url}/api/decisions/D-1/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chosen_option_key: 'reuse-button' }),
      });
      expect(res.status).toBe(403);
      expect(store.readPending('D-1')).not.toBeNull();

      // reads still work
      expect((await fetch(`${server!.url}/api/decisions`)).status).toBe(200);
    });

    it('refuses mutations with 409 when the project is not onboarded', async () => {
      mkdirSync(join(root, '.paqad'), { recursive: true });
      await startServer();
      const res = await fetch(`${server!.url}/api/module-decisions/MD-0001/accept`, {
        method: 'POST',
      });
      expect(res.status).toBe(409);
    });

    it('refuses mutations carrying a foreign Origin or non-loopback Host', async () => {
      bootstrap(root);
      const store = new DecisionStore(root);
      store.initialize();
      store.writePending(makePacket());
      await startServer();

      const foreignOrigin = await fetch(`${server!.url}/api/decisions/D-1/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        body: JSON.stringify({ chosen_option_key: 'reuse-button' }),
      });
      expect(foreignOrigin.status).toBe(403);

      // fetch (undici) refuses to forward a custom Host header, so the
      // DNS-rebinding leg goes through raw node:http.
      const reboundStatus = await new Promise<number>((resolvePromise, rejectPromise) => {
        const request = httpRequest(
          {
            host: '127.0.0.1',
            port: server!.port,
            path: '/api/decisions/D-1/resolve',
            method: 'POST',
            headers: { 'content-type': 'application/json', host: 'evil.example' },
          },
          (response) => {
            response.resume();
            resolvePromise(response.statusCode ?? 0);
          },
        );
        request.on('error', rejectPromise);
        request.end(JSON.stringify({ chosen_option_key: 'reuse-button' }));
      });
      expect(reboundStatus).toBe(403);

      expect(store.readPending('D-1')).not.toBeNull();
    });

    it('rejects oversized mutation bodies', async () => {
      bootstrap(root);
      const store = new DecisionStore(root);
      store.initialize();
      store.writePending(makePacket());
      await startServer();

      const res = await fetch(`${server!.url}/api/decisions/D-1/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chosen_option_key: 'reuse-button', note: 'x'.repeat(70 * 1024) }),
      }).catch(() => null);
      // The server destroys the connection or answers 400 — either way the
      // packet must still be pending.
      if (res !== null) expect(res.status).toBe(400);
      expect(store.readPending('D-1')).not.toBeNull();
    });
  });

  describe('trust endpoints', () => {
    it('serves the evidence feed with filters on GET /api/ledger/evidence', async () => {
      bootstrap(root);
      appendEvidenceRows(root, [
        buildEvidenceRow({
          ts: '2026-06-11T00:00:00.000Z',
          engine: 'verification-gate',
          code: 'code-tests-lint',
          subject_digest: 's1',
          verdict: 'pass',
          strength_class: 'deterministic',
        }),
        buildEvidenceRow({
          ts: '2026-06-12T00:00:00.000Z',
          engine: 'verification-gate',
          code: 'mutation-testing',
          subject_digest: 's1',
          verdict: 'fail',
          strength_class: 'deterministic',
        }),
      ]);
      await startServer();

      const all = (await (await fetch(`${server!.url}/api/ledger/evidence`)).json()) as {
        total: number;
        rows: { code: string }[];
      };
      expect(all.total).toBe(2);
      expect(all.rows[0].code).toBe('mutation-testing');

      const filtered = (await (
        await fetch(`${server!.url}/api/ledger/evidence?verdict=fail&limit=1`)
      ).json()) as { rows: { code: string }[] };
      expect(filtered.rows).toEqual([expect.objectContaining({ code: 'mutation-testing' })]);
    });

    it('serves receipts and the AI-BOM document, empty-safe', async () => {
      bootstrap(root);
      await startServer();

      const receipts = (await (await fetch(`${server!.url}/api/ledger/receipts`)).json()) as {
        receipts: unknown[];
        brokenAt: number | null;
      };
      expect(receipts.receipts).toEqual([]);
      expect(receipts.brokenAt).toBeNull();

      const bom = (await (await fetch(`${server!.url}/api/ledger/ai-bom`)).json()) as {
        document: unknown;
      };
      expect(bom.document).toBeNull();
    });

    it('serves the PR comment markdown, 404 before verification ran', async () => {
      bootstrap(root);
      await startServer();
      expect((await fetch(`${server!.url}/api/ledger/pr-comment`)).status).toBe(404);

      const evidence: VerificationEvidence = {
        schema_version: '1.1.0',
        run_id: 'run-1',
        started_at: '2026-06-01T00:00:00.000Z',
        completed_at: '2026-06-01T00:01:00.000Z',
        overall_status: 'pass',
        first_failure_gate: null,
        gates: [
          {
            name: 'code-tests-lint',
            status: 'pass',
            detail: 'Structured test results show 10/10 passing checks',
            remediation: null,
            failures: [],
          },
        ],
      };
      const path = join(root, VERIFICATION_EVIDENCE_RELATIVE_PATH);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(evidence), 'utf8');

      const res = await fetch(`${server!.url}/api/ledger/pr-comment?sha=abc1234`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/markdown/);
      expect(await res.text()).toMatch(/abc1234/);
    });
  });

  it('audits dashboard mutations to .paqad/audit.log', async () => {
    bootstrap(root);
    const store = new DecisionStore(root);
    store.initialize();
    store.writePending(makePacket());
    await startServer();

    await fetch(`${server!.url}/api/decisions/D-1/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chosen_option_key: 'reuse-button' }),
    });

    const audit = readFileSync(join(root, PATHS.AUDIT_LOG), 'utf8');
    expect(audit).toMatch(/dashboard-decision-resolved/);
    expect(audit).toMatch(/actor="dashboard"/);
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
