import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  inspectProviderEntryBootstrapPointer,
  inspectProviderEntryFallbackClause,
} from '@/health/provider-entry-contract.js';

const MANIFEST = '.paqad/onboarding-manifest.json';
const COPILOT = '.github/copilot-instructions.md';
const COPILOT_SHOWN = join('.github', 'copilot-instructions.md');

describe('the entry-file checks and the recorded providers', () => {
  let root: string;
  const put = (rel: string, text: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  const manifest = (providers: string[], adapter = 'claude-code') =>
    JSON.stringify({ adapter, providers, generated_artifacts: [] });
  const statuses = () => [
    inspectProviderEntryBootstrapPointer(root).status,
    inspectProviderEntryFallbackClause(root).status,
  ];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-entry-recorded-'));
    put(COPILOT, 'our own copilot notes\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('AC-28: a Claude Code only project with its own Copilot file passes both checks when its entry is sound', () => {
    put(MANIFEST, manifest(['claude-code']));
    expect(inspectProviderEntryBootstrapPointer(root).detail).not.toContain(COPILOT_SHOWN);
    expect(inspectProviderEntryFallbackClause(root).detail).not.toContain(COPILOT_SHOWN);
  });

  it('AC-29: a recorded provider with a broken entry file still fails', () => {
    put(MANIFEST, manifest(['claude-code']));
    put('CLAUDE.md', 'no pointer here\n');
    expect(statuses()).toEqual(['fail', 'fail']);
    expect(inspectProviderEntryBootstrapPointer(root).detail).toContain('CLAUDE.md');
    expect(inspectProviderEntryBootstrapPointer(root).detail).not.toContain(COPILOT_SHOWN);
  });

  it.each([
    ['missing', null],
    ['corrupt', '{not json'],
  ])('AC-29: a %s manifest keeps checking every file that exists', (_name, text) => {
    if (text !== null) put(MANIFEST, text);
    expect(statuses()).toEqual(['fail', 'fail']);
    expect(inspectProviderEntryBootstrapPointer(root).detail).toContain(COPILOT_SHOWN);
  });

  it('AC-29: a manifest with empty providers uses the adapter it records', () => {
    put(MANIFEST, manifest([]));
    expect(inspectProviderEntryBootstrapPointer(root).detail).not.toContain(COPILOT_SHOWN);
  });

  it('AC-29: a manifest with no usable provider keeps checking every file that exists', () => {
    put(MANIFEST, JSON.stringify({ providers: [], generated_artifacts: [] }));
    expect(inspectProviderEntryBootstrapPointer(root).detail).toContain(COPILOT_SHOWN);
  });
});
