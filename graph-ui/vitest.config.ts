import { defineConfig } from 'vitest/config';

// graph-ui is build-gated, not coverage-gated (issue #489 gotcha 9): the React canvas verifies by
// `vite build` + the AC checklist. The one exception is the pure, deterministic layout heart —
// site-map-district-layout.ts — which is unit-tested to 100%, because a silent reflow there would
// break spatial memory (LAY-2) with nothing to catch it. Coverage is scoped to exactly that file.
export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['src/lib/site-map-district-layout.ts'],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});
