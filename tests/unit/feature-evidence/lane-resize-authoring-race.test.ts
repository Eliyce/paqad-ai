import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { raiseLaneForAuthoring } from '@/feature-evidence/lane-resize.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

const race = vi.hoisted(() => ({ lost: false }));
vi.mock('@/feature-evidence/feature-record.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/feature-evidence/feature-record.js')>();
  return {
    ...actual,
    updateFeatureRecord: (...args: Parameters<typeof actual.updateFeatureRecord>) =>
      race.lost ? null : actual.updateFeatureRecord(...args),
  };
});

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-authoring-race-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  vi.stubEnv('PAQAD_SKILL_ORCHESTRATOR_ENABLED', undefined);
});

afterEach(() => {
  race.lost = false;
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe('raiseLaneForAuthoring when another writer wins the record', () => {
  it('AC-66: reports no raise when the write did not land its own stamp, so nothing prints twice', () => {
    const dir = openFeatureChange(root, resolveSessionId(root, 'ses-authoring-race'), {
      adapter: 'claude-code',
      title: 'add invoice skill',
      lane: 'fast',
    });
    race.lost = true;
    const raised = raiseLaneForAuthoring({
      projectRoot: root,
      dirName: dir,
      plannedFiles: ['.claude/skills/processing-invoices/SKILL.md'],
      changedFiles: [],
      now: () => new Date('2026-10-31T12:00:00.000Z'),
    });
    expect(raised).toBeNull();
  });
});
