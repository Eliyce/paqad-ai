import type { DetectedStackProfile } from '@/core/types/introspection.js';
import type { MutationConfidence, MutationToolDescriptor } from '@/core/types/mutation.js';

interface ToolDefinition {
  descriptor: MutationToolDescriptor;
  match: string[];
}

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

  return { ...FALLBACK_TOOL, languages: [tokens[0] as string] };
}

export function mutationConfidenceFor(stack: DetectedStackProfile | null): MutationConfidence {
  return selectMutationTool(stack).confidence;
}
