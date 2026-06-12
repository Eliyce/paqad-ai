import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { PLACEHOLDER_DESIGN_TOKENS } from '@/design-tokens/defaults.js';

import {
  isOpsAction,
  OPS_ACTIONS,
  OpsConflictError,
  OpsJobRunner,
  type OpsAction,
  type OpsProgressEvent,
} from '@/dashboard/ops-jobs.js';

function readAudit(root: string): string {
  const path = join(root, '.paqad/audit.log');
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/** A promise the test resolves or rejects by hand, to freeze a job mid-run. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ops job runner', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-ops-jobs-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('isOpsAction', () => {
    it('accepts every action in the closed set', () => {
      for (const action of OPS_ACTIONS) {
        expect(isOpsAction(action)).toBe(true);
      }
    });

    it('rejects the deliberately excluded and unknown actions', () => {
      expect(isOpsAction('update')).toBe(false);
      expect(isOpsAction('refresh-stack')).toBe(false);
      expect(isOpsAction('regenerate-registries')).toBe(false);
      expect(isOpsAction('')).toBe(false);
      expect(isOpsAction(42)).toBe(false);
      expect(isOpsAction(undefined)).toBe(false);
    });
  });

  describe('job lifecycle', () => {
    it('returns a running job immediately and transitions to done with the result', async () => {
      const gate = deferred<unknown>();
      const events: OpsProgressEvent[] = [];
      const runner = new OpsJobRunner({
        projectRoot: root,
        onEvent: (event) => events.push(event),
        executors: {
          doctor: async (_job, { progress }) => {
            progress('halfway');
            return gate.promise;
          },
        },
      });

      const job = runner.start('doctor');
      expect(job.id).toBe('op-doctor-1');
      expect(job.status).toBe('running');
      expect(job.startedAt).toBeTruthy();
      expect(job.finishedAt).toBeNull();

      await vi.waitFor(() => expect(job.progress).toContain('halfway'));
      expect(events).toEqual([
        { jobId: 'op-doctor-1', action: 'doctor', status: 'running', message: 'halfway' },
      ]);

      gate.resolve({ checks: 3 });
      await vi.waitFor(() => expect(job.status).toBe('done'));
      expect(job.result).toEqual({ checks: 3 });
      expect(job.error).toBeNull();
      expect(job.finishedAt).toBeTruthy();
      expect(job.progress.at(-1)).toBe('Finished doctor.');
      expect(events.at(-1)).toEqual({
        jobId: 'op-doctor-1',
        action: 'doctor',
        status: 'done',
        message: 'Finished doctor.',
      });

      const audit = readAudit(root);
      expect(audit).toContain('dashboard.ops.doctor');
      expect(audit).toContain('job="op-doctor-1"');
      expect(audit).toContain('status="done"');
      expect(audit).toContain('actor="dashboard"');
    });

    it('marks the job failed with the error message and audits the failure', async () => {
      const gate = deferred<unknown>();
      const events: OpsProgressEvent[] = [];
      const runner = new OpsJobRunner({
        projectRoot: root,
        onEvent: (event) => events.push(event),
        executors: { reconcile: () => gate.promise },
      });

      const job = runner.start('reconcile');
      gate.reject(new Error('drift scan exploded'));

      await vi.waitFor(() => expect(job.status).toBe('failed'));
      expect(job.error).toBe('drift scan exploded');
      expect(job.result).toBeNull();
      expect(job.finishedAt).toBeTruthy();
      expect(events.at(-1)).toMatchObject({
        status: 'failed',
        message: 'Failed reconcile: drift scan exploded',
      });

      const audit = readAudit(root);
      expect(audit).toContain('dashboard.ops.reconcile');
      expect(audit).toContain('status="failed"');
    });

    it('rejects a second start of the same action while it is running', async () => {
      const gate = deferred<unknown>();
      const runner = new OpsJobRunner({
        projectRoot: root,
        executors: { doctor: () => gate.promise, 'rag-clear': async () => 'ok' },
      });

      const job = runner.start('doctor');
      expect(() => runner.start('doctor')).toThrow(OpsConflictError);
      expect(() => runner.start('doctor')).toThrow(/already running/);

      // A different action is not blocked.
      const other = runner.start('rag-clear');
      await vi.waitFor(() => expect(other.status).toBe('done'));

      // After the first run finishes, the same action can start again. The
      // counter is runner-wide, so the rag-clear job above consumed id 2.
      gate.resolve(null);
      await vi.waitFor(() => expect(job.status).toBe('done'));
      const second = runner.start('doctor');
      expect(second.id).toBe('op-doctor-3');
      await vi.waitFor(() => expect(second.status).toBe('done'));
    });

    it('exposes jobs through get() and list(), newest first', async () => {
      const runner = new OpsJobRunner({
        projectRoot: root,
        executors: { doctor: async () => 'a', 'rag-clear': async () => 'b' },
      });

      const first = runner.start('doctor');
      await vi.waitFor(() => expect(first.status).toBe('done'));
      const second = runner.start('rag-clear');
      await vi.waitFor(() => expect(second.status).toBe('done'));

      expect(runner.get(first.id)).toBe(first);
      expect(runner.get('op-nope-99')).toBeNull();
      expect(runner.list().map((job) => job.id)).toEqual([second.id, first.id]);
    });

    it('keeps at most the last 50 finished jobs', async () => {
      const runner = new OpsJobRunner({
        projectRoot: root,
        executors: { doctor: async () => null },
      });

      for (let i = 0; i < 55; i++) {
        const job = runner.start('doctor');
        await vi.waitFor(() => expect(job.status).toBe('done'));
      }

      const jobs = runner.list();
      expect(jobs).toHaveLength(50);
      // The oldest five runs were pruned; the newest survives.
      expect(jobs[0].id).toBe('op-doctor-55');
      expect(jobs.at(-1)?.id).toBe('op-doctor-6');
    });
  });

  describe('default executors on a bare fixture project', () => {
    async function run(action: OpsAction): Promise<ReturnType<OpsJobRunner['start']>> {
      const runner = new OpsJobRunner({ projectRoot: root });
      const job = runner.start(action);
      await vi.waitFor(() => expect(job.status).not.toBe('running'), { timeout: 15_000 });
      return job;
    }

    it('rag-clear completes and clears the index', async () => {
      const job = await run('rag-clear');
      expect(job.status).toBe('done');
      expect(job.result).toEqual({ cleared: true });
      expect(readAudit(root)).toContain('dashboard.ops.rag-clear');
    });

    it('rag-rebuild fails cleanly when RAG is not configured', async () => {
      const job = await run('rag-rebuild');
      expect(job.status).toBe('failed');
      expect(job.error).toMatch(/RAG must be enabled/);
      expect(readAudit(root)).toContain('status="failed"');
    });

    it('refresh-rules fails cleanly without a project profile', async () => {
      const job = await run('refresh-rules');
      expect(job.status).toBe('failed');
      expect(job.error).toMatch(/No project profile found/);
    });

    it('regenerate-docs completes with a skip note when tokens are missing', async () => {
      const job = await run('regenerate-docs');
      expect(job.status).toBe('done');
      expect(job.result).toMatchObject({ skipped: true });
      expect((job.result as { note: string }).note).toMatch(/Design tokens file not found/);
    });

    it('compliance-check completes with a nothing-to-check note when no index exists', async () => {
      const job = await run('compliance-check');
      expect(job.status).toBe('done');
      expect(job.result).toMatchObject({ checked: false });
    });

    it('reconcile completes with a drift summary', async () => {
      const job = await run('reconcile');
      expect(job.status).toBe('done');
      expect(job.result).toMatchObject({ counts: expect.any(Object) });
      expect(job.result).toHaveProperty('blocked');
      expect(job.result).toHaveProperty('findings');
      expect(job.progress.length).toBeGreaterThan(1);
    });

    it('reconcile scans declared source roots when a pack provides them', async () => {
      // A project pack is the one source of module_health.source_roots that
      // needs no built-in pack cooperation.
      const packRoot = join(root, '.paqad', 'packs', 'fixture-pack');
      mkdirSync(packRoot, { recursive: true });
      writeFileSync(
        join(packRoot, 'pack.yaml'),
        [
          'name: fixture-pack',
          'display_name: Fixture Pack',
          'ecosystem: node',
          'version: 1.0.0',
          'description: Fixture pack for reconcile tests',
          'maintainer: tests',
          'detection:',
          '  manifests:',
          '    - file: package.json',
          '      packages: [fixture-pack]',
          'module_health:',
          '  source_roots: [src]',
          '',
        ].join('\n'),
      );
      mkdirSync(join(root, 'src'), { recursive: true });

      const job = await run('reconcile');
      expect(job.status).toBe('done');
      expect(job.result).toMatchObject({ blocked: null, findings: 0 });
      expect(job.progress[0]).toContain('Reconciling module-map.yml against: src.');
    });

    it('refresh-rules regenerates the rule tree when a profile exists', async () => {
      const profilePath = join(root, PATHS.PROJECT_PROFILE);
      mkdirSync(dirname(profilePath), { recursive: true });
      writeFileSync(
        profilePath,
        [
          'project: { name: Demo, id: demo, description: Demo }',
          'active_capabilities: [content]',
          '',
        ].join('\n'),
      );

      const job = await run('refresh-rules');
      expect(job.status).toBe('done');
      expect(job.result).toMatchObject({
        deleted: expect.any(Number),
        written: expect.any(Number),
        preserved: [],
      });
      expect((job.result as { written: number }).written).toBeGreaterThan(0);
      expect(existsSync(join(root, 'docs/instructions/rules'))).toBe(true);
    });

    it('refresh-context syncs the chunk index', async () => {
      const job = await run('refresh-context');
      expect(job.status).toBe('done');
      expect(job.result).toMatchObject({
        changed_files: 0,
        added_files: expect.any(Number),
        deleted_files: 0,
        updated: expect.any(Boolean),
      });
    });

    it('regenerate-docs writes docs and theme exports from real tokens', async () => {
      const tokensPath = join(root, PATHS.DESIGN_TOKENS_FILE);
      mkdirSync(dirname(tokensPath), { recursive: true });
      // The placeholder values without the placeholder $comment count as
      // real tokens, so generation proceeds.
      writeFileSync(tokensPath, `${JSON.stringify(PLACEHOLDER_DESIGN_TOKENS, null, 2)}\n`);

      const job = await run('regenerate-docs');
      expect(job.status).toBe('done');
      const result = job.result as { docs: string[]; theme: string[] };
      expect(result.docs.length).toBeGreaterThan(0);
      expect(result.theme.length).toBeGreaterThan(0);
      expect(existsSync(join(root, 'docs/instructions/design-system/tokens.md'))).toBe(true);
      expect(existsSync(join(root, '.paqad/theme/theme.css'))).toBe(true);
    });

    it('regenerate-docs fails on a corrupt tokens file', async () => {
      const tokensPath = join(root, PATHS.DESIGN_TOKENS_FILE);
      mkdirSync(dirname(tokensPath), { recursive: true });
      writeFileSync(tokensPath, '{not json');

      const job = await run('regenerate-docs');
      expect(job.status).toBe('failed');
      expect(job.error).toBeTruthy();
    });

    it('compliance-check reports the summary when an obligation index exists', async () => {
      const indexPath = join(root, '.paqad/compliance/obligation-index.json');
      mkdirSync(dirname(indexPath), { recursive: true });
      writeFileSync(
        indexPath,
        JSON.stringify({
          metadata: {
            spec_file: 'docs/spec.md',
            spec_hash: 'abc123',
            extracted_at: '2026-06-01T00:00:00.000Z',
            obligation_count: 1,
            schema_version: 1,
            warnings: [],
          },
          obligations: [
            {
              obligation_id: 'OB-1',
              category: 'acceptance',
              description: 'The thing must happen.',
              pass_criteria: null,
              source_section: 'Spec',
              source_line: 1,
              spec_file: 'docs/spec.md',
            },
          ],
        }),
      );

      const job = await run('compliance-check');
      expect(job.status).toBe('done');
      expect(job.result).toMatchObject({
        checked: true,
        summary: expect.objectContaining({ total: 1 }),
        uncovered: ['OB-1'],
      });
      expect(job.progress).toContain('Checking 1 obligation(s) against the test suite.');
    });

    it('compliance-check fails on an unusable obligation index', async () => {
      const indexPath = join(root, '.paqad/compliance/obligation-index.json');
      mkdirSync(dirname(indexPath), { recursive: true });
      writeFileSync(
        indexPath,
        JSON.stringify({
          metadata: {
            spec_file: 'docs/spec.md',
            spec_hash: 'abc123',
            extracted_at: '2026-06-01T00:00:00.000Z',
            obligation_count: 0,
            schema_version: 99,
            warnings: [],
          },
          obligations: [],
        }),
      );

      const job = await run('compliance-check');
      expect(job.status).toBe('failed');
      expect(job.error).toMatch(/Unsupported compliance schema_version/);
    });

    it('doctor returns the health checks array', async () => {
      const job = await run('doctor');
      expect(job.status).toBe('done');
      expect(Array.isArray(job.result)).toBe(true);
      expect((job.result as unknown[]).length).toBeGreaterThan(0);
      expect(job.progress.some((line) => line.startsWith('Overall status:'))).toBe(true);
    });
  });
});
