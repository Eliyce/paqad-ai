import { readFileSync } from 'node:fs';

import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'cli/index': 'src/cli/index.ts',
    'rule-scripts/index': 'src/rule-scripts/index.ts',
    'kernel/gate': 'src/kernel/gate.ts',
    'stage-evidence/live-writer': 'src/stage-evidence/live-writer.ts',
    'stage-evidence/narration': 'src/stage-evidence/narration.ts',
    'stage-evidence/marker-parse': 'src/stage-evidence/marker-parse.ts',
    'rag-ledger/session': 'src/rag-ledger/session.ts',
    'feature-evidence/adoption': 'src/feature-evidence/adoption.ts',
    'session-ledger/disabled-audit': 'src/session-ledger/disabled-audit.ts',
    'context/tokenizer-cache': 'src/context/tokenizer-cache.ts',
    'session-ledger/project-ledger': 'src/session-ledger/project-ledger.ts',
    'pipeline/prompt-lane': 'src/pipeline/prompt-lane.ts',
    'pipeline/dirty-baseline': 'src/pipeline/dirty-baseline.ts',
    'planning/ticket-ref-detect': 'src/planning/ticket-ref-detect.ts',
    'delivery/commit-split': 'src/delivery/commit-split.ts',
    'stage-isolation/subagent-completion': 'src/stage-isolation/subagent-completion.ts',
    'stage-evidence/completion-deferred': 'src/stage-evidence/completion-deferred.ts',
    'hud/refresh': 'src/hud/refresh.ts',
    'cost/hook-cost': 'src/cost/hook-cost.ts',
    'plugin/manifest-build': 'src/plugin/manifest-build.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node22',
  splitting: false,
  shims: true,
  banner: {
    js: "import { createRequire as __paqadCreateRequire } from 'module'; const require = __paqadCreateRequire(import.meta.url);",
  },
  external: ['@huggingface/transformers', 'openai', 'voyageai'],
  noExternal: [
    'ajv',
    'execa',
    'fast-glob',
    'pathe',
    'yaml',
    'handlebars',
    'chalk',
    '@inquirer/prompts',
    'commander',
    'ora',
    'gifenc',
  ],
  outDir: 'dist',
  define: {
    __PKG_VERSION__: JSON.stringify(pkg.version),
  },
});
