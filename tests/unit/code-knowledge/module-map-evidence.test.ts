import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { writeModuleMapEvidence } from '@/code-knowledge/module-map-evidence.js';
import { PATHS } from '@/core/constants/paths.js';
import type { CodeKnowledgeIndex, CodeKnowledgeSymbol } from '@/code-knowledge/types.js';
import { CODE_KNOWLEDGE_SCHEMA_VERSION } from '@/code-knowledge/types.js';

function symbol(name: string, slug: string | null): CodeKnowledgeSymbol {
  return {
    name,
    kind: 'function',
    file: 'src/x.ts',
    line: 1,
    signature: `${name}()`,
    exported: true,
    module_slug: slug,
    extraction_tier: 'regex',
    caller_count: 0,
    orphan: true,
  };
}

function indexWith(symbols: CodeKnowledgeSymbol[]): CodeKnowledgeIndex {
  return {
    schema_version: CODE_KNOWLEDGE_SCHEMA_VERSION,
    header: {
      generated_at: 't',
      branch: null,
      head_commit: null,
      schema_version: CODE_KNOWLEDGE_SCHEMA_VERSION,
      entry_point_globs: [],
    },
    symbols,
    files: [],
    import_edges: [],
    reference_edges: [],
    dependencies: [],
  };
}

describe('writeModuleMapEvidence', () => {
  let root: string;

  function writeMap(yaml: string): void {
    mkdirSync(join(root, 'docs', 'instructions', 'rules'), { recursive: true });
    writeFileSync(join(root, PATHS.MODULE_MAP), yaml);
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-mm-evidence-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("fills evidence.symbols per module and preserves comments (this repo's version:2)", () => {
    writeMap(
      [
        'version: 2',
        'modules:',
        '  # the core module',
        '  - slug: core',
        '    sources: [src/core]',
        '  - slug: api',
        '    sources: [src/api]',
      ].join('\n'),
    );

    const result = writeModuleMapEvidence(
      root,
      indexWith([symbol('b', 'core'), symbol('a', 'core'), symbol('routeThing', 'api')]),
    );
    expect(result).toEqual({ written: true, modulesUpdated: 2 });

    const raw = readFileSync(join(root, PATHS.MODULE_MAP), 'utf8');
    expect(raw).toContain('# the core module'); // comment survived
    expect(raw).toContain('sources: [src/core]'); // hand-authored flow style preserved (no padding)
    const parsed = parseYaml(raw) as {
      modules: Array<{ slug: string; evidence?: { symbols?: string[] } }>;
    };
    const core = parsed.modules.find((m) => m.slug === 'core');
    expect(core?.evidence?.symbols).toEqual(['a', 'b']); // sorted + deduped
    expect(parsed.modules.find((m) => m.slug === 'api')?.evidence?.symbols).toEqual(['routeThing']);
  });

  it('preserves an existing evidence.routes block when adding symbols', () => {
    writeMap(
      [
        'modules:',
        '  - slug: web',
        '    source_paths: [src/web]',
        '    evidence:',
        '      routes: [/home]',
      ].join('\n'),
    );
    const result = writeModuleMapEvidence(root, indexWith([symbol('page', 'web')]));
    expect(result.modulesUpdated).toBe(1);
    const parsed = parseYaml(readFileSync(join(root, PATHS.MODULE_MAP), 'utf8')) as {
      modules: Array<{ evidence?: { routes?: string[]; symbols?: string[] } }>;
    };
    expect(parsed.modules[0]?.evidence?.routes).toEqual(['/home']);
    expect(parsed.modules[0]?.evidence?.symbols).toEqual(['page']);
  });

  it('is a no-op when no module matches an indexed symbol', () => {
    writeMap(['modules:', '  - slug: core', '    sources: [src/core]'].join('\n'));
    expect(writeModuleMapEvidence(root, indexWith([symbol('x', 'other')]))).toEqual({
      written: false,
      modulesUpdated: 0,
    });
  });

  it('is a no-op when the map is missing', () => {
    expect(writeModuleMapEvidence(root, indexWith([symbol('x', 'core')]))).toEqual({
      written: false,
      modulesUpdated: 0,
    });
  });

  it('is a no-op when `modules` is not a sequence', () => {
    writeMap('modules: not-a-sequence');
    expect(writeModuleMapEvidence(root, indexWith([symbol('x', 'core')])).written).toBe(false);
  });

  it('skips a non-map entry in the modules sequence', () => {
    writeMap(
      ['modules:', '  - just-a-string', '  - slug: core', '    sources: [src/core]'].join('\n'),
    );
    const result = writeModuleMapEvidence(root, indexWith([symbol('x', 'core')]));
    expect(result).toEqual({ written: true, modulesUpdated: 1 });
  });

  it('ignores symbols with no module slug', () => {
    writeMap(['modules:', '  - slug: core', '    sources: [src/core]'].join('\n'));
    expect(writeModuleMapEvidence(root, indexWith([symbol('loose', null)])).written).toBe(false);
  });
});
