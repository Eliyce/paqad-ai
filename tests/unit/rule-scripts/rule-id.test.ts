import { describe, expect, it } from 'vitest';

import {
  embedRuleMarker,
  parseRuleMarker,
  parseRuleMarkerRun,
  stripRuleMarker,
} from '@/rule-scripts/rule-id.js';

describe('rule markers', () => {
  it('AC-49 reads the RL id from a marker that names its discovery run', () => {
    const line = '- Use zod. <!-- @rule RL-1a2b discovered:rd-20261101-100000 -->';
    expect(parseRuleMarker(line)).toBe('RL-1a2b');
    expect(parseRuleMarkerRun(line)).toBe('rd-20261101-100000');
    expect(stripRuleMarker(line)).toEqual({ text: '- Use zod.', id: 'RL-1a2b' });
  });

  it('keeps plain markers working and writes the run only when asked', () => {
    expect(parseRuleMarkerRun('- A. <!-- @rule RL-1a2b -->')).toBeNull();
    expect(embedRuleMarker('- A.', 'RL-1a2b')).toBe('- A. <!-- @rule RL-1a2b -->');
    expect(embedRuleMarker('- A. <!-- @rule RL-1a2b -->', 'RL-1a2b', 'rd-20261101-100000')).toBe(
      '- A. <!-- @rule RL-1a2b discovered:rd-20261101-100000 -->',
    );
    const discovered = '- A. <!-- @rule RL-1a2b discovered:rd-20261101-100000 -->';
    expect(embedRuleMarker(discovered, 'RL-1a2b')).toBe(discovered);
  });
});
