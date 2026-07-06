import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FeatureSpec } from '@/core/types/feature-spec.js';
import { sha256Hex } from '@/compliance/markdown.js';
import { DecisionStore } from '@/planning/decision-store.js';
import { runSpecChangeGuard } from '@/spec/spec-change-guard.js';

const FROZEN_MARKDOWN = '# Spec S-102\n\nExport as CSV.\n';

function frozenSpec(overrides: Partial<FeatureSpec> = {}): FeatureSpec {
  return {
    schema_version: '1',
    spec_id: 'S-102',
    spec_file: '.paqad/specs/S-102.md',
    spec_hash: sha256Hex(FROZEN_MARKDOWN),
    behaviour: ['FR-1'],
    acceptance_criteria: [],
    invariants: [],
    open_questions: [],
    frozen: {
      frozen_at: '2026-06-07T00:00:00Z',
      spec_hash: sha256Hex(FROZEN_MARKDOWN),
      signed_off_by: 'owner',
    },
    ...overrides,
  };
}

function pendingIds(root: string): string[] {
  const dir = join(root, '.paqad/decisions/pending');
  return existsSync(dir) ? readdirSync(dir).filter((f) => /^D-.*\.json$/.test(f)) : [];
}

describe('runSpecChangeGuard — deterministic frozen-spec staleness minter (#300)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-specchange-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('is inert (NO_OP) when no frozen spec is persisted', () => {
    const out = runSpecChangeGuard({ projectRoot: root, sessionId: 'ses1', seam: 'pre-mutation' });
    expect(out).toEqual({ ran: false, blocking: false, summary: '' });
    expect(pendingIds(root)).toHaveLength(0);
  });

  it('no-ops at a non-pre-mutation seam', () => {
    const out = runSpecChangeGuard({
      projectRoot: root,
      sessionId: 'ses1',
      seam: 'completion',
      frozenSpecs: [frozenSpec()],
      readMarkdown: () => 'CHANGED',
    });
    expect(out.ran).toBe(false);
  });

  it('no-ops without a session id', () => {
    const out = runSpecChangeGuard({
      projectRoot: root,
      sessionId: null,
      frozenSpecs: [frozenSpec()],
      readMarkdown: () => 'CHANGED',
    });
    expect(out.ran).toBe(false);
  });

  it('mints ONE spec.change pause when the frozen spec source is stale', () => {
    const out = runSpecChangeGuard({
      projectRoot: root,
      sessionId: 'ses1',
      seam: 'pre-mutation',
      frozenSpecs: [frozenSpec()],
      readMarkdown: () => '# Spec S-102\n\nExport as XLSX now.\n',
      now: () => new Date('2026-06-07T00:00:00.000Z'),
    });
    expect(out.ran).toBe(true);
    expect(out.blocking).toBe(false);
    expect(out.summary).toContain('▸ paqad');
    expect(out.summary).toContain('S-102');
    expect(pendingIds(root)).toHaveLength(1);
  });

  it('does NOT mint when the frozen spec source is unchanged', () => {
    const out = runSpecChangeGuard({
      projectRoot: root,
      sessionId: 'ses1',
      seam: 'pre-mutation',
      frozenSpecs: [frozenSpec()],
      readMarkdown: () => FROZEN_MARKDOWN,
    });
    expect(out.ran).toBe(false);
    expect(pendingIds(root)).toHaveLength(0);
  });

  it('never piles a second pause on top of an open one', () => {
    const first = runSpecChangeGuard({
      projectRoot: root,
      sessionId: 'ses1',
      seam: 'pre-mutation',
      frozenSpecs: [frozenSpec()],
      readMarkdown: () => 'CHANGED',
    });
    expect(first.ran).toBe(true);
    const second = runSpecChangeGuard({
      projectRoot: root,
      sessionId: 'ses1',
      seam: 'pre-mutation',
      frozenSpecs: [frozenSpec({ spec_id: 'S-200', spec_file: '.paqad/specs/S-200.md' })],
      readMarkdown: () => 'ALSO CHANGED',
    });
    expect(second.ran).toBe(false);
    expect(pendingIds(root)).toHaveLength(1);
  });

  it('skips a spec whose source cannot be read this run', () => {
    const out = runSpecChangeGuard({
      projectRoot: root,
      sessionId: 'ses1',
      seam: 'pre-mutation',
      frozenSpecs: [frozenSpec()],
      readMarkdown: () => {
        throw new Error('ENOENT');
      },
    });
    expect(out.ran).toBe(false);
    expect(pendingIds(root)).toHaveLength(0);
  });

  it('does not re-ask a spec.change that was already resolved', () => {
    const first = runSpecChangeGuard({
      projectRoot: root,
      sessionId: 'ses1',
      seam: 'pre-mutation',
      frozenSpecs: [frozenSpec()],
      readMarkdown: () => 'CHANGED',
    });
    const store = new DecisionStore(root);
    store.resolve({
      decisionId: pendingIds(root)[0].replace(/\.json$/, ''),
      humanResponse: {
        chosen_option_key: 'update-and-refreeze',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: new Date().toISOString(),
        responded_by: 'tester',
        carry_over_scope: 'task',
      },
    });
    expect(first.ran).toBe(true);
    const again = runSpecChangeGuard({
      projectRoot: root,
      sessionId: 'ses1',
      seam: 'pre-mutation',
      frozenSpecs: [frozenSpec()],
      readMarkdown: () => 'CHANGED',
    });
    expect(again.ran).toBe(false);
    expect(pendingIds(root)).toHaveLength(0);
  });

  it('declines gracefully when the store write fails', () => {
    const fakeStore = {
      initialize() {},
      listPendingDecisionIds: () => [],
      findReusableDecision: () => null,
      nextDecisionId: () => 'D-01J000000000000000000000ZZ',
      writePending() {
        throw new Error('cap reached');
      },
    } as unknown as DecisionStore;
    const out = runSpecChangeGuard({
      projectRoot: root,
      sessionId: 'ses1',
      seam: 'pre-mutation',
      store: fakeStore,
      frozenSpecs: [frozenSpec()],
      readMarkdown: () => 'CHANGED',
    });
    expect(out.ran).toBe(false);
  });

  it('runs the check when seam is omitted (reads persisted sidecars, inert here)', () => {
    const out = runSpecChangeGuard({ projectRoot: root, sessionId: 'ses1' });
    expect(out.ran).toBe(false);
  });
});
