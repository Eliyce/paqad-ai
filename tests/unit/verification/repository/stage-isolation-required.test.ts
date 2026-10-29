import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readFeatureRecord } from '@/feature-evidence/feature-record.js';
import { planLaneResize, raiseLaneIfGrown } from '@/feature-evidence/lane-resize.js';
import { BUNDLE_MANIFEST } from '@/feature-evidence/manifest.js';
import { FEATURE_BUNDLE_FILES } from '@/feature-evidence/paths.js';
import {
  appendFeatureStageRow,
  featureStagePath,
  openFeatureChange,
  recordChangeConstants,
} from '@/feature-evidence/stage-ledger.js';
import { writePendingImpact } from '@/stage-evidence/pending-lane.js';
import { isSubagentCapableAdapter } from '@/stage-isolation/stage-agents.js';
import { STAGE_AGENT_HOSTS } from '@/stage-isolation/agent-writer.js';
import {
  isolationConfig,
  stageIsolationExpected,
  stageIsolationStatus,
} from '@/verification/repository/run-repository-verification.js';
import { buildBundleCompletenessConfig } from '@/verification/repository/bundle-completeness-config.js';

import { appendLegacyStageRow } from '../../../shared/legacy-stage-row.js';

const SESSION = 'isolation-required-session';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-iso-required-'));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

function bundle(name: string): string {
  return `573-${name}-01JABCDEFGHJKMNPQRSTVWXYZ0`;
}

function bundleWith(
  name: string,
  lane: 'fast' | 'graduated' | 'full' | null,
  adapter: string,
): void {
  const dirName = bundle(name);
  mkdirSync(join(root, featureStagePath(dirName), '..'), { recursive: true });
  recordChangeConstants(root, dirName, { adapter, lane });
  appendFeatureStageRow(root, SESSION, dirName, { kind: 'open' });
  for (const stage of [
    'planning',
    'specification',
    'development',
    'review',
    'checks',
    'documentation_sync',
  ]) {
    appendFeatureStageRow(root, SESSION, dirName, {
      kind: 'stage_start',
      stage,
      event_status: 'started',
    });
    appendFeatureStageRow(root, SESSION, dirName, {
      kind: 'stage_end',
      stage,
      event_status: 'completed',
      artifact_digest: `sha256-${stage}`,
    });
  }
}

describe('isSubagentCapableAdapter', () => {
  it('accepts the hosts the stage-agent writer actually renders for', () => {
    expect(STAGE_AGENT_HOSTS.length).toBeGreaterThan(0);
    for (const host of STAGE_AGENT_HOSTS) {
      expect(isSubagentCapableAdapter(host.adapter, STAGE_AGENT_HOSTS)).toBe(true);
    }
  });

  it('rejects a host with no subagent dispatch', () => {
    expect(isSubagentCapableAdapter('gemini-cli', STAGE_AGENT_HOSTS)).toBe(false);
    expect(isSubagentCapableAdapter('aiassistant', STAGE_AGENT_HOSTS)).toBe(false);
  });

  it('rejects a missing adapter rather than guessing', () => {
    expect(isSubagentCapableAdapter(null, STAGE_AGENT_HOSTS)).toBe(false);
    expect(isSubagentCapableAdapter(undefined, STAGE_AGENT_HOSTS)).toBe(false);
  });
});

