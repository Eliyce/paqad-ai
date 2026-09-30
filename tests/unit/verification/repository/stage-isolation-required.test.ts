// Requiring the isolation evidence stream (issue #573).
//
// The core ask of #573: a graduated/full-lane change on a subagent-capable host that ran
// entirely in one context must FAIL by name instead of reporting "Safe to merge". The
// manifest previously marked `context-efficiency.jsonl` optional, with an accurate comment
// saying the gate had no signal for whether a given change ran under isolation. #573 found
// the missing signal — the lane was always null because the prompt-route seam was never
// built — so the predicate is now well defined and lives here.
//
// The other half matters just as much: this must stay silent on the fast lane, on a host
// with no subagent dispatch, and whenever the lane is unresolved (INV-2, INV-5). A gate
// that false-fails legitimate work is worse than the gap it closes.

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BUNDLE_MANIFEST } from '@/feature-evidence/manifest.js';
import { FEATURE_BUNDLE_FILES } from '@/feature-evidence/paths.js';
import {
  appendFeatureStageRow,
  featureStagePath,
  recordChangeConstants,
} from '@/feature-evidence/stage-ledger.js';
import { isSubagentCapableAdapter } from '@/stage-isolation/stage-agents.js';
import { STAGE_AGENT_HOSTS } from '@/stage-isolation/agent-writer.js';
import {
  isolationConfig,
  stageIsolationExpected,
  stageIsolationStatus,
} from '@/verification/repository/run-repository-verification.js';

import { appendLegacyStageRow } from '../../../shared/legacy-stage-row.js';

const SESSION = 'isolation-required-session';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-iso-required-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A real bundle dir name for `name`, so feature.json can be written for it. */
function bundle(name: string): string {
  return `573-${name}-01JABCDEFGHJKMNPQRSTVWXYZ0`;
}

/**
 * Write a bundle whose `feature.json` carries `lane` and `adapter` (issue #581: the one home
 * of the session constants), plus a full stage set of rows that carry neither.
 */
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
    // Derived from the same roster, so the installer and the gate cannot disagree.
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

describe('stageIsolationExpected (issue #573)', () => {
  it('is true on a full lane on a subagent-capable host', () => {
    bundleWith('full-claude', 'full', 'claude-code');

    expect(stageIsolationExpected(root, SESSION, bundle('full-claude'))).toBe(true);
  });

  it('is true on a graduated lane too', () => {
    bundleWith('grad-codex', 'graduated', 'codex-cli');

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
    // This is the state every change was in before #573. It must not start blocking.
    bundleWith('null-lane', null, 'claude-code');

    expect(stageIsolationExpected(root, SESSION, bundle('null-lane'))).toBe(false);
  });

  it('reads the lane and host a pre-#581 bundle stamped on its open row (INV-8)', () => {
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
});

describe('stageIsolationStatus (issue #602)', () => {
  it('is "expected" on a graduated/full lane on a subagent-capable host', () => {
    bundleWith('full-claude', 'full', 'claude-code');
    bundleWith('grad-codex', 'graduated', 'codex-cli');
    expect(stageIsolationStatus(root, SESSION, bundle('full-claude'))).toBe('expected');
    expect(stageIsolationStatus(root, SESSION, bundle('grad-codex'))).toBe('expected');
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
    // An unresolved lane on a host that could never isolate is not surfaced either.
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

describe('the isolation evidence lives in stage-evidence.jsonl (issue #581, D9)', () => {
  it('has no separate bundle file or manifest entry any more', () => {
    expect(Object.values(FEATURE_BUNDLE_FILES)).not.toContain('context-efficiency.jsonl');
    expect(BUNDLE_MANIFEST.map((row) => row.file)).not.toContain('context-efficiency.jsonl');
  });
});
