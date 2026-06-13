import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  deleteSavedView,
  listSavedViews,
  putSavedView,
  SavedViewNotFoundError,
} from '@/dashboard/saved-views.js';

describe('saved views store (#161)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-saved-views-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeRaw(content: string): void {
    mkdirSync(join(root, '.paqad/dashboard'), { recursive: true });
    writeFileSync(join(root, '.paqad/dashboard/saved-views.json'), content);
  }

  describe('listSavedViews', () => {
    it('returns [] when the file is missing, malformed, non-array, or holds bad entries', () => {
      expect(listSavedViews(root)).toEqual([]);

      writeRaw('{ not json');
      expect(listSavedViews(root)).toEqual([]);

      writeRaw('{"not":"an array"}');
      expect(listSavedViews(root)).toEqual([]);

      // Malformed entries are filtered out; the valid one survives.
      writeRaw(
        JSON.stringify([
          { id: 'ok', name: 'Good', area: 'graph', scope: {}, createdAt: '2026-01-01T00:00:00Z' },
          { id: 'bad-area', name: 'X', area: 'nope', scope: {}, createdAt: '2026-01-01T00:00:00Z' },
          { id: 'no-scope', name: 'X', area: 'graph', createdAt: '2026-01-01T00:00:00Z' },
          'not-an-object',
          null,
        ]),
      );
      expect(listSavedViews(root).map((v) => v.id)).toEqual(['ok']);
    });
  });

  describe('putSavedView', () => {
    it('creates, then updates in place while preserving createdAt', () => {
      const created = putSavedView(root, {
        id: 'g1',
        name: 'Modules',
        area: 'graph',
        scope: { overlay: 'health' },
      });
      expect(created.createdAt).toMatch(/^\d{4}-/);

      const updated = putSavedView(root, {
        id: 'g1',
        name: 'Modules renamed',
        area: 'graph',
        scope: { overlay: 'defects' },
      });
      expect(updated.name).toBe('Modules renamed');
      expect(updated.createdAt).toBe(created.createdAt);
      expect(listSavedViews(root)).toHaveLength(1);
    });

    it('trims and caps the name at 80 chars', () => {
      const view = putSavedView(root, {
        id: 'n1',
        name: '  ' + 'x'.repeat(200) + '  ',
        area: 'trust',
        scope: {},
      });
      expect(view.name).toHaveLength(80);
    });

    it('rejects a bad id, empty name, bad area, and a non-object or array scope', () => {
      expect(() => putSavedView(root, { id: 'a/b', name: 'n', area: 'graph', scope: {} })).toThrow(
        /id must be/,
      );
      expect(() => putSavedView(root, { id: 'g', name: '  ', area: 'graph', scope: {} })).toThrow(
        /name/,
      );
      expect(() => putSavedView(root, { id: 'g', name: 'n', area: 'nope', scope: {} })).toThrow(
        /area/,
      );
      expect(() => putSavedView(root, { id: 'g', name: 'n', area: 'graph', scope: null })).toThrow(
        /scope/,
      );
      expect(() =>
        putSavedView(root, { id: 'g', name: 'n', area: 'graph', scope: [1, 2] }),
      ).toThrow(/scope/);
    });
  });

  describe('deleteSavedView', () => {
    it('removes an existing view and throws SavedViewNotFoundError otherwise', () => {
      putSavedView(root, { id: 'd1', name: 'Del', area: 'export', scope: {} });
      expect(deleteSavedView(root, 'd1')).toEqual({ id: 'd1', removed: true });
      expect(listSavedViews(root)).toEqual([]);
      expect(() => deleteSavedView(root, 'd1')).toThrow(SavedViewNotFoundError);
    });
  });
});
