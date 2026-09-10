import { describe, expect, it } from 'vitest';

import {
  AI_ATTRIBUTION_MARKERS,
  detectAiAttribution,
  hasAiAttribution,
} from '@/delivery/ai-attribution.js';

/** The real thing each vendor writes, as it appears in a commit message or PR body. */
const REAL_WORLD = {
  'claude-code': [
    'Co-Authored-By: Claude <noreply@anthropic.com>',
    '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
  ],
  'codex-cli': ['Co-authored-by: Codex <noreply@openai.com>'],
  cursor: ['Co-authored-by: Cursor <cursoragent@cursor.com>', 'Made-with: Cursor'],
  aider: ['Co-authored-by: aider (gpt-4o) <noreply@aider.chat>'],
  'github-copilot': [
    'Co-authored-by: copilot-swe-agent <198982749+Copilot@users.noreply.github.com>',
  ],
  'gemini-cli': ['Co-authored-by: Gemini <noreply@google.com>'],
} as const;

describe('detectAiAttribution', () => {
  // AC-7
  for (const [id, samples] of Object.entries(REAL_WORLD)) {
    for (const sample of samples) {
      it(`detects ${id} in ${JSON.stringify(sample)}`, () => {
        const matches = detectAiAttribution(`fix: something\n\n${sample}\n`);
        expect(matches.map((match) => match.marker.id)).toContain(id);
      });
    }
  }

  // AC-8 / INV-2 — the one match this table must never make.
  it("never matches paqad's own delivery footer", () => {
    const prBody = [
      '## Summary',
      '',
      'Re-home the checks report into the per-feature bundle.',
      '',
      '🤖 Generated with paqad-ai delivery',
    ].join('\n');
    expect(detectAiAttribution(prBody)).toEqual([]);
    expect(hasAiAttribution(prBody)).toBe(false);
  });

  it('leaves a human co-author trailer alone', () => {
    const message = 'feat: add thing\n\nCo-authored-by: Jane Rivera <jane@example.com>\n';
    expect(detectAiAttribution(message)).toEqual([]);
  });

  it('returns nothing for a clean commit message', () => {
    expect(detectAiAttribution('fix(#1): tidy the loader')).toEqual([]);
  });

  it('returns nothing for empty text', () => {
    expect(detectAiAttribution('')).toEqual([]);
  });

  it('reports each vendor at most once even when the marker repeats', () => {
    const message = [
      'Co-Authored-By: Claude <noreply@anthropic.com>',
      'Co-Authored-By: Claude <noreply@anthropic.com>',
    ].join('\n');
    expect(detectAiAttribution(message)).toHaveLength(1);
  });

  it('reports every distinct vendor when a message carries more than one', () => {
    const message = [
      'chore: squashed',
      '',
      'Co-Authored-By: Claude <noreply@anthropic.com>',
      'Co-authored-by: Cursor <cursoragent@cursor.com>',
    ].join('\n');
    expect(
      detectAiAttribution(message)
        .map((match) => match.marker.id)
        .sort(),
    ).toEqual(['claude-code', 'cursor']);
  });

  it('carries the literal matched text so the warning can quote it', () => {
    const [match] = detectAiAttribution('Co-Authored-By: Claude <noreply@anthropic.com>');
    expect(match.matched.toLowerCase()).toContain('claude');
  });
});

describe('AI_ATTRIBUTION_MARKERS', () => {
  it('gives every marker a unique id, a vendor name and a remediation', () => {
    const ids = AI_ATTRIBUTION_MARKERS.map((marker) => marker.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const marker of AI_ATTRIBUTION_MARKERS) {
      expect(marker.vendor.length).toBeGreaterThan(0);
      expect(marker.remediation.length).toBeGreaterThan(0);
    }
  });

  it('marks exactly the two vendors paqad can configure at project level', () => {
    const configured = AI_ATTRIBUTION_MARKERS.filter((marker) => marker.configuredByPaqad).map(
      (marker) => marker.id,
    );
    expect(configured.sort()).toEqual(['aider', 'claude-code']);
  });

  it('points the user-level vendors at their own config file, not at paqad (INV-1)', () => {
    for (const marker of AI_ATTRIBUTION_MARKERS.filter((entry) => !entry.configuredByPaqad)) {
      expect(marker.remediation).not.toMatch(/paqad writes/i);
    }
  });

  it('uses non-global patterns so repeated calls are not stateful', () => {
    for (const marker of AI_ATTRIBUTION_MARKERS) {
      expect(marker.pattern.global).toBe(false);
    }
    const text = 'Co-Authored-By: Claude <noreply@anthropic.com>';
    expect(detectAiAttribution(text)).toHaveLength(1);
    expect(detectAiAttribution(text)).toHaveLength(1);
  });
});
