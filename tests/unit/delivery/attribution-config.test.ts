import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FRAMEWORK_CONFIG_SPECS } from '@/core/framework-config.js';
import {
  DEFAULT_AI_ATTRIBUTION_MODE,
  resolveAiAttributionMode,
  shouldStripAiAttribution,
} from '@/delivery/attribution-config.js';

function makeProject(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-attr-cfg-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

describe('ai_attribution knob', () => {
  // AC-1
  it('defaults to strip on a bare project', () => {
    expect(resolveAiAttributionMode(makeProject(), {})).toBe('strip');
    expect(DEFAULT_AI_ATTRIBUTION_MODE).toBe('strip');
  });

  it('is registered in the policy group so it renders into configs/.config.policy', () => {
    const spec = FRAMEWORK_CONFIG_SPECS.find((entry) => entry.key === 'ai_attribution');
    expect(spec).toBeDefined();
    expect(spec?.group).toBe('policy');
    expect(spec?.type).toBe('enum');
    expect(spec?.default).toBe('strip');
    expect(spec?.env).toBe('PAQAD_AI_ATTRIBUTION');
    expect(spec?.enumValues).toEqual(['keep', 'strip']);
  });

  it('reads a team value from configs/.config.*', () => {
    const root = makeProject({ '.paqad/configs/.config.policy': 'ai_attribution=keep' });
    expect(resolveAiAttributionMode(root, {})).toBe('keep');
  });

  // AC-2 — the whole point of flooring it: an enterprise floor is not a suggestion.
  it('refuses to let a local file lower a team strip to keep', () => {
    const root = makeProject({
      '.paqad/configs/.config.policy': 'ai_attribution=strip',
      '.paqad/.config': 'ai_attribution=keep',
    });
    expect(resolveAiAttributionMode(root, {})).toBe('strip');
  });

  it('refuses to let the env var lower a team strip to keep', () => {
    const root = makeProject({ '.paqad/configs/.config.policy': 'ai_attribution=strip' });
    expect(resolveAiAttributionMode(root, { PAQAD_AI_ATTRIBUTION: 'keep' })).toBe('strip');
  });

  it('lets a local file RAISE a team keep to strip', () => {
    const root = makeProject({
      '.paqad/configs/.config.policy': 'ai_attribution=keep',
      '.paqad/.config': 'ai_attribution=strip',
    });
    expect(resolveAiAttributionMode(root, {})).toBe('strip');
  });

  it('ignores an unrecognised value rather than silently disabling the policy', () => {
    const root = makeProject({ '.paqad/configs/.config.policy': 'ai_attribution=sometimes' });
    expect(resolveAiAttributionMode(root, {})).toBe('strip');
  });

  it('exposes the posture as a boolean for the adapters', () => {
    expect(shouldStripAiAttribution(makeProject(), {})).toBe(true);
    const keep = makeProject({ '.paqad/configs/.config.policy': 'ai_attribution=keep' });
    expect(shouldStripAiAttribution(keep, {})).toBe(false);
  });
});
