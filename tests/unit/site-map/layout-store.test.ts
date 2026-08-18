import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  deleteSiteMapLayout,
  readSiteMapLayout,
  SiteMapLayoutError,
  validateLayout,
  writeSiteMapLayout,
} from '@/site-map/layout-store.js';

describe('site-map layout store (issue #489, Phase 3)', () => {
  let root: string;
  const layoutFile = (): string => join(root, PATHS.SITE_MAP_CANONICAL_LAYOUT);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-sitemap-layout-'));
    mkdirSync(dirname(layoutFile()), { recursive: true });
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads null when no layout file exists', () => {
    expect(readSiteMapLayout(root)).toBeNull();
  });

  it('writes and reads back a valid layout, dropping unknown fields', () => {
    const written = writeSiteMapLayout(root, {
      billing: { x: 10, y: 20, w: 300, h: 200, color: '#abc', label: 'Billing' },
      onboarding: { x: 400, y: 20, w: 250, h: 180 },
    });
    expect(written.billing).toEqual({
      x: 10,
      y: 20,
      w: 300,
      h: 200,
      color: '#abc',
      label: 'Billing',
    });
    const read = readSiteMapLayout(root);
    expect(read).toEqual(written);
    // Persisted under a versioned envelope.
    const raw = YAML.parse(readFileSync(layoutFile(), 'utf8')) as { version: number };
    expect(raw.version).toBe(1);
  });

  it('rejects a non-object payload', () => {
    expect(() => writeSiteMapLayout(root, 42)).toThrow(SiteMapLayoutError);
  });

  it('rejects a district missing numeric fields', () => {
    expect(() => writeSiteMapLayout(root, { a: { x: 1, y: 2 } })).toThrow(/finite numeric/);
    expect(() => writeSiteMapLayout(root, { a: 'nope' })).toThrow(/must be an object/);
    expect(() => writeSiteMapLayout(root, { a: { x: 1, y: 2, w: NaN, h: 4 } })).toThrow(
      SiteMapLayoutError,
    );
  });

  it('validateLayout keeps only string color/label', () => {
    const layout = validateLayout({
      a: { x: 1, y: 2, w: 3, h: 4, color: 5, label: 'ok' },
    });
    expect(layout.a).toEqual({ x: 1, y: 2, w: 3, h: 4, label: 'ok' });
  });

  it('reads null on a corrupt or non-object file', () => {
    writeFileSync(layoutFile(), ': not yaml :\n  - [', 'utf8');
    expect(readSiteMapLayout(root)).toBeNull();
    writeFileSync(layoutFile(), YAML.stringify('a string'), 'utf8');
    expect(readSiteMapLayout(root)).toBeNull();
  });

  it('reads an empty layout when districts is absent', () => {
    writeFileSync(layoutFile(), YAML.stringify({ version: 1 }), 'utf8');
    expect(readSiteMapLayout(root)).toEqual({});
  });

  it('deletes the layout file (idempotent)', () => {
    writeSiteMapLayout(root, { a: { x: 1, y: 2, w: 3, h: 4 } });
    expect(existsSync(layoutFile())).toBe(true);
    deleteSiteMapLayout(root);
    expect(existsSync(layoutFile())).toBe(false);
    // No throw when already gone.
    expect(() => deleteSiteMapLayout(root)).not.toThrow();
  });
});
