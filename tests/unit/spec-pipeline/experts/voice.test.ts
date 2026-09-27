import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { DetectedStackProfile } from '@/core/types/introspection.js';
import type { PackRegistry } from '@/core/types/pack.js';
import type { VocabularyEntry } from '@/spec-pipeline/types.js';
import {
  buildStackLine,
  glossaryPresent,
  MAX_VOICE_TERMS,
  orderVoiceTerms,
  renderProjectVoice,
  resolveDocPages,
  resolveGuidePointers,
  resolveTechnicalPages,
} from '@/spec-pipeline/experts/voice.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-voice-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function write(root: string, rel: string, body = 'x'): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body, 'utf8');
}

const VOCAB: VocabularyEntry[] = [
  { term: 'Issued invoice', definition: 'an invoice that can no longer change', kind: 'glossary', source: 'docs/modules/billing/business.md' },
  { term: 'Customer', kind: 'role', source: 'docs/modules/billing/business.md' },
  { term: 'Invoices page', kind: 'flow', source: 'docs/modules/billing/business.md' },
];

describe('renderProjectVoice (issue #558, AC-5)', () => {
  it('carries the stack line, guide pointers, pages and business words', () => {
    const block = renderProjectVoice({
      stackLine: 'Stack: Laravel with Vue; php / composer.',
      guidePointers: ['runtime/capabilities/coding/stacks/laravel/rules/foundation/guide.md'],
      noGuidesShipped: false,
      architecturePage: 'docs/instructions/architecture/overview.md',
      stackPage: 'docs/instructions/stack/overview.md',
      technicalPages: ['docs/modules/billing/features/invoices/technical.md'],
      vocabulary: VOCAB,
    });
    expect(block).toContain('## Project voice');
    expect(block).toContain('Stack: Laravel with Vue; php / composer.');
    expect(block).toContain('Read the stack guides before you write:');
    expect(block).toContain('Architecture page: `docs/instructions/architecture/overview.md`');
    expect(block).toContain('Stack page: `docs/instructions/stack/overview.md`');
    expect(block).toContain('Technical pages for the touched modules:');
    expect(block).toContain(
      '- Issued invoice: an invoice that can no longer change (glossary, docs/modules/billing/business.md)',
    );
    expect(block).toContain('- Customer (role, docs/modules/billing/business.md)');
  });

  it('prints the no-guides fallback line when packs ship none', () => {
    const block = renderProjectVoice({
      stackLine: 'Stack: Go; go / go.',
      guidePointers: [],
      noGuidesShipped: true,
      technicalPages: [],
      vocabulary: VOCAB,
    });
    expect(block).toContain('No stack guides shipped for this pack; use the architecture and stack pages.');
  });

  it('prints the none-documented line when there is no vocabulary', () => {
    const block = renderProjectVoice({
      stackLine: 'Stack: unknown (no framework detected); node / pnpm.',
      guidePointers: [],
      noGuidesShipped: false,
      technicalPages: [],
      vocabulary: [],
    });
    expect(block).toContain('(none documented yet; use the request\'s own words');
  });
});

describe('orderVoiceTerms', () => {
  it('orders glossary, role, flow, rule, technical and caps at MAX_VOICE_TERMS', () => {
    const many: VocabularyEntry[] = [
      { term: 't', kind: 'technical', source: 's' },
      { term: 'f', kind: 'flow', source: 's' },
      { term: 'g', kind: 'glossary', source: 's' },
      { term: 'r', kind: 'role', source: 's' },
      { term: 'b', kind: 'rule', source: 's' },
    ];
    expect(orderVoiceTerms(many).map((e) => e.kind)).toEqual([
      'glossary',
      'role',
      'flow',
      'rule',
      'technical',
    ]);
    const overflow: VocabularyEntry[] = Array.from({ length: MAX_VOICE_TERMS + 5 }, (_, i) => ({
      term: `t${i}`,
      kind: 'glossary' as const,
      source: 's',
    }));
    expect(orderVoiceTerms(overflow)).toHaveLength(MAX_VOICE_TERMS);
  });
});

