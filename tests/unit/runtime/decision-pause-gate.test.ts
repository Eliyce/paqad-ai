import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPendingDecision } from '@/decisions/authoring.js';
import { featureChangeKey } from '@/feature-evidence/paths.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';

import { evaluateDecisionPauseGate } from '../../../runtime/hooks/decision-pause-gate.mjs';
import { removeTempProject } from './temp-project.js';

const SES_A = 'ses_gate_change_a';
const SES_B = 'ses_gate_change_b';

const srcResolver = () => import('@/stage-evidence/live-writer.js');
const brokenResolver = () => Promise.reject(new Error('dist is missing'));

let root: string;
let stderr: string;

function openChange(session: string, ulid: string): string {
  return openFeatureChange(root, session, {
    adapter: 'claude-code',
    lane: 'full',
    title: `change for ${session}`,
    ulid,
  });
}

function packet(category: string, change: string | null): string {
  return createPendingDecision(root, {
    category,
    title: 'Which way?',
    context: 'x',
    options: [
      { option_key: 'a', label: 'a' },
      { option_key: 'b', label: 'b' },
    ],
    recommendation: null,
    ...(change ? { change } : {}),
  }).id;
}

function edit(session: string | null, loadResolver = srcResolver): Promise<number> {
  const payload = { cwd: root, tool_name: 'Edit', ...(session ? { session_id: session } : {}) };
  return evaluateDecisionPauseGate(JSON.stringify(payload), { loadResolver });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-decision-gate-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
  vi.stubEnv('PAQAD_MANAGED', '1');
  vi.stubEnv('SE_SESSION', undefined);
  vi.stubEnv('CLAUDE_SESSION_ID', undefined);
  stderr = '';
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderr += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  removeTempProject(root);
});

describe('the decision-pause gate holds only the change a packet belongs to', () => {
  it('AC-12: a pending packet for change B lets an edit for change A through', async () => {
    openChange(SES_A, '01JABCDEFGHJKMNPQRSTVWXYZ1');
    const dirB = openChange(SES_B, '01JABCDEFGHJKMNPQRSTVWXYZ2');
    packet('spec.expert_conflict', featureChangeKey(dirB));
    expect(await edit(SES_A)).toBe(0);
    expect(stderr).toBe('');
  });

  it('AC-12: a pending packet for change A blocks an edit for change A', async () => {
    const dirA = openChange(SES_A, '01JABCDEFGHJKMNPQRSTVWXYZ1');
    openChange(SES_B, '01JABCDEFGHJKMNPQRSTVWXYZ2');
    const id = packet('spec.expert_conflict', featureChangeKey(dirA));
    expect(await edit(SES_A)).toBe(2);
    expect(stderr).toContain(id);
  });

  it('AC-13 / INV-1: a pending packet with no change blocks every session', async () => {
    openChange(SES_A, '01JABCDEFGHJKMNPQRSTVWXYZ1');
    openChange(SES_B, '01JABCDEFGHJKMNPQRSTVWXYZ2');
    const id = packet('spec.change', null);
    expect(await edit(SES_A)).toBe(2);
    expect(await edit(SES_B)).toBe(2);
    expect(stderr).toContain(id);
  });

  it('AC-14 / INV-2: an unknown session blocks on another change packet', async () => {
    openChange(SES_A, '01JABCDEFGHJKMNPQRSTVWXYZ1');
    const dirB = openChange(SES_B, '01JABCDEFGHJKMNPQRSTVWXYZ2');
    packet('spec.expert_conflict', featureChangeKey(dirB));
    expect(await edit('ses_nobody_knows')).toBe(2);
  });

  it('AC-14 / INV-2: a project with no stage ledger blocks on any change packet', async () => {
    packet('spec.expert_conflict', 'some-other-change');
    expect(await edit(SES_A)).toBe(2);
  });

  it('AC-14 / INV-2: a resolver that cannot load blocks on another change packet', async () => {
    openChange(SES_A, '01JABCDEFGHJKMNPQRSTVWXYZ1');
    const dirB = openChange(SES_B, '01JABCDEFGHJKMNPQRSTVWXYZ2');
    packet('spec.expert_conflict', featureChangeKey(dirB));
    expect(await edit(SES_A, brokenResolver)).toBe(2);
  });

  it('INV-2: an unreadable pending packet blocks', async () => {
    openChange(SES_A, '01JABCDEFGHJKMNPQRSTVWXYZ1');
    mkdirSync(join(root, '.paqad/decisions/pending'), { recursive: true });
    writeFileSync(join(root, '.paqad/decisions/pending/D-broken.json'), '{not json');
    expect(await edit(SES_A)).toBe(2);
    expect(stderr).toContain('D-broken');
  });

  it('AC-20: a spec.change for change A blocks A at once and leaves change B free', async () => {
    const dirA = openChange(SES_A, '01JABCDEFGHJKMNPQRSTVWXYZ1');
    openChange(SES_B, '01JABCDEFGHJKMNPQRSTVWXYZ2');
    packet('spec.change', featureChangeKey(dirA));
    expect(await edit(SES_A)).toBe(2);
    expect(await edit(SES_B)).toBe(0);
  });

  it('a pending fix.proof_method packet blocks its own change only', async () => {
    const dirA = openChange(SES_A, '01JABCDEFGHJKMNPQRSTVWXYZ1');
    openChange(SES_B, '01JABCDEFGHJKMNPQRSTVWXYZ2');
    packet('fix.proof_method', featureChangeKey(dirA));
    expect(await edit(SES_A)).toBe(2);
    expect(await edit(SES_B)).toBe(0);
  });

  it('lets an edit through when nothing is pending', async () => {
    openChange(SES_A, '01JABCDEFGHJKMNPQRSTVWXYZ1');
    expect(await edit(SES_A)).toBe(0);
  });
});
