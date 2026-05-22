import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REQUIRED_TOOL_REFERENCES = [
  'runtime/capabilities/coding/stacks/laravel/references/tools-catalog.md',
  'runtime/capabilities/coding/stacks/laravel/references/tools/artisan.md',
  'runtime/capabilities/coding/stacks/laravel/references/tools/boost.md',
  'runtime/capabilities/coding/stacks/laravel/references/tools/code-quality.md',
  'runtime/capabilities/coding/stacks/laravel/references/tools/sail.md',
  'runtime/capabilities/coding/stacks/laravel/references/tools/security-review-checklist.md',
  'runtime/capabilities/coding/stacks/laravel/references/tools/testing.md',
  'runtime/capabilities/coding/stacks/flutter/references/tools-catalog.md',
  'runtime/capabilities/coding/stacks/flutter/references/tools/easy-localization.md',
  'runtime/capabilities/coding/stacks/flutter/references/tools/environment-loading.md',
  'runtime/capabilities/coding/stacks/flutter/references/tools/flutter-quality-gate.md',
  'runtime/capabilities/coding/stacks/flutter/references/tools/security-review-checklist.md',
  'runtime/capabilities/coding/stacks/react/references/tools-catalog.md',
  'runtime/capabilities/coding/stacks/react/references/tools/code-quality.md',
  'runtime/capabilities/coding/stacks/react/references/tools/playwright.md',
  'runtime/capabilities/coding/stacks/react/references/tools/security-review-checklist.md',
  'runtime/capabilities/coding/stacks/react/references/tools/testing.md',
  'runtime/capabilities/coding/stacks/vue/references/tools-catalog.md',
  'runtime/capabilities/coding/stacks/vue/references/tools/code-quality.md',
  'runtime/capabilities/coding/stacks/vue/references/tools/playwright.md',
  'runtime/capabilities/coding/stacks/vue/references/tools/security-review-checklist.md',
  'runtime/capabilities/coding/stacks/vue/references/tools/testing.md',
] as const;

describe('runtime tool references', () => {
  it('required stack tool references exist and have markdown headings', () => {
    for (const relativePath of REQUIRED_TOOL_REFERENCES) {
      const path = join(process.cwd(), relativePath);
      expect(existsSync(path), relativePath).toBe(true);
      expect(readFileSync(path, 'utf8')).toMatch(/^# /m);
    }
  });
});
