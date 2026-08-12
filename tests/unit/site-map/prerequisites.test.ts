import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { detectSiteMapPrerequisites } from '@/site-map/prerequisites.js';

describe('detectSiteMapPrerequisites (issue #466, PRE-1..12)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-sitemap-prereq-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeModuleMap(modules: unknown[]): void {
    const path = join(root, PATHS.MODULE_MAP);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, YAML.stringify({ modules }), 'utf8');
  }

  function writeModuleDoc(slug: string): void {
    const dir = join(root, PATHS.MODULES_DIR, slug, 'index');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'summary.md'), `# ${slug}\n`, 'utf8');
  }

  it('blocks on create documentation when module-map.yml is absent (PRE-2, PRE-4, PRE-5)', () => {
    const result = detectSiteMapPrerequisites(root);
    expect(result.satisfied).toBe(false);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0].workflow).toBe('create documentation');
    expect(result.missing[0].reason.length).toBeGreaterThan(0);
    expect(result.status).toEqual({
      foundation_present: false,
      module_count: 0,
      documented_module_count: 0,
    });
  });

  it('blocks on create module documentation when the foundation exists but no module is documented (PRE-2, Q6)', () => {
    writeModuleMap([{ slug: 'billing', name: 'Billing', sources: ['src/billing/**'] }]);
    const result = detectSiteMapPrerequisites(root);
    expect(result.satisfied).toBe(false);
    expect(result.missing.map((m) => m.workflow)).toEqual(['create module documentation']);
    expect(result.status).toEqual({
      foundation_present: true,
      module_count: 1,
      documented_module_count: 0,
    });
  });

  it('is satisfied when at least one module is documented, even with partial coverage (PRE-12)', () => {
    writeModuleMap([
      { slug: 'billing', name: 'Billing', sources: ['src/billing/**'] },
      { slug: 'orders', name: 'Orders', sources: ['src/orders/**'] },
    ]);
    writeModuleDoc('billing'); // orders left undocumented on purpose

    const result = detectSiteMapPrerequisites(root);
    expect(result.satisfied).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.status).toEqual({
      foundation_present: true,
      module_count: 2,
      documented_module_count: 1,
    });
  });

  it('does not block a foundation with zero declared modules (nothing to document)', () => {
    writeModuleMap([]);
    const result = detectSiteMapPrerequisites(root);
    expect(result.satisfied).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.status).toEqual({
      foundation_present: true,
      module_count: 0,
      documented_module_count: 0,
    });
  });
});
