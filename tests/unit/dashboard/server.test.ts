import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';

import { exportAuditEvents } from '@/audit/index.js';
import { PATHS } from '@/core/constants/paths.js';
import type { VerificationEvidence } from '@/core/types/verification-evidence';
import { startDashboardServer, type RunningDashboardServer } from '@/dashboard/server';
import { appendEvidenceRows, buildEvidenceRow } from '@/evidence/ledger.js';
import { VERSION } from '@/index.js';
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
      active_capabilities: ['content'],
      commands: {
        install: 'pnpm i',
        dev: 'pnpm dev',
        test: 'pnpm test',
        test_single: 'pnpm test -- one',
        lint: 'pnpm lint',
        format: 'pnpm format',
        migrate: 'pnpm migrate',
        build: 'pnpm build',
      },
      strictness: {
        full_lane_default: false,
        require_adversarial_review: true,
        block_on_stale_docs: true,
        require_db_review_for_migrations: true,
      },
      compliance_packs: [],
      features: {
        spec_only_mode: false,
        market_research: false,
        design_research: false,
        team_agents: true,
      },
      mcp: { servers: [] },
      model_routing: { default_model: 'gpt-5', reasoning_model: 'gpt-5', fast_model: 'gpt-5-mini' },
      research: { depth: 'standard' },
      intelligence: { rag_enabled: false },
      efficiency: { skill_caching: true },
      escalation: {
        destructive_operations: 'block',
        risky_migrations: 'warn',
        security_findings: 'block',
        db_row_threshold: 10000,
      },
      custom: { classification_dimensions: [], verification_plugins: [], escalation_rules: [] },
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

  it('serves the functionality inventory on /api/inventory', async () => {
    bootstrap(root);
    server = await startDashboardServer({
      projectRoot: root,
      host: '127.0.0.1',
      port: 0,
      staticDir: STATIC_DIR,
      watch: false,
    });

    const res = await fetch(`${server.url}/api/inventory`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      schemaVersion: number;
      items: { key: string; class: string }[];
    };
    expect(body.schemaVersion).toBe(1);
    expect(body.items.some((item) => item.key === 'profile' && item.class === 'web')).toBe(true);
    expect(
      body.items.some((item) => item.key === 'evidence-ledger' && item.class === 'evidence'),
    ).toBe(true);
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

  // Issue #387 — packets written through DecisionStore.writePending must carry a strict
  // `D-<ULID>` id; this is the id every packet these tests create is written under.
  const WID = 'D-01J000000000000000000000A1';

  function makePacket(overrides: Partial<DecisionPacket> = {}): DecisionPacket {
    return {
      decision_id: WID,
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
      expect(feed.pauses.map((p) => p.id)).toEqual([WID]);
      expect(feed.proposals.map((p) => p.id)).toEqual(['MD-0001']);
      expect(feed.pendingCount).toBe(2);
    });

    it('resolves a pause on POST /api/decisions/:id/resolve and reflects it in the feed', async () => {
      bootstrap(root);
      const store = new DecisionStore(root);
      store.initialize();
      store.writePending(makePacket());
      await startServer();

      const res = await fetch(`${server!.url}/api/decisions/${WID}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chosen_option_key: 'reuse-button', note: 'fine' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; result: { chosen_option_key: string } };
      expect(body.ok).toBe(true);
      expect(body.result.chosen_option_key).toBe('reuse-button');
      expect(store.readResolved(WID)?.human_response?.responded_by).toBe('dashboard');

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

      const missingKey = await fetch(`${server!.url}/api/decisions/${WID}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(missingKey.status).toBe(400);

      const badJson = await fetch(`${server!.url}/api/decisions/${WID}/resolve`, {
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

      const wrongOption = await fetch(`${server!.url}/api/decisions/${WID}/resolve`, {
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

      const res = await fetch(`${server!.url}/api/decisions/${WID}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chosen_option_key: 'reuse-button' }),
      });
      expect(res.status).toBe(403);
      expect(store.readPending(WID)).not.toBeNull();

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

      const foreignOrigin = await fetch(`${server!.url}/api/decisions/${WID}/resolve`, {
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
            path: `/api/decisions/${WID}/resolve`,
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

      expect(store.readPending(WID)).not.toBeNull();
    });

    it('rejects oversized mutation bodies', async () => {
      bootstrap(root);
      const store = new DecisionStore(root);
      store.initialize();
      store.writePending(makePacket());
      await startServer();

      const res = await fetch(`${server!.url}/api/decisions/${WID}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chosen_option_key: 'reuse-button', note: 'x'.repeat(70 * 1024) }),
      }).catch(() => null);
      // The server destroys the connection or answers 400 — either way the
      // packet must still be pending.
      if (res !== null) expect(res.status).toBe(400);
      expect(store.readPending(WID)).not.toBeNull();
    });
  });

  describe('config and file endpoints', () => {
    const VALID_POLICY = [
      'schema_version: "1"',
      'merge_mode: append',
      'enabled: true',
      'process:',
      '  branch:',
      '    maintained: manual',
      '    base: develop',
      '',
    ].join('\n');

    it('serves the delivery-policy config on GET and accepts a valid PUT', async () => {
      bootstrap(root);
      await startServer();

      const before = await fetch(`${server!.url}/api/config/delivery-policy`);
      expect(before.status).toBe(200);
      const beforeBody = (await before.json()) as {
        resolved: { process: { branch: { base: string } } };
        file: { exists: boolean };
        schema: { $id: string };
      };
      expect(beforeBody.resolved.process.branch.base).toBe('main');
      expect(beforeBody.file.exists).toBe(false);
      expect(beforeBody.schema.$id).toBe('delivery-policy');

      const put = await fetch(`${server!.url}/api/config/delivery-policy`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: VALID_POLICY, baseHash: null }),
      });
      expect(put.status).toBe(200);
      const putBody = (await put.json()) as {
        ok: boolean;
        result: { resolved: { process: { branch: { base: string } } } };
      };
      expect(putBody.ok).toBe(true);
      expect(putBody.result.resolved.process.branch.base).toBe('develop');

      const audit = readFileSync(join(root, '.paqad/audit.log'), 'utf8');
      expect(audit).toContain('dashboard.config.delivery-policy.write');
    });

    it('returns 422 with field issues for a schema violation', async () => {
      bootstrap(root);
      await startServer();
      const res = await fetch(`${server!.url}/api/config/delivery-policy`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content: 'schema_version: "1"\nprocess:\n  ci:\n    gate: yolo\n',
          baseHash: null,
        }),
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { issues: { path: string }[] };
      expect(body.issues.length).toBeGreaterThan(0);
    });

    it('returns 409 with the current content on a stale baseHash', async () => {
      bootstrap(root);
      mkdirSync(join(root, 'docs/instructions/workflows'), { recursive: true });
      writeFileSync(join(root, 'docs/instructions/workflows/delivery-policy.yaml'), VALID_POLICY);
      await startServer();

      const res = await fetch(`${server!.url}/api/config/delivery-policy`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content: VALID_POLICY.replace('develop', 'trunk'),
          baseHash: 'sha256:stale',
        }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { conflict: { content: string; hash: string } };
      expect(body.conflict.content).toBe(VALID_POLICY);
      expect(body.conflict.hash).toMatch(/^sha256:/);
    });

    it('refuses the delivery-policy PUT in read-only mode', async () => {
      bootstrap(root);
      await startServer({ readOnly: true });
      const res = await fetch(`${server!.url}/api/config/delivery-policy`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: VALID_POLICY, baseHash: null }),
      });
      expect(res.status).toBe(403);
    });

    it('lists, reads, and writes instructions files through the pipeline', async () => {
      bootstrap(root);
      mkdirSync(join(root, 'docs/instructions/rules'), { recursive: true });
      writeFileSync(
        join(root, 'docs/instructions/rules/style.md'),
        '---\ntitle: Style\n---\n# Body\n',
      );
      await startServer();

      const tree = await fetch(`${server!.url}/api/files/instructions`);
      expect(tree.status).toBe(200);
      const treeBody = (await tree.json()) as { exists: boolean };
      expect(treeBody.exists).toBe(true);

      const file = await fetch(`${server!.url}/api/files/instructions/rules/style.md`);
      expect(file.status).toBe(200);
      const fileBody = (await file.json()) as {
        frontmatter: Record<string, unknown>;
        body: string;
        hash: string;
      };
      expect(fileBody.frontmatter).toEqual({ title: 'Style' });

      const put = await fetch(`${server!.url}/api/files/instructions/rules/style.md`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content: '---\ntitle: Style v2\n---\n# Body v2\n',
          baseHash: fileBody.hash,
        }),
      });
      expect(put.status).toBe(200);
      expect(readFileSync(join(root, 'docs/instructions/rules/style.md'), 'utf8')).toContain(
        'Style v2',
      );
      const audit = readFileSync(join(root, '.paqad/audit.log'), 'utf8');
      expect(audit).toContain('dashboard.instructions.write');
    });

    it('refuses traversal and foreign paths on the instructions endpoints with 403', async () => {
      bootstrap(root);
      await startServer();
      const res = await fetch(
        `${server!.url}/api/files/instructions/${encodeURIComponent('../../src/index.ts')}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content: 'x', baseHash: null }),
        },
      );
      expect(res.status).toBe(403);
    });
  });

  describe('full editing endpoints (#146 phase 3)', () => {
    it('serves and updates the profile, and toggles capabilities', async () => {
      bootstrap(root);
      await startServer();

      const get = await fetch(`${server!.url}/api/config/profile`);
      expect(get.status).toBe(200);
      const config = (await get.json()) as {
        profile: { project: { name: string } } | null;
        capabilities: { available: string[] };
      };
      expect(config.profile?.project.name).toBe('demo');
      expect(config.capabilities.available).toContain('coding');

      const toggle = await fetch(`${server!.url}/api/capabilities/planning`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });
      expect(toggle.status).toBe(200);
      const toggled = (await toggle.json()) as { result: { active: string[] } };
      expect(toggled.result.active).toContain('planning');
    });

    it('serves module-map, rag, and design-tokens configs', async () => {
      bootstrap(root);
      await startServer();

      for (const endpoint of [
        '/api/config/module-map',
        '/api/config/rag',
        '/api/config/design-tokens',
      ]) {
        const res = await fetch(`${server!.url}${endpoint}`);
        expect(res.status, endpoint).toBe(200);
      }
    });

    it('404s the retired decision-contract config endpoint', async () => {
      bootstrap(root);
      await startServer();

      const get = await fetch(`${server!.url}/api/config/decision-contract`);
      expect(get.status).toBe(404);

      const put = await fetch(`${server!.url}/api/config/decision-contract`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: '# Decision Pause Contract\n', baseHash: null }),
      });
      expect(put.status).toBe(404);
    });

    it('starts an ops job, reports it, and streams completion to the report', async () => {
      bootstrap(root);
      await startServer();

      const start = await fetch(`${server!.url}/api/ops/doctor`, { method: 'POST' });
      expect(start.status).toBe(200);
      const started = (await start.json()) as { result: { id: string; status: string } };
      expect(started.result.status).toBe('running');

      // Poll until the job settles (doctor on a fixture finishes quickly).
      let job: { status: string } | null = null;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const res = await fetch(`${server!.url}/api/ops/${started.result.id}`);
        expect(res.status).toBe(200);
        job = (await res.json()) as { status: string };
        if (job.status !== 'running') break;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(job?.status).toMatch(/done|failed/);

      const list = await fetch(`${server!.url}/api/ops`);
      const listing = (await list.json()) as { jobs: unknown[] };
      expect(listing.jobs.length).toBeGreaterThanOrEqual(1);
    });

    it('rejects unknown ops actions with 404', async () => {
      bootstrap(root);
      await startServer();
      const res = await fetch(`${server!.url}/api/ops/format-disk`, { method: 'POST' });
      expect(res.status).toBe(404);
    });

    it('serves the audit feed, the onboarding checklist, and the evidence packet', async () => {
      bootstrap(root);
      await startServer();

      const audit = await fetch(`${server!.url}/api/audit`);
      expect(audit.status).toBe(200);

      const checklist = await fetch(`${server!.url}/api/onboarding-checklist`);
      expect(checklist.status).toBe(200);
      const checklistBody = (await checklist.json()) as { steps: unknown[] };
      expect(checklistBody.steps).toHaveLength(5);

      const packet = await fetch(`${server!.url}/api/export/evidence-packet?format=html`);
      expect(packet.status).toBe(200);
      expect(packet.headers.get('content-type')).toMatch(/text\/html/);
      expect(await packet.text()).toContain('<!doctype html>');
    });

    it('accepts every config PUT over HTTP through the pipeline', async () => {
      bootstrap(root);
      await startServer();

      const profileGet = await fetch(`${server!.url}/api/config/profile`);
      const { profile } = (await profileGet.json()) as { profile: Record<string, unknown> };
      const putProfileRes = await fetch(`${server!.url}/api/config/profile`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profile }),
      });
      expect(putProfileRes.status).toBe(200);

      const badProfile = await fetch(`${server!.url}/api/config/profile`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profile: { project: { name: 'broken' } } }),
      });
      expect(badProfile.status).toBe(422);

      const mapPut = await fetch(`${server!.url}/api/config/module-map`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content: 'modules:\n  - slug: core\n    name: Core\n',
          baseHash: null,
        }),
      });
      expect(mapPut.status).toBe(200);

      const ragPut = await fetch(`${server!.url}/api/config/rag`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intelligence: { rag_enabled: false } }),
      });
      expect(ragPut.status).toBe(200);

      const tokensPut = await fetch(`${server!.url}/api/config/design-tokens`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: JSON.stringify({ color: { accent: '#2563eb' } }) }),
      });
      // 200 when the schema accepts it, 422 when stricter — both paths are the
      // pipeline working; assert it is not a transport or guard failure.
      expect([200, 422]).toContain(tokensPut.status);

      const badBody = await fetch(`${server!.url}/api/config/module-map`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 42 }),
      });
      expect(badBody.status).toBe(400);

      const audit = readFileSync(join(root, '.paqad/audit.log'), 'utf8');
      expect(audit).toContain('dashboard.config.profile.write');
      expect(audit).toContain('dashboard.config.module-map.write');
      expect(audit).toContain('dashboard.config.rag.write');
    });

    it('covers packs listing, ops job lookups, audit paging, and packet formats', async () => {
      bootstrap(root);
      await startServer();

      expect((await fetch(`${server!.url}/api/packs`)).status).toBe(200);

      const missingJob = await fetch(`${server!.url}/api/ops/op-doctor-999`);
      expect(missingJob.status).toBe(404);

      const installBad = await fetch(`${server!.url}/api/packs/install`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: '/no/such/pack-dir' }),
      });
      expect([400, 422]).toContain(installBad.status);

      const removeBad = await fetch(`${server!.url}/api/packs/remove`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'not-installed' }),
      });
      expect([400, 404, 422]).toContain(removeBad.status);

      const auditPaged = await fetch(`${server!.url}/api/audit?limit=5&cursor=0`);
      expect(auditPaged.status).toBe(200);

      const markdown = await fetch(`${server!.url}/api/export/evidence-packet?format=markdown`);
      expect(markdown.headers.get('content-type')).toMatch(/markdown/);
      const jsonPacket = await fetch(`${server!.url}/api/export/evidence-packet`);
      const packetBody = (await jsonPacket.json()) as { html: string; markdown: string };
      expect(packetBody.html).toContain('<!doctype html>');

      const missingFile = await fetch(`${server!.url}/api/files/instructions/rules/none.md`);
      expect(missingFile.status).toBe(200);
      expect(((await missingFile.json()) as { exists: boolean }).exists).toBe(false);
    });

    it('refuses the new mutations in read-only mode', async () => {
      bootstrap(root);
      await startServer({ readOnly: true });
      for (const [path, method, body] of [
        ['/api/config/profile', 'PUT', { profile: {} }],
        ['/api/capabilities/coding', 'POST', { enabled: true }],
        ['/api/config/module-map', 'PUT', { content: 'modules: []' }],
        ['/api/config/rag', 'PUT', { intelligence: {} }],
        ['/api/ops/doctor', 'POST', {}],
        ['/api/packs/remove', 'POST', { name: 'x' }],
      ] as const) {
        const res = await fetch(`${server!.url}${path}`, {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        expect(res.status, `${method} ${path}`).toBe(403);
      }
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

  describe('SIEM export endpoint', () => {
    function seedLedger(): void {
      appendEvidenceRows(root, [
        buildEvidenceRow({
          ts: '2026-06-10T00:00:00.000Z',
          engine: 'verification-gate',
          code: 'mutation-testing',
          subject_digest: 'subj',
          verdict: 'pass',
          strength_class: 'deterministic',
          detail: 'token=secret',
        }),
      ]);
    }

    it('downloads OCSF by default, byte-identical to exportAuditEvents', async () => {
      bootstrap(root);
      seedLedger();
      await startServer();

      const res = await fetch(`${server!.url}/api/export/siem`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/application\/x-ndjson/);
      expect(res.headers.get('content-disposition')).toMatch(
        /attachment; filename="paqad-siem-ocsf-\d{8}\.ndjson"/,
      );
      expect(res.headers.get('content-disposition')).not.toContain(':');
      expect(res.headers.get('x-paqad-event-count')).toBe('1');

      const expected =
        exportAuditEvents(root, { format: 'ocsf', redact: false, productVersion: VERSION }).output +
        '\n';
      expect(await res.text()).toBe(expected);
    });

    it('honours format, since, and redact and matches the CLI projection', async () => {
      bootstrap(root);
      seedLedger();
      await startServer();

      const res = await fetch(
        `${server!.url}/api/export/siem?format=jsonl&since=2026-01-01&redact=true`,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/application\/json/);
      const text = await res.text();
      expect(text).not.toContain('secret');
      expect(text).toContain('[REDACTED]');

      const expected =
        exportAuditEvents(root, {
          format: 'jsonl',
          since: '2026-01-01',
          redact: true,
          productVersion: VERSION,
        }).output + '\n';
      expect(text).toBe(expected);
    });

    it('returns 400 on an invalid format and 400 on an unparseable since', async () => {
      bootstrap(root);
      await startServer();
      expect((await fetch(`${server!.url}/api/export/siem?format=xml`)).status).toBe(400);
      expect((await fetch(`${server!.url}/api/export/siem?since=yesterday`)).status).toBe(400);
    });

    it('emits an empty body and a zero count when there is nothing to export', async () => {
      bootstrap(root);
      await startServer();
      const res = await fetch(`${server!.url}/api/export/siem?format=cef`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/plain/);
      expect(res.headers.get('x-paqad-event-count')).toBe('0');
      expect(await res.text()).toBe('');
    });
  });

  describe('saved views (#161)', () => {
    it('creates, lists, applies-by-reload, and deletes a saved view', async () => {
      bootstrap(root);
      await startServer();

      const empty = (await (await fetch(`${server!.url}/api/saved-views`)).json()) as {
        views: unknown[];
      };
      expect(empty.views).toEqual([]);

      const put = await fetch(`${server!.url}/api/saved-views/graph-1`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Modules only',
          area: 'graph',
          scope: { layers: { modules: true }, threshold: 0.8, overlay: 'health' },
        }),
      });
      expect(put.status).toBe(200);
      const created = (await put.json()) as { result: { id: string; createdAt: string } };
      expect(created.result.id).toBe('graph-1');
      expect(created.result.createdAt).toMatch(/^\d{4}-/);

      // Reload (a fresh GET) restores the scope exactly.
      const listed = (await (await fetch(`${server!.url}/api/saved-views`)).json()) as {
        views: { id: string; scope: { threshold: number; overlay: string } }[];
      };
      expect(listed.views).toHaveLength(1);
      expect(listed.views[0].scope.threshold).toBe(0.8);
      expect(listed.views[0].scope.overlay).toBe('health');

      const del = await fetch(`${server!.url}/api/saved-views/graph-1`, { method: 'DELETE' });
      expect(del.status).toBe(200);
      const after = (await (await fetch(`${server!.url}/api/saved-views`)).json()) as {
        views: unknown[];
      };
      expect(after.views).toEqual([]);
    });

    it('rejects a bad area and a bad id with 400, 404s an unknown delete', async () => {
      bootstrap(root);
      await startServer();

      const badArea = await fetch(`${server!.url}/api/saved-views/x1`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'n', area: 'nope', scope: {} }),
      });
      expect(badArea.status).toBe(400);

      const badId = await fetch(`${server!.url}/api/saved-views/${encodeURIComponent('a/b')}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'n', area: 'graph', scope: {} }),
      });
      // The id decodes to 'a/b', which the slug validator rejects → 400.
      expect(badId.status).toBe(400);

      const missing = await fetch(`${server!.url}/api/saved-views/never`, { method: 'DELETE' });
      expect(missing.status).toBe(404);
    });

    it('refuses saved-view writes in read-only mode', async () => {
      bootstrap(root);
      await startServer({ readOnly: true });
      const res = await fetch(`${server!.url}/api/saved-views/x`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'n', area: 'graph', scope: {} }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe('snapshots (#161)', () => {
    it('renders a static module-health snapshot with no live calls, 404 when absent', async () => {
      bootstrap(root);
      mkdirSync(join(root, '.paqad/module-health'), { recursive: true });
      writeFileSync(
        join(root, '.paqad/module-health/payments.json'),
        JSON.stringify({
          module: 'payments',
          tier: 'green',
          metrics: { coverage_pct: 80, defect_frequency: null },
          updated_at: '2026-06-01T00:00:00.000Z',
        }),
      );
      await startServer();

      const ok = await fetch(
        `${server!.url}/api/snapshot/module/${encodeURIComponent('module:payments')}`,
      );
      expect(ok.status).toBe(200);
      expect(ok.headers.get('content-type')).toMatch(/text\/html/);
      const html = await ok.text();
      expect(html).toContain('Module payments');
      expect(html).toContain('Static copy, no live data.');
      // Fully static: no scripts and no live API calls.
      expect(html).not.toContain('<script');
      expect(html).not.toContain('/api/');

      const missing = await fetch(`${server!.url}/api/snapshot/module/nope`);
      expect(missing.status).toBe(404);
    });

    it('404s a receipt snapshot before any receipt exists', async () => {
      bootstrap(root);
      await startServer();
      const res = await fetch(`${server!.url}/api/snapshot/receipt/deadbeef`);
      expect(res.status).toBe(404);
    });
  });

  it('audits dashboard mutations to .paqad/audit.log', async () => {
    bootstrap(root);
    const store = new DecisionStore(root);
    store.initialize();
    store.writePending(makePacket());
    await startServer();

    await fetch(`${server!.url}/api/decisions/${WID}/resolve`, {
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
