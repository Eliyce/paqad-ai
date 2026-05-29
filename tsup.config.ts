import { readFileSync } from 'node:fs';

import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'cli/index': 'src/cli/index.ts',
    // Subpath export consumed by the rules-as-scripts skill .mjs wrappers
    // (issue #89) via `import 'paqad-ai/rule-scripts'` self-reference.
    'rule-scripts/index': 'src/rule-scripts/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node22',
  splitting: false,
  shims: true,
  external: ['@xenova/transformers', 'openai', 'voyageai'],
  outDir: 'dist',
  // Inject package version at build time so VERSION never drifts from
  // package.json. Vitest has its own define block in vitest.config.ts.
  define: {
    __PKG_VERSION__: JSON.stringify(pkg.version),
  },
});
