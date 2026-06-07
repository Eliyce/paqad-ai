// Per-language mutation-tool adapter. Issue #105.
//
// Maps a project's detected stack to its *mature* mutation tool — Stryker for
// JS/TS, PIT for the JVM, mutmut for Python, Infection for PHP, mutant for
// Ruby, cargo-mutants for Rust. We do not write a home-grown mutator (Settled
// decision); we delegate to the established tool per language.
//
// Mainstream languages have mature tooling; long-tail languages (Elixir,
// Haskell, OCaml, Kotlin, …) have weak or abandoned tooling, so for those we
// still produce a result but mark it `lower` confidence so nobody over-trusts
// it.

import type { DetectedStackProfile } from '@/core/types/introspection.js';
import type { MutationConfidence, MutationToolDescriptor } from '@/core/types/mutation.js';

interface ToolDefinition {
  descriptor: MutationToolDescriptor;
  // Lower-cased trait / framework tokens that select this tool.
  match: string[];
}

// Mature, actively-maintained tools keyed by the language tokens that select
// them. Order matters only for disambiguation: the first match wins.
const MATURE_TOOLS: ToolDefinition[] = [
  {
    descriptor: {
      tool: 'stryker',
      languages: ['typescript', 'javascript'],
      confidence: 'mature',
      run_command: 'npx stryker run',
      config_markers: [
        'stryker.conf.json',
        'stryker.conf.js',
        'stryker.conf.mjs',
        'stryker.conf.cjs',
        '.stryker.conf.json',
      ],
    },
    match: [
      'typescript',
      'javascript',
      'ts',
      'js',
      'node',
      'node-cli',
      'react',
      'next',
      'nextjs',
      'vue',
      'svelte',
      'angular',
      'vite',
      'vite-spa',
    ],
  },
  {
    descriptor: {
      tool: 'stryker-net',
      languages: ['csharp'],
      confidence: 'mature',
      run_command: 'dotnet stryker',
      config_markers: ['stryker-config.json', 'stryker-config.yaml'],
    },
    match: ['csharp', 'dotnet', '.net', 'c#'],
  },
  {
    descriptor: {
      tool: 'pit',
      languages: ['java'],
      confidence: 'mature',
      run_command: 'mvn org.pitest:pitest-maven:mutationCoverage',
      config_markers: ['pitest.xml'],
    },
    match: ['java', 'jvm', 'maven', 'gradle', 'spring'],
  },
  {
    descriptor: {
      tool: 'mutmut',
      languages: ['python'],
      confidence: 'mature',
      run_command: 'mutmut run',
      config_markers: ['setup.cfg', 'mutmut_config.py', 'pyproject.toml'],
    },
    match: ['python', 'py', 'django', 'flask', 'fastapi'],
  },
  {
    descriptor: {
      tool: 'infection',
      languages: ['php'],
      confidence: 'mature',
      run_command: 'vendor/bin/infection',
      config_markers: ['infection.json', 'infection.json5', 'infection.json.dist'],
    },
    match: ['php', 'laravel', 'symfony'],
  },
  {
    descriptor: {
      tool: 'mutant',
      languages: ['ruby'],
      confidence: 'mature',
      run_command: 'bundle exec mutant run',
      config_markers: ['.mutant.yml', 'config/mutant.yml'],
    },
    match: ['ruby', 'rails'],
  },
  {
    descriptor: {
      tool: 'cargo-mutants',
      languages: ['rust'],
      confidence: 'mature',
      run_command: 'cargo mutants',
      config_markers: ['.cargo/mutants.toml', 'mutants.toml'],
    },
    match: ['rust', 'cargo'],
  },
];

// The lower-confidence fallback for stacks with no mature tool. We still run
// the best available generic approach, but flag it so the score is treated as
// indicative rather than authoritative.
const FALLBACK_TOOL: MutationToolDescriptor = {
  tool: 'generic',
  languages: [],
  confidence: 'lower',
  run_command: '',
  config_markers: [],
};

function normalizeTokens(stack: DetectedStackProfile | null): string[] {
  if (stack === null) {
    return [];
  }
  const tokens = [...stack.frameworks, ...stack.traits].map((token) => token.trim().toLowerCase());
  return [...new Set(tokens.filter((token) => token.length > 0))];
}

/**
 * Select the mature per-language mutation tool for a detected stack. Returns a
 * lower-confidence generic descriptor when no mature tool covers the stack (or
 * the stack is unknown), so a result can still be produced and clearly marked.
 */
export function selectMutationTool(stack: DetectedStackProfile | null): MutationToolDescriptor {
  const tokens = normalizeTokens(stack);
  if (tokens.length === 0) {
    return { ...FALLBACK_TOOL };
  }

  for (const tool of MATURE_TOOLS) {
    if (tool.match.some((token) => tokens.includes(token))) {
      return { ...tool.descriptor };
    }
  }

  // A known-but-weak-tooled language: record the primary language token for
  // context but keep the lower-confidence generic descriptor.
  return { ...FALLBACK_TOOL, languages: [tokens[0] as string] };
}

/**
 * The confidence the adapter assigns to a stack without running anything.
 * Exposed so callers can pre-flight the "lower-confidence" path.
 */
export function mutationConfidenceFor(stack: DetectedStackProfile | null): MutationConfidence {
  return selectMutationTool(stack).confidence;
}