describe('stageIsolationExpected', () => {
  it('is true on a full lane on a subagent-capable host', () => {
    bundleWith('full-claude', 'full', 'claude-code');

    expect(stageIsolationExpected(root, SESSION, bundle('full-claude'))).toBe(true);
  });

  it('is false on a graduated lane under the default stage_isolation_lanes', () => {
    bundleWith('grad-codex', 'graduated', 'codex-cli');

    expect(stageIsolationExpected(root, SESSION, bundle('grad-codex'))).toBe(false);
  });

  it('is true on a graduated lane once stage_isolation_lanes names it', () => {
    bundleWith('grad-codex', 'graduated', 'codex-cli');
    vi.stubEnv('PAQAD_STAGE_ISOLATION_LANES', 'graduated,full');

    expect(stageIsolationExpected(root, SESSION, bundle('grad-codex'))).toBe(true);
  });

  it('is false on the fast lane (INV-2)', () => {
    bundleWith('fast-claude', 'fast', 'claude-code');

    expect(stageIsolationExpected(root, SESSION, bundle('fast-claude'))).toBe(false);
  });

  it('is false on a host that cannot dispatch subagents (INV-2)', () => {
    bundleWith('full-gemini', 'full', 'gemini-cli');

    expect(stageIsolationExpected(root, SESSION, bundle('full-gemini'))).toBe(false);
  });

  it('is false when the lane is unresolved, rather than inventing a requirement (INV-5)', () => {
    bundleWith('null-lane', null, 'claude-code');

    expect(stageIsolationExpected(root, SESSION, bundle('null-lane'))).toBe(false);
  });

  it('reads the lane and host a legacy-shape bundle stamped on its open row (INV-8)', () => {
    appendLegacyStageRow(root, bundle('legacy'), SESSION, {
      kind: 'open',
      adapter: 'claude-code',
      lane: 'full',
    });

    expect(stageIsolationExpected(root, SESSION, bundle('legacy'))).toBe(true);
  });

  it('judges the latest host recorded on feature.json, not the one that opened it (AC-26)', () => {
    bundleWith('switched', 'full', 'claude-code');
    recordChangeConstants(root, bundle('switched'), { adapter: 'gemini-cli' });

    expect(stageIsolationExpected(root, SESSION, bundle('switched'))).toBe(false);
  });

  it('is false for a bundle that does not exist', () => {
    expect(stageIsolationExpected(root, SESSION, bundle('no-such-bundle'))).toBe(false);
  });

  it('is false without a session or a change', () => {
    expect(stageIsolationExpected(root, null, bundle('full-claude'))).toBe(false);
    expect(stageIsolationExpected(root, SESSION, null)).toBe(false);
  });

  it('is false for a bundle whose ledger cannot be read, and its lane reads unresolved', () => {
    const dir = bundle('unreadable');
    mkdirSync(
      join(root, '.paqad/ledger/feature-evidence', dir, FEATURE_BUNDLE_FILES.stageEvidence),
      {
        recursive: true,
      },
    );
    expect(stageIsolationExpected(root, SESSION, dir)).toBe(false);
    expect(buildBundleCompletenessConfig(root, SESSION, dir).lane).toBeNull();
  });

  it('reads the lane once for the builder, with or without a session', () => {
    bundleWith('full-claude', 'full', 'claude-code');
    const withSession = buildBundleCompletenessConfig(root, SESSION, bundle('full-claude'));
    expect([withSession.lane, withSession.stageIsolationExpected]).toEqual(['full', true]);
    const noSession = buildBundleCompletenessConfig(root, null, bundle('full-claude'));
    expect([noSession.lane, noSession.stageIsolationExpected]).toEqual(['full', false]);
  });
});

describe('stageIsolationStatus', () => {
  it('is "expected" on a full lane and "not-applicable" on graduated by default', () => {
    bundleWith('full-claude', 'full', 'claude-code');
    bundleWith('grad-codex', 'graduated', 'codex-cli');
    expect(stageIsolationStatus(root, SESSION, bundle('full-claude'))).toBe('expected');
    expect(stageIsolationStatus(root, SESSION, bundle('grad-codex'))).toBe('not-applicable');
  });

  it('follows stage_isolation_lanes from the policy config file', () => {
    bundleWith('grad-codex', 'graduated', 'codex-cli');
    mkdirSync(join(root, '.paqad/configs'), { recursive: true });
    writeFileSync(join(root, '.paqad/configs/.config.policy'), 'stage_isolation_lanes=graduated\n');
    expect(stageIsolationStatus(root, SESSION, bundle('grad-codex'))).toBe('expected');
  });

  it('keeps full isolated whatever stage_isolation_lanes says', () => {
    bundleWith('full-claude', 'full', 'claude-code');
    bundleWith('fast-claude', 'fast', 'claude-code');
    vi.stubEnv('PAQAD_STAGE_ISOLATION_LANES', 'fast');
    expect(stageIsolationStatus(root, SESSION, bundle('full-claude'))).toBe('expected');
    expect(stageIsolationStatus(root, SESSION, bundle('fast-claude'))).toBe('expected');
  });

  it('keeps an unresolved lane unresolved and an incapable host not-applicable under any list', () => {
    bundleWith('null-lane', null, 'claude-code');
    bundleWith('grad-gemini', 'graduated', 'gemini-cli');
    vi.stubEnv('PAQAD_STAGE_ISOLATION_LANES', 'fast,graduated,full');
    expect(stageIsolationStatus(root, SESSION, bundle('null-lane'))).toBe('unresolved');
    expect(stageIsolationStatus(root, SESSION, bundle('grad-gemini'))).toBe('not-applicable');
  });

  it('gives the builder the same answer as the status', () => {
    bundleWith('grad-codex', 'graduated', 'codex-cli');
    expect(buildBundleCompletenessConfig(root, SESSION, bundle('grad-codex'))).toMatchObject({
      lane: 'graduated',
      stageIsolationExpected: false,
      stageIsolationUnresolved: false,
    });
    vi.stubEnv('PAQAD_STAGE_ISOLATION_LANES', 'graduated,full');
    expect(
      buildBundleCompletenessConfig(root, SESSION, bundle('grad-codex')).stageIsolationExpected,
    ).toBe(true);
  });

  it('is "unresolved" when the lane never resolved on a subagent-capable host (FR-4)', () => {
    bundleWith('null-lane', null, 'claude-code');
    expect(stageIsolationStatus(root, SESSION, bundle('null-lane'))).toBe('unresolved');
  });

  it('is "not-applicable" on the fast lane, an incapable host, or no bundle', () => {
    bundleWith('fast-claude', 'fast', 'claude-code');
    bundleWith('full-gemini', 'full', 'gemini-cli');
    bundleWith('null-gemini', null, 'gemini-cli');
    expect(stageIsolationStatus(root, SESSION, bundle('fast-claude'))).toBe('not-applicable');
    expect(stageIsolationStatus(root, SESSION, bundle('full-gemini'))).toBe('not-applicable');
    expect(stageIsolationStatus(root, SESSION, bundle('null-gemini'))).toBe('not-applicable');
    expect(stageIsolationStatus(root, SESSION, null)).toBe('not-applicable');
    expect(stageIsolationStatus(root, null, bundle('fast-claude'))).toBe('not-applicable');
  });

  it('isolationConfig maps the status to the two mutually-exclusive gate flags', () => {
    bundleWith('full-claude', 'full', 'claude-code');
    bundleWith('null-lane', null, 'claude-code');
    bundleWith('fast-claude', 'fast', 'claude-code');
    expect(isolationConfig(root, SESSION, bundle('full-claude'))).toEqual({
      stageIsolationExpected: true,
      stageIsolationUnresolved: false,
    });
    expect(isolationConfig(root, SESSION, bundle('null-lane'))).toEqual({
      stageIsolationExpected: false,
      stageIsolationUnresolved: true,
    });
    expect(isolationConfig(root, SESSION, bundle('fast-claude'))).toEqual({
      stageIsolationExpected: false,
      stageIsolationUnresolved: false,
    });
  });
});