describe('buildStackLine', () => {
  it('prints the unknown-stack line when no framework is detected', () => {
    expect(buildStackLine(null, null)).toBe('Stack: unknown (no framework detected); node / pnpm.');
    expect(buildStackLine({ frameworks: [], traits: [], toolchains: [], version_bands: [], sources: [] }, null)).toBe(
      'Stack: unknown (no framework detected); node / pnpm.',
    );
  });

  it('builds from the profile, using pack display names, version bands, and the toolchain', () => {
    const profile: DetectedStackProfile = {
      frameworks: ['laravel', 'vue'],
      traits: [],
      toolchains: [{ ecosystem: 'php', package_manager: 'composer', lockfile: 'composer.lock' }],
      version_bands: [{ name: 'laravel', package_name: 'laravel/framework', range: '^12', locked_version: '12.1.0', source: 'lockfile' }],
      sources: [],
    };
    const packs = {
      packs: new Map([
        ['laravel', { manifest: { name: 'laravel', display_name: 'Laravel' }, root: '/x', manifestPath: '', source: 'built-in', validation: { valid: true, issues: [] } }],
      ]),
      warnings: [],
    } as unknown as PackRegistry;
    expect(buildStackLine(profile, packs)).toBe('Stack: Laravel (^12) with vue; php / composer.');
  });
});

describe('resolvers', () => {
  it('resolveGuidePointers finds shipped guides under active packs', () => {
    const runtime = tempRoot();
    write(runtime, 'capabilities/coding/stacks/laravel/rules/foundation/guide.md');
    const profile = { frameworks: ['laravel'], traits: [], toolchains: [], version_bands: [], sources: [] } as DetectedStackProfile;
    const packs = {
      packs: new Map([
        ['laravel', { manifest: { name: 'laravel', display_name: 'Laravel' }, root: join(runtime, 'capabilities/coding/stacks/laravel'), manifestPath: '', source: 'built-in', validation: { valid: true, issues: [] } }],
      ]),
      warnings: [],
    } as unknown as PackRegistry;
    const { guidePointers, noGuidesShipped } = resolveGuidePointers(runtime, profile, packs);
    expect(guidePointers).toEqual(['runtime/capabilities/coding/stacks/laravel/rules/foundation/guide.md']);
    expect(noGuidesShipped).toBe(false);
  });

  it('resolveGuidePointers reports no-guides when an active pack ships none', () => {
    const runtime = tempRoot();
    const profile = { frameworks: ['laravel'], traits: [], toolchains: [], version_bands: [], sources: [] } as DetectedStackProfile;
    const packs = {
      packs: new Map([
        ['laravel', { manifest: { name: 'laravel', display_name: 'Laravel' }, root: join(runtime, 'nope'), manifestPath: '', source: 'built-in', validation: { valid: true, issues: [] } }],
      ]),
      warnings: [],
    } as unknown as PackRegistry;
    expect(resolveGuidePointers(runtime, profile, packs)).toEqual({ guidePointers: [], noGuidesShipped: true });
  });

  it('resolveGuidePointers is empty when there is no profile or no packs', () => {
    expect(resolveGuidePointers('/x', null, null)).toEqual({ guidePointers: [], noGuidesShipped: false });
  });

  it('resolveDocPages, resolveTechnicalPages and glossaryPresent read the project tree', () => {
    const root = tempRoot();
    write(root, 'docs/instructions/architecture/overview.md');
    write(root, 'docs/modules/billing/technical.md');
    write(root, '.paqad/glossary.md');
    expect(resolveDocPages(root)).toEqual({ architecturePage: 'docs/instructions/architecture/overview.md' });
    expect(resolveTechnicalPages(root, ['billing', 'missing'])).toEqual(['docs/modules/billing/technical.md']);
    expect(glossaryPresent(root)).toBe(true);
    expect(glossaryPresent(tempRoot())).toBe(false);
  });
});
