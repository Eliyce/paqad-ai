import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REQUIRED_RULES = [
  'runtime/base/rules/constitution.md',
  'runtime/base/rules/security.md',
  'runtime/base/rules/design-system.md',
  'runtime/base/rules/testing.md',
  'runtime/capabilities/security/rules/pentest.md',
  'runtime/base/rules/documentation.md',
  'runtime/base/rules/observability.md',
  'runtime/base/rules/performance.md',
  'runtime/base/rules/pipeline.md',
  'runtime/base/rules/canonical-docs.md',
  'runtime/capabilities/content/rules/writing.md',
  'runtime/capabilities/content/rules/markdown.md',
  'runtime/capabilities/content/rules/attribution.md',
  'runtime/capabilities/content/rules/code-snippets.md',
  'runtime/capabilities/coding/rules/architecture.md',
  'runtime/capabilities/coding/rules/code-quality.md',
  'runtime/capabilities/coding/rules/code-review.md',
  'runtime/capabilities/coding/stacks/_shared/rules/git.md',
  'runtime/capabilities/coding/stacks/_shared/rules/api-design.md',
  'runtime/capabilities/coding/stacks/_shared/rules/environment.md',
  'runtime/capabilities/coding/stacks/_shared/rules/ci-cd.md',
  'runtime/capabilities/coding/stacks/laravel/rules/foundation/guide.md',
  'runtime/capabilities/coding/stacks/laravel/rules/api.md',
  'runtime/capabilities/coding/stacks/laravel/rules/laravel.md',
  'runtime/capabilities/coding/stacks/laravel/capabilities/react/rules/react.md',
  'runtime/capabilities/coding/stacks/laravel/capabilities/vue/rules/vue.md',
  'runtime/capabilities/coding/stacks/laravel/capabilities/inertia/rules/inertia.md',
  'runtime/capabilities/coding/stacks/laravel/capabilities/tailwind/rules/tailwind.md',
  'runtime/capabilities/coding/stacks/laravel/capabilities/boost/rules/boost.md',
  'runtime/capabilities/coding/stacks/flutter/rules/foundation/guide.md',
  'runtime/capabilities/coding/stacks/flutter/rules/architecture.md',
  'runtime/capabilities/coding/stacks/flutter/rules/theming.md',
  'runtime/capabilities/coding/stacks/react/rules/foundation/guide.md',
  'runtime/capabilities/coding/stacks/react/rules/architecture.md',
  'runtime/capabilities/coding/stacks/react/rules/testing/guide.md',
  'runtime/capabilities/coding/stacks/react/capabilities/next/rules/next.md',
  'runtime/capabilities/coding/stacks/react/capabilities/remix/rules/remix.md',
  'runtime/capabilities/coding/stacks/react/capabilities/vite-spa/rules/vite-spa.md',
  'runtime/capabilities/coding/stacks/react/capabilities/gatsby/rules/gatsby.md',
  'runtime/capabilities/coding/stacks/vue/rules/foundation/guide.md',
  'runtime/capabilities/coding/stacks/vue/rules/architecture.md',
  'runtime/capabilities/coding/stacks/vue/rules/testing/guide.md',
  'runtime/capabilities/coding/stacks/vue/capabilities/nuxt/rules/nuxt.md',
  'runtime/capabilities/coding/stacks/vue/capabilities/vite-spa/rules/vite-spa.md',
  'runtime/capabilities/coding/stacks/vue/capabilities/quasar/rules/quasar.md',
] as const;

describe('runtime rules', () => {
  it('all required rules exist and have markdown headings', () => {
    for (const relativePath of REQUIRED_RULES) {
      const path = join(process.cwd(), relativePath);
      expect(existsSync(path), relativePath).toBe(true);
      expect(readFileSync(path, 'utf8')).toMatch(/^# /m);
    }
  });
});
