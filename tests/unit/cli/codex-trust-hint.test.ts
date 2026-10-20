import { describe, expect, it } from 'vitest';

import { codexTrustHint } from '@/cli/ui/banner.js';

describe('codexTrustHint', () => {
  it('names the /hooks trust step when Codex was onboarded', () => {
    const hint = codexTrustHint(['claude-code', 'codex-cli']);
    expect(hint).toContain('/hooks');
    expect(hint).toContain('.codex/');
  });

  it('returns null when Codex was not onboarded', () => {
    expect(codexTrustHint(['claude-code'])).toBeNull();
    expect(codexTrustHint(undefined)).toBeNull();
    expect(codexTrustHint([])).toBeNull();
  });
});