describe('isolation after a forward-only raise', () => {
  const at = (minute: number) => () =>
    new Date(`2026-10-29T12:${String(minute).padStart(2, '0')}:00.000Z`);

  function raisedChange(): string {
    const dir = openFeatureChange(root, SESSION, {
      adapter: 'claude-code',
      title: 'grew past the plan',
      lane: 'full',
    });
    writePendingImpact(root, SESSION, { database_impact: 'none', api_impact: 'none' });
    planLaneResize({
      projectRoot: root,
      sessionId: SESSION,
      dirName: dir,
      steps: [{ id: 'S1', description: 'edit', files: ['src/a.ts'] }],
      changedFiles: [],
      now: at(0),
    });
    for (const [minute, stage] of [
      [1, 'planning'],
      [2, 'specification'],
      [3, 'development'],
    ] as const) {
      appendFeatureStageRow(
        root,
        SESSION,
        dir,
        { kind: 'stage_start', stage, event_status: 'started' },
        at(minute),
      );
    }
    raiseLaneIfGrown({
      projectRoot: root,
      dirName: dir,
      plannedFiles: [],
      changedFiles: Array.from({ length: 11 }, (_, i) => `src/f${i}.ts`),
      now: at(10),
    });
    expect(readFeatureRecord(root, dir)?.lane).toBe('full');
    return dir;
  }

  it('is not-applicable until a stage starts after the raise, so inline stages are accepted', () => {
    const dir = raisedChange();
    expect(stageIsolationStatus(root, SESSION, dir)).toBe('not-applicable');
    const config = buildBundleCompletenessConfig(root, SESSION, dir);
    expect(config.stageIsolationExpected).toBe(false);
    expect(config.stageIsolationSince).toBeUndefined();
  });

  it('is expected from the raise on once a stage starts after it', () => {
    const dir = raisedChange();
    appendFeatureStageRow(
      root,
      SESSION,
      dir,
      { kind: 'stage_start', stage: 'review', event_status: 'started' },
      at(11),
    );
    expect(stageIsolationStatus(root, SESSION, dir)).toBe('expected');
    expect(buildBundleCompletenessConfig(root, SESSION, dir)).toMatchObject({
      stageIsolationExpected: true,
      stageIsolationSince: '2026-10-29T12:10:00.000Z',
    });
  });
});

describe('the isolation evidence lives in stage-evidence.jsonl', () => {
  it('has no separate bundle file or manifest entry any more', () => {
    expect(Object.values(FEATURE_BUNDLE_FILES)).not.toContain('context-efficiency.jsonl');
    expect(BUNDLE_MANIFEST.map((row) => row.file)).not.toContain('context-efficiency.jsonl');
  });
});
