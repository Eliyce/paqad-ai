import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DUPLICATION_MODE,
  DEFAULT_MIN_LINES,
  DEFAULT_SIMILARITY_THRESHOLD,
  resolveDuplicationConfig,
  resolveDuplicationMode,
} from '@/duplication/config.js';

import { makeGitProject } from './helpers.js';

function writePolicy(root: string, lines: string): void {
  mkdirSync(join(root, '.paqad/configs'), { recursive: true });
  writeFileSync(join(root, '.paqad/configs/.config.policy'), lines);
}

describe('resolveDuplicationConfig', () => {
  it('returns the documented defaults with nothing set', () => {
    const root = makeGitProject();
    expect(resolveDuplicationConfig(root, {})).toEqual({
      mode: DEFAULT_DUPLICATION_MODE,
      similarityThreshold: DEFAULT_SIMILARITY_THRESHOLD,
      minLines: DEFAULT_MIN_LINES,
    });
  });

  it('reads team-set values', () => {
    const root = makeGitProject();
    writePolicy(
      root,
      'duplication_mode=strict\nduplication_similarity_threshold=0.95\nduplication_min_lines=12\n',
    );
    expect(resolveDuplicationConfig(root, {})).toEqual({
      mode: 'strict',
      similarityThreshold: 0.95,
      minLines: 12,
    });
  });

  it('falls back to the default on an out-of-range threshold', () => {
    const root = makeGitProject();
    writePolicy(root, 'duplication_similarity_threshold=1.7\n');
    expect(resolveDuplicationConfig(root, {}).similarityThreshold).toBe(
      DEFAULT_SIMILARITY_THRESHOLD,
    );
  });

  it('falls back to the default on a non-integer min-lines', () => {
    const root = makeGitProject();
    writePolicy(root, 'duplication_min_lines=3.5\n');
    expect(resolveDuplicationConfig(root, {}).minLines).toBe(DEFAULT_MIN_LINES);
  });

  it('falls back on a non-numeric value', () => {
    const root = makeGitProject();
    writePolicy(root, 'duplication_min_lines=lots\n');
    expect(resolveDuplicationConfig(root, {}).minLines).toBe(DEFAULT_MIN_LINES);
  });
});

describe('resolveDuplicationMode', () => {
  it('lets an env value RAISE above the team floor', () => {
    const root = makeGitProject();
    writePolicy(root, 'duplication_mode=warn\n');
    expect(resolveDuplicationMode(root, { PAQAD_DUPLICATION_MODE: 'strict' })).toBe('strict');
  });

  it('clamps an env value that would LOWER the floor', () => {
    const root = makeGitProject();
    writePolicy(root, 'duplication_mode=strict\n');
    expect(resolveDuplicationMode(root, { PAQAD_DUPLICATION_MODE: 'off' })).toBe('strict');
  });
});
