import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  compositionForRoute,
  readSessionRoute,
  writeSessionRoute,
} from '@/pipeline/session-route.js';

function routePath(root: string): string {
  return join(root, dirname(PATHS.CONTEXT_SESSION_ARTIFACT), '.session-route.json');
}

describe('session-route pointer (#336)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-session-route-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('round-trips a written route', () => {
    writeSessionRoute(root, { workflow: 'pentest', query: 'check the app for vulnerabilities' });
    expect(readSessionRoute(root)).toEqual({
      workflow: 'pentest',
      query: 'check the app for vulnerabilities',
    });
  });

  it('round-trips the routing host adapter (issue #566, AC-8)', () => {
    writeSessionRoute(root, { workflow: 'feature-development', query: 'x', adapter: 'codex-cli' });
    expect(readSessionRoute(root)).toEqual({
      workflow: 'feature-development',
      query: 'x',
      adapter: 'codex-cli',
    });
  });

  it('omits adapter when the stored route has none (older build)', () => {
    mkdirSync(dirname(routePath(root)), { recursive: true });
    writeFileSync(routePath(root), JSON.stringify({ workflow: 'pentest', query: 'y' }), 'utf8');
    expect(readSessionRoute(root)).toEqual({ workflow: 'pentest', query: 'y' });
  });

  it('returns null when no pointer was written', () => {
    expect(readSessionRoute(root)).toBeNull();
  });

  it('returns null on invalid JSON', () => {
    mkdirSync(dirname(routePath(root)), { recursive: true });
    writeFileSync(routePath(root), '{oops', 'utf8');
    expect(readSessionRoute(root)).toBeNull();
  });

  it('returns null when the workflow is not a routing outcome', () => {
    mkdirSync(dirname(routePath(root)), { recursive: true });
    writeFileSync(routePath(root), JSON.stringify({ workflow: 'nope', query: 'x' }), 'utf8');
    expect(readSessionRoute(root)).toBeNull();
  });

  it('defaults a missing query to empty string', () => {
    mkdirSync(dirname(routePath(root)), { recursive: true });
    writeFileSync(routePath(root), JSON.stringify({ workflow: 'project-question' }), 'utf8');
    expect(readSessionRoute(root)).toEqual({ workflow: 'project-question', query: '' });
  });
});

// Issue #582 (FR-10) — each session also keeps its own pointer, so the worker started for one
// session never reads another session's route; the shared pointer stays the fallback.
describe('per-session route pointer (issue #582)', () => {
  let root: string;
  const ownPath = (id: string) =>
    join(root, dirname(PATHS.CONTEXT_SESSION_ARTIFACT), '.session-route.d', `${id}.json`);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-session-route-own-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes both the shared and the per-session pointer when the id is known', () => {
    writeSessionRoute(root, { workflow: 'project-question', query: 'q' }, 'ses-A');
    expect(existsSync(routePath(root))).toBe(true);
    expect(existsSync(ownPath('ses-A'))).toBe(true);
  });

  it('writes only the shared pointer when no id is known', () => {
    writeSessionRoute(root, { workflow: 'project-question', query: 'q' });
    expect(existsSync(routePath(root))).toBe(true);
    expect(
      existsSync(join(root, dirname(PATHS.CONTEXT_SESSION_ARTIFACT), '.session-route.d')),
    ).toBe(false);
  });

  it('prefers the session own pointer over a later write by another session', () => {
    writeSessionRoute(root, { workflow: 'project-question', query: 'why?' }, 'ses-A');
    writeSessionRoute(root, { workflow: 'feature-development', query: 'build it' }, 'ses-B');
    expect(readSessionRoute(root, 'ses-A')?.workflow).toBe('project-question');
    expect(readSessionRoute(root, 'ses-B')?.workflow).toBe('feature-development');
    // The shared pointer is last-writer-wins, as before.
    expect(readSessionRoute(root)?.workflow).toBe('feature-development');
  });

  it('falls back to the shared pointer when the session has none', () => {
    writeSessionRoute(root, { workflow: 'pentest', query: 'x' });
    expect(readSessionRoute(root, 'ses-unknown')).toEqual({ workflow: 'pentest', query: 'x' });
  });

  it('falls back to the shared pointer when the session pointer is invalid', () => {
    writeSessionRoute(root, { workflow: 'pentest', query: 'x' });
    mkdirSync(dirname(ownPath('ses-A')), { recursive: true });
    writeFileSync(ownPath('ses-A'), '{oops', 'utf8');
    expect(readSessionRoute(root, 'ses-A')?.workflow).toBe('pentest');
  });

  it('sanitizes the session id into a safe filename', () => {
    writeSessionRoute(root, { workflow: 'site-map', query: 'map' }, 'a:b/../c');
    expect(existsSync(ownPath('a_b____c'))).toBe(true);
    expect(readSessionRoute(root, 'a:b/../c')?.workflow).toBe('site-map');
  });

  it('treats a blank session id as no id', () => {
    writeSessionRoute(root, { workflow: 'pentest', query: 'x' }, '   ');
    expect(
      existsSync(join(root, dirname(PATHS.CONTEXT_SESSION_ARTIFACT), '.session-route.d')),
    ).toBe(false);
    expect(readSessionRoute(root, '   ')?.workflow).toBe('pentest');
  });
});

describe('compositionForRoute (#336)', () => {
  it('loads rules and retrieves when there is no route yet (first prompt fallback)', () => {
    expect(compositionForRoute(null)).toEqual({ loadRules: true, retrieves: true });
  });

  it('loads rules only for feature-development', () => {
    expect(compositionForRoute({ workflow: 'feature-development', query: '' })).toEqual({
      loadRules: true,
      retrieves: true,
    });
    expect(compositionForRoute({ workflow: 'pentest', query: '' })).toEqual({
      loadRules: false,
      retrieves: true,
    });
  });

  it('retrieves nothing for no-workflow (small talk)', () => {
    expect(compositionForRoute({ workflow: 'no-workflow', query: '' })).toEqual({
      loadRules: false,
      retrieves: false,
    });
  });
});
