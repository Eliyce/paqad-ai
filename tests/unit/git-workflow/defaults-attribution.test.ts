import { describe, expect, it } from 'vitest';

import {
  AI_ATTRIBUTION_COMMENT_LINES,
  removeAiAttributionComment,
} from '@/git-workflow/defaults.js';

const [NOTE, LINE] = AI_ATTRIBUTION_COMMENT_LINES;

describe('removing the commented attribution block', () => {
  it.each([
    ['LF after a blank line', `a: 1\n\n${NOTE}\n${LINE}\n`, 'a: 1\n'],
    ['CRLF', `a: 1\r\n\r\n${NOTE}\r\n${LINE}\r\n`, 'a: 1\r\n'],
    ['mixed ends', `a: 1\n\r\n${NOTE}\r\n${LINE}\n`, 'a: 1\n'],
    ['no blank line before it', `a: 1\n${NOTE}\n${LINE}\nb: 2\n`, 'a: 1\nb: 2\n'],
    ['no final newline', `a: 1\n\n${NOTE}\n${LINE}`, 'a: 1\n'],
    ['first in the file', `${NOTE}\n${LINE}\nb: 2\n`, 'b: 2\n'],
  ])('removes it with %s', (_name, before, after) => {
    expect(removeAiAttributionComment(before)).toBe(after);
  });

  it('leaves a line that only looks similar', () => {
    const text = `# ai_attribution: keep\n${LINE}\n`;
    expect(removeAiAttributionComment(text)).toBe(text);
  });
});
