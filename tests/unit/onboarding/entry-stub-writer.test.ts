import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { wireEntryStubs } from '@/onboarding/entry-stub-writer.js';

const BEGIN = '<!-- >>> paqad-ai managed entry stub (do not edit between markers) >>> -->';
const END = '<!-- <<< paqad-ai managed entry stub <<< -->';

// A realistic lean stub body (what the Claude adapter renders): bootstrap
// pointer + fallback clause + Adapter footer.
const STUB_BODY = [
  '# Claude Entry Framework',
  '',
  `Before any repository work, open \`${PATHS.FRAMEWORK_PATH}\`, resolve the reference inside it to the paqad install directory, and load and follow the framework bootstrap it points to (\`AGENT-BOOTSTRAP.md\` in that directory).`,
  '',
  '**Fallback:** if `.paqad/framework-path.txt` is missing or cannot be resolved, or paqad is disabled, proceed as a normal assistant with no paqad behavior. Do not block.',
  '',
  'Adapter:',
  'claude-code',
  '',
].join('\n');

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('wireEntryStubs (issue #242)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-entry-stub-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  const read = (file: string) => readFileSync(join(projectRoot, file), 'utf8');

  it('appends a managed block to a pre-existing foreign entry file, preserving prior content', () => {
    const boost = '# Laravel Boost\n\nProject-specific guidance authored by Boost.\n';
    writeFileSync(join(projectRoot, 'CLAUDE.md'), boost);

    const result = wireEntryStubs(projectRoot, [{ path: 'CLAUDE.md', content: STUB_BODY }]);

    expect(result.wired).toEqual(['CLAUDE.md']);
    const wired = read('CLAUDE.md');
    // Prior content preserved above the block.
    expect(wired.startsWith(boost.replace(/\s+$/, ''))).toBe(true);
    // The managed block carries the bootstrap contract.
    expect(wired).toContain(BEGIN);
    expect(wired).toContain(END);
    expect(wired).toContain(PATHS.FRAMEWORK_PATH);
    expect(wired).toContain('AGENT-BOOTSTRAP.md');
    expect(wired).toContain('Project-specific guidance authored by Boost.');
  });

  it('is idempotent and re-onboard-safe: re-running leaves the file byte-identical', () => {
    writeFileSync(join(projectRoot, 'CLAUDE.md'), '# Laravel Boost\n\nBoost content.\n');

    wireEntryStubs(projectRoot, [{ path: 'CLAUDE.md', content: STUB_BODY }]);
    const first = read('CLAUDE.md');

    const second = wireEntryStubs(projectRoot, [{ path: 'CLAUDE.md', content: STUB_BODY }]);
    expect(read('CLAUDE.md')).toBe(first);
    // The block is reconciled in place — never duplicated.
    expect(countOccurrences(read('CLAUDE.md'), BEGIN)).toBe(1);
    expect(second.wired).toEqual(['CLAUDE.md']);
  });

  it('leaves a missing entry file alone (the generateConfig path creates the bare stub)', () => {
    const result = wireEntryStubs(projectRoot, [{ path: 'CLAUDE.md', content: STUB_BODY }]);
    expect(result.wired).toEqual([]);
  });

  it('does not double-wire a bare paqad lean stub (already carries the pointer, no markers)', () => {
    // A fresh onboard wrote the bare lean stub (the pointer, no managed markers).
    writeFileSync(join(projectRoot, 'CLAUDE.md'), STUB_BODY);

    const result = wireEntryStubs(projectRoot, [{ path: 'CLAUDE.md', content: STUB_BODY }]);

    expect(result.wired).toEqual([]);
    expect(countOccurrences(read('CLAUDE.md'), BEGIN)).toBe(0);
    expect(read('CLAUDE.md')).toBe(STUB_BODY);
  });

  it('wires every provided provider entry file, not just Claude', () => {
    writeFileSync(join(projectRoot, 'CLAUDE.md'), '# Boost CLAUDE\n');
    writeFileSync(join(projectRoot, 'AGENTS.md'), '# Boost AGENTS\n');

    const result = wireEntryStubs(projectRoot, [
      { path: 'CLAUDE.md', content: STUB_BODY },
      { path: 'AGENTS.md', content: STUB_BODY },
    ]);

    expect(result.wired).toEqual(['CLAUDE.md', 'AGENTS.md']);
    expect(read('CLAUDE.md')).toContain(BEGIN);
    expect(read('AGENTS.md')).toContain(BEGIN);
    expect(read('AGENTS.md')).toContain('# Boost AGENTS');
  });
});
