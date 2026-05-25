import { ADAPTER_TYPES } from '@/core/types/adapter.js';
import {
  DECISION_PAUSE_UI_FALLBACK,
  DECISION_PAUSE_UI_NOTES,
  decisionPauseUiNote,
} from '@/adapters/shared/decision-pause-ui-shim.js';

describe('decision-pause-ui-shim', () => {
  it('exposes a one-sentence note for every supported adapter', () => {
    for (const adapter of ADAPTER_TYPES) {
      const note = DECISION_PAUSE_UI_NOTES[adapter];
      expect(note).toBeDefined();
      expect(note.length).toBeGreaterThan(0);
      // Notes are intentionally short; entry files are session preludes.
      expect(note.length).toBeLessThan(200);
    }
  });

  it('returns the per-adapter note when the adapter is known', () => {
    expect(decisionPauseUiNote('claude-code')).toContain('AskUserQuestion');
    expect(decisionPauseUiNote('aider')).toContain('/ask');
  });

  it('falls back to the generic file-wait note for unknown adapters', () => {
    expect(decisionPauseUiNote('made-up-adapter' as never)).toBe(DECISION_PAUSE_UI_FALLBACK);
  });
});
