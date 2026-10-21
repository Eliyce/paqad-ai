import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  appendRouteTurn,
  episodeStart,
  readRouteTurns,
  ROUTE_TURNS_CAP,
  routeTurnsPath,
  turnRouteAt,
  type RouteTurn,
} from '@/pipeline/route-turns.js';

const SESSION = 'sess-route-turns';

describe('route-turn log', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-route-turns-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads an empty list when no log exists', () => {
    expect(readRouteTurns(root, SESSION)).toEqual([]);
  });

  it('appends one row per routed prompt and reads them back in order', () => {
    appendRouteTurn(root, SESSION, {
      at: '2026-10-01T10:00:00.000Z',
      workflow: 'project-question',
    });
    appendRouteTurn(root, SESSION, {
      at: '2026-10-01T10:05:00.000Z',
      workflow: 'feature-development',
    });
    expect(readRouteTurns(root, SESSION)).toEqual([
      { at: '2026-10-01T10:00:00.000Z', workflow: 'project-question' },
      { at: '2026-10-01T10:05:00.000Z', workflow: 'feature-development' },
    ]);
  });

  it('skips malformed rows and unknown workflows', () => {
    const path = routeTurnsPath(root, SESSION);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      [
        '{not json',
        JSON.stringify({ at: 'never', workflow: 'pentest' }),
        JSON.stringify({ at: '2026-10-01T10:00:00.000Z', workflow: 'made-up' }),
        JSON.stringify({ at: '2026-10-01T10:00:00.000Z', workflow: 'pentest' }),
        '',
      ].join('\n'),
    );
    expect(readRouteTurns(root, SESSION)).toEqual([
      { at: '2026-10-01T10:00:00.000Z', workflow: 'pentest' },
    ]);
  });

  it('trims the oldest rows past the cap and keeps the trailing run', () => {
    for (let index = 0; index < 6; index += 1) {
      appendRouteTurn(
        root,
        SESSION,
        {
          at: `2026-10-01T10:0${index}:00.000Z`,
          workflow: index < 3 ? 'project-question' : 'feature-development',
        },
        4,
      );
    }
    const turns = readRouteTurns(root, SESSION);
    expect(turns).toHaveLength(4);
    expect(turns[0]!.at).toBe('2026-10-01T10:02:00.000Z');
    expect(episodeStart(turns, 'feature-development')).toBe('2026-10-01T10:03:00.000Z');
    expect(readFileSync(routeTurnsPath(root, SESSION), 'utf8').endsWith('\n')).toBe(true);
  });

  it('caps at 2000 rows by default', () => {
    expect(ROUTE_TURNS_CAP).toBe(2000);
  });
});

describe('episodeStart', () => {
  const turns: RouteTurn[] = [
    { at: '2026-10-01T09:00:00.000Z', workflow: 'feature-development' },
    { at: '2026-10-01T09:10:00.000Z', workflow: 'project-question' },
    { at: '2026-10-01T09:20:00.000Z', workflow: 'feature-development' },
    { at: '2026-10-01T09:30:00.000Z', workflow: 'feature-development' },
  ];

  it('returns the first row of the trailing run of that workflow', () => {
    expect(episodeStart(turns, 'feature-development')).toBe('2026-10-01T09:20:00.000Z');
  });

  it('starts a new episode after a detour to another workflow', () => {
    const detour: RouteTurn[] = [
      ...turns,
      { at: '2026-10-01T09:40:00.000Z', workflow: 'project-question' },
    ];
    expect(episodeStart(detour, 'feature-development')).toBeNull();
    expect(episodeStart(detour, 'project-question')).toBe('2026-10-01T09:40:00.000Z');
  });

  it('returns null for an empty log', () => {
    expect(episodeStart([], 'feature-development')).toBeNull();
  });
});

describe('turnRouteAt', () => {
  const turns: RouteTurn[] = [
    { at: '2026-10-01T09:00:00.000Z', workflow: 'feature-development' },
    { at: '2026-10-01T09:10:00.000Z', workflow: 'project-question' },
  ];

  it('returns the workflow of the last row at or before the time', () => {
    expect(turnRouteAt(turns, '2026-10-01T09:00:00.000Z')).toBe('feature-development');
    expect(turnRouteAt(turns, '2026-10-01T09:09:59.999Z')).toBe('feature-development');
    expect(turnRouteAt(turns, '2026-10-01T09:10:00.000Z')).toBe('project-question');
  });

  it('returns null before the first row or for a bad time', () => {
    expect(turnRouteAt(turns, '2026-10-01T08:59:59.000Z')).toBeNull();
    expect(turnRouteAt(turns, 'not a time')).toBeNull();
  });
});
