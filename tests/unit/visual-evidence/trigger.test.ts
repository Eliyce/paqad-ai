import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/pipeline/change-evidence.js', () => ({
  loadChangeEvidence: vi.fn(),
}));
vi.mock('@/packs/project-packs.js', () => ({
  getPacksForFrameworks: vi.fn(),
}));
vi.mock('@/core/project-profile.js', () => ({
  readProjectProfile: vi.fn(),
}));
vi.mock('@/core/stack-profile.js', () => ({
  getPrimaryStack: vi.fn(() => 'react'),
}));

import { loadChangeEvidence } from '@/pipeline/change-evidence.js';
import { getPacksForFrameworks } from '@/packs/project-packs.js';
import { readProjectProfile } from '@/core/project-profile.js';
import {
  activeFrontendGlobs,
  evaluateFrontendTrigger,
  frontendGlobToRegExp,
  matchesFrontendGlob,
} from '@/visual-evidence/trigger.js';

const loadChange = vi.mocked(loadChangeEvidence);
const getPacks = vi.mocked(getPacksForFrameworks);
const readProfile = vi.mocked(readProjectProfile);

function pack(
  name: string,
  globs: string[],
): { manifest: { name: string; visual_evidence?: { frontend_globs?: string[] } } } {
  return { manifest: { name, visual_evidence: { frontend_globs: globs } } };
}

beforeEach(() => {
  vi.clearAllMocks();
  readProfile.mockReturnValue({ stack_profile: { frameworks: ['react'] } } as never);
  getPacks.mockImplementation(
    (frameworks) =>
      (frameworks.includes('react')
        ? [pack('react', ['src/**/*.{jsx,tsx}', 'src/**/*.css'])]
        : []) as never,
  );
});

describe('frontendGlobToRegExp / matchesFrontendGlob', () => {
  it('handles brace expansion', () => {
    expect(matchesFrontendGlob('src/a/b.tsx', 'src/**/*.{jsx,tsx}')).toBe(true);
    expect(matchesFrontendGlob('src/a/b.jsx', 'src/**/*.{jsx,tsx}')).toBe(true);
    expect(matchesFrontendGlob('src/a/b.ts', 'src/**/*.{jsx,tsx}')).toBe(false);
  });

  it('handles ** across path segments and * within a segment', () => {
    expect(matchesFrontendGlob('src/x/y/z.css', 'src/**/*.css')).toBe(true);
    expect(matchesFrontendGlob('src/z.css', 'src/**/*.css')).toBe(true);
    expect(matchesFrontendGlob('lib/z.css', 'src/**/*.css')).toBe(false);
    // a single * does not cross a slash
    expect(matchesFrontendGlob('src/a/b.vue', 'src/*.vue')).toBe(false);
    expect(matchesFrontendGlob('src/b.vue', 'src/*.vue')).toBe(true);
  });

  it('escapes literal dots and matches ? as one non-slash char', () => {
    expect(matchesFrontendGlob('a.b', 'a.b')).toBe(true);
    expect(matchesFrontendGlob('axb', 'a.b')).toBe(false);
    expect(matchesFrontendGlob('ab', 'a?b')).toBe(false);
    expect(matchesFrontendGlob('a1b', 'a?b')).toBe(true);
  });

  it('matches leading-** globs like **/*.module.css', () => {
    expect(matchesFrontendGlob('app/x/y.module.css', '**/*.module.css')).toBe(true);
    expect(matchesFrontendGlob('y.module.css', '**/*.module.css')).toBe(true);
  });

  it('treats a stray unmatched brace/comma as a literal', () => {
    expect(matchesFrontendGlob('a}b', 'a}b')).toBe(true);
    expect(matchesFrontendGlob('a,b', 'a,b')).toBe(true);
  });

  it('is anchored (no partial match)', () => {
    const re = frontendGlobToRegExp('src/a.tsx');
    expect(re.test('x/src/a.tsx')).toBe(false);
    expect(re.test('src/a.tsx')).toBe(true);
  });
});

describe('activeFrontendGlobs', () => {
  it('flattens the active packs frontend globs', () => {
    expect(activeFrontendGlobs('/root')).toEqual([
      { pack: 'react', glob: 'src/**/*.{jsx,tsx}' },
      { pack: 'react', glob: 'src/**/*.css' },
    ]);
  });

  it('returns [] when there is no profile', () => {
    readProfile.mockReturnValue(null);
    expect(activeFrontendGlobs('/root')).toEqual([]);
  });

  it('skips packs with no visual_evidence block', () => {
    getPacks.mockReturnValue([{ manifest: { name: 'node-cli' } }] as never);
    expect(activeFrontendGlobs('/root')).toEqual([]);
  });
});

describe('evaluateFrontendTrigger', () => {
  it('is not triggered when the change source is none', async () => {
    loadChange.mockResolvedValue({ files: [], source: 'none' });
    const result = await evaluateFrontendTrigger('/root');
    expect(result.triggered).toBe(false);
    expect(result.matched_files).toEqual([]);
    expect(result.source).toBe('none');
  });

  it('triggers when a changed file matches a frontend glob and reports what matched', async () => {
    loadChange.mockResolvedValue({
      files: ['src/pages/Goals.tsx', 'README.md'],
      source: 'git-status',
    });
    const result = await evaluateFrontendTrigger('/root');
    expect(result.triggered).toBe(true);
    expect(result.matched_files).toEqual(['src/pages/Goals.tsx']);
    expect(result.matched_globs).toEqual(['src/**/*.{jsx,tsx}']);
    expect(result.packs).toEqual(['react']);
  });

  it('does not trigger for a non-frontend change', async () => {
    loadChange.mockResolvedValue({ files: ['src/server/api.ts'], source: 'git-status' });
    const result = await evaluateFrontendTrigger('/root');
    expect(result.triggered).toBe(false);
    expect(result.matched_files).toEqual([]);
  });

  it('normalizes windows separators to posix before matching', async () => {
    loadChange.mockResolvedValue({ files: ['src\\pages\\Goals.tsx'], source: 'git-status' });
    const result = await evaluateFrontendTrigger('/root');
    expect(result.triggered).toBe(true);
    expect(result.matched_files).toEqual(['src/pages/Goals.tsx']);
  });
});
