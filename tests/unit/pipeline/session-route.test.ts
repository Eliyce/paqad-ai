import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
