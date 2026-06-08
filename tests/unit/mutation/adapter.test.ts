import { describe, expect, it } from 'vitest';

import type { DetectedStackProfile } from '@/core/types/introspection.js';
import { mutationConfidenceFor, selectMutationTool } from '@/mutation/adapter.js';

function stack(overrides: Partial<DetectedStackProfile> = {}): DetectedStackProfile {
  return {
    frameworks: [],
    traits: [],
    toolchains: [],
    version_bands: [],
    sources: [],
    ...overrides,
  };
}

describe('selectMutationTool', () => {
  it('selects Stryker for a TypeScript/Node stack (mature)', () => {
    const descriptor = selectMutationTool(
      stack({ traits: ['typescript'], frameworks: ['node-cli'] }),
    );
    expect(descriptor.tool).toBe('stryker');
    expect(descriptor.confidence).toBe('mature');
    expect(descriptor.languages).toContain('typescript');
    expect(descriptor.run_command).toContain('stryker');
  });

  it('selects the mature tool per mainstream language', () => {
    expect(selectMutationTool(stack({ traits: ['java'] })).tool).toBe('pit');
    expect(selectMutationTool(stack({ traits: ['python'] })).tool).toBe('mutmut');
    expect(selectMutationTool(stack({ traits: ['php'] })).tool).toBe('infection');
    expect(selectMutationTool(stack({ traits: ['ruby'] })).tool).toBe('mutant');
    expect(selectMutationTool(stack({ traits: ['rust'] })).tool).toBe('cargo-mutants');
    expect(selectMutationTool(stack({ traits: ['dotnet'] })).tool).toBe('stryker-net');
  });

  it('matches case-insensitively and via frameworks', () => {
    const descriptor = selectMutationTool(stack({ frameworks: ['React'] }));
    expect(descriptor.tool).toBe('stryker');
  });

  it('falls back to lower-confidence generic for a weak-tooled language', () => {
    const descriptor = selectMutationTool(stack({ traits: ['elixir'] }));
    expect(descriptor.tool).toBe('generic');
    expect(descriptor.confidence).toBe('lower');
    expect(descriptor.languages).toEqual(['elixir']);
  });

  it('falls back to lower-confidence generic when the stack is unknown/empty', () => {
    expect(selectMutationTool(null).confidence).toBe('lower');
    expect(selectMutationTool(stack()).tool).toBe('generic');
  });
});

describe('mutationConfidenceFor', () => {
  it('reports mature for a supported stack and lower otherwise', () => {
    expect(mutationConfidenceFor(stack({ traits: ['typescript'] }))).toBe('mature');
    expect(mutationConfidenceFor(stack({ traits: ['haskell'] }))).toBe('lower');
    expect(mutationConfidenceFor(null)).toBe('lower');
  });
});
