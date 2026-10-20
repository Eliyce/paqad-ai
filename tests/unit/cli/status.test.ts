import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  collectDriftSignals,
  createStatusCommand,
  driftSignalsTrip,
  renderHudText,
} from '@/cli/commands/status';
import type { HudSnapshot } from '@/hud/snapshot';
import { writeWorkflowState } from '@/pipeline/workflow-state';
import { writeDecision } from '@/module-decisions/store';
import { formatDecisionId, ttlExpiresAt } from '@/module-decisions/schema';

describe('createStatusCommand', () => {
  let root: string;
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;
  let writes: string[];
  let errors: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-status-cli-'));
    writes = [];
    errors = [];
    stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      });
    stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        errors.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      });
    process.exitCode = undefined;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    stdout.mockRestore();
    stderr.mockRestore();
    process.exitCode = undefined;
  });

  it('--hud --format json prints the HUD snapshot object for the session', async () => {
    writeWorkflowState(root, 'ses-hud', {
      active: { workflow: 'codebase-health', reason: 'a health check' },
      paused: [],
    });
    const cmd = createStatusCommand();
    await cmd.parseAsync(
      ['--hud', '--format', 'json', '--session', 'ses-hud', '--project-root', root],
      { from: 'user' },
    );
    const snapshot = JSON.parse(writes.join(''));
    expect(snapshot).toMatchObject({
      schema: 'paqad.hud/2',
      session_id: 'ses-hud',
      route: 'codebase-health',
      lane_reason: 'a health check',
      headline: { text: 'Working on codebase health.', tone: 'working' },
    });
  });

  it('--hud prints the snapshot as plain text by default', async () => {
    writeWorkflowState(root, 'ses-hud', { active: null, paused: [] });
    const cmd = createStatusCommand();
    await cmd.parseAsync(['--hud', '--session', 'ses-hud', '--project-root', root], {
      from: 'user',
    });
    expect(writes.join('')).toBe('paqad · Ready. No change in progress.\n');
  });

  it('renders the change, stages, flags and waiting decisions as text', () => {
    const text = renderHudText({
      headline: { text: 'Needs you: 1 decision waiting.', tone: 'needs-you' },
      change: { dir: 'd', id: null, issue: '1', title: 'A change', branch: null, status: null },
      lane: 'graduated',
      stages: [{ stage: 'planning', state: 'complete' }],
      flags: [{ id: 'f', text: 'A flag.' }],
      decisions: { pending: [{ id: 'D-1', category: 'c', question: 'q' }], resolved: 0 },
    } as unknown as HudSnapshot);
    expect(text).toBe(
      [
        'paqad · Needs you: 1 decision waiting.',
        'change: A change · graduated lane',
        '- planning: complete',
        'flag: A flag.',
        'decisions waiting: 1',
      ].join('\n'),
    );
  });

  function bootstrap(): void {
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(
      join(root, '.paqad/onboarding-manifest.json'),
      JSON.stringify({ framework_version: '1.0.0', project_root: '.' }),
    );
  }

  it('rejects unknown --format values', async () => {
    bootstrap();
    const cmd = createStatusCommand();
    await cmd.parseAsync(['--format', 'xml', '--project-root', root], { from: 'user' });
    expect(process.exitCode).toBe(2);
    expect(errors.join('')).toMatch(/invalid --format/);
  });

  it('emits Markdown by default', async () => {
    bootstrap();
    const cmd = createStatusCommand();
    await cmd.parseAsync(['--project-root', root], { from: 'user' });
    const out = writes.join('');
    expect(out).toMatch(/# paqad-ai status/);
  });

  it('emits JSON when --format json is set', async () => {
    bootstrap();
    const cmd = createStatusCommand();
    await cmd.parseAsync(['--format', 'json', '--project-root', root], { from: 'user' });
    const out = writes.join('').trim();
    const parsed = JSON.parse(out) as { schemaVersion: number; notOnboarded: boolean };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.notOnboarded).toBe(false);
  });

  it('--fail-on-drift exits 0 on clean state', async () => {
    bootstrap();
    const cmd = createStatusCommand();
    await cmd.parseAsync(['--fail-on-drift', '--project-root', root], { from: 'user' });
    expect(process.exitCode).toBeUndefined();
  });

  it('--fail-on-drift exits 3 when an expired MD-XXXX decision is on disk', async () => {
    bootstrap();
    writeDecision(root, {
      id: formatDecisionId(1),
      state: 'proposed',
      proposed_slug: 'gone',
      proposed_name: 'Gone',
      proposed_layer: 'cli-commands',
      proposed_features: [],
      source_of_decision: {
        type: 'inferred-from-prompt',
        prompt_excerpt: '',
        detected_at: '2026-04-01T00:00:00Z',
      },
      confidence: 'medium',
      reasoning: '',
      disposition: { collision_with: null, alternatives_offered: [] },
      created_at: '2026-04-01T00:00:00Z',
      updated_at: '2026-04-01T00:00:00Z',
      expires_at: ttlExpiresAt(new Date('2026-04-01T00:00:00Z')),
      approved_by: null,
      applied_to_map_at: null,
      applied_to_map_commit: null,
      events_log_ref: null,
    });
    const cmd = createStatusCommand();
    await cmd.parseAsync(['--fail-on-drift', '--project-root', root], { from: 'user' });
    expect(process.exitCode).toBe(3);
    expect(errors.join('')).toMatch(/expired decision/);
  });

  it('--fail-on-drift exits 3 when drift.json reports MM-DOC-MISSING', async () => {
    bootstrap();
    mkdirSync(join(root, '.paqad/module-map'), { recursive: true });
    writeFileSync(
      join(root, '.paqad/module-map/drift.json'),
      JSON.stringify({
        generated_at: '2026-05-28T00:00:00Z',
        source_roots: ['src'],
        findings: [
          {
            code: 'MM-DOC-MISSING',
            module_slug: 'lonely',
            feature_slug: null,
            paths: ['docs/modules/lonely/'],
            detail: 'no docs',
          },
        ],
        blocked: null,
        counts: {
          'MM-ADD': 0,
          'MM-FEAT-ADD': 0,
          'MM-REMOVE': 0,
          'MM-RENAME': 0,
          'MM-FEAT-STALE': 0,
          'MM-DOC-ORPHAN': 0,
          'MM-DOC-MISSING': 1,
          'MM-MISMATCH': 0,
        },
      }),
    );
    const cmd = createStatusCommand();
    await cmd.parseAsync(['--fail-on-drift', '--project-root', root], { from: 'user' });
    expect(process.exitCode).toBe(3);
    expect(errors.join('')).toMatch(/MM-DOC-MISSING|MM-\*/);
  });

  it('driftSignalsTrip composes the four signals correctly', () => {
    expect(
      driftSignalsTrip({
        mmFindings: 0,
        staleModules: [],
        expiredDecisions: [],
        mmDocMissing: 0,
        blocked: null,
      }),
    ).toBe(false);
    expect(
      driftSignalsTrip({
        mmFindings: 0,
        staleModules: ['x'],
        expiredDecisions: [],
        mmDocMissing: 0,
        blocked: null,
      }),
    ).toBe(true);
  });

  it('collectDriftSignals returns a clean payload on an empty project', () => {
    bootstrap();
    const signals = collectDriftSignals(root);
    expect(signals).toEqual({
      mmFindings: 0,
      staleModules: [],
      expiredDecisions: [],
      mmDocMissing: 0,
      blocked: null,
    });
  });
});
