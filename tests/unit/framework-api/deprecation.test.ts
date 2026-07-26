import { describe, expect, it } from 'vitest';

import { readDeprecation, type JsDocTagLike } from '@/framework-api/deprecation.js';

function tag(name: string, ...parts: { text: string; kind?: string }[]): JsDocTagLike {
  return { name, text: parts };
}

describe('readDeprecation', () => {
  it('reports no deprecation when the tag set carries none', () => {
    expect(readDeprecation([tag('param', { text: 'value' })])).toEqual({
      deprecated: false,
      message: null,
      since: null,
      for_removal: false,
    });
  });

  it('reads the deprecation message and terminates it so an appended sentence reads', () => {
    const verdict = readDeprecation([tag('deprecated', { text: 'use the new helper' })]);
    expect(verdict.deprecated).toBe(true);
    expect(verdict.message).toBe('use the new helper.');
  });

  it('keeps existing terminal punctuation rather than doubling it', () => {
    expect(readDeprecation([tag('deprecated', { text: 'gone!' })]).message).toBe('gone!');
  });

  it('records a deprecation with no text at all as message null', () => {
    expect(readDeprecation([{ name: 'deprecated' }]).message).toBeNull();
  });

  it('renders a {@link Target label} reference as its label, not as concatenated parts', () => {
    // The real @types/react shape: joining parts naively yields the mangled
    // "componentDidMountcomponentDidMount" this rendering exists to prevent.
    const verdict = readDeprecation([
      tag(
        'deprecated',
        { text: '16.3, use ', kind: 'text' },
        { text: '{@link ', kind: 'link' },
        { text: 'ComponentLifecycle.componentDidMount', kind: 'linkName' },
        { text: 'componentDidMount', kind: 'linkText' },
        { text: '}', kind: 'link' },
        { text: ' instead', kind: 'text' },
      ),
    ]);
    expect(verdict.message).toBe('16.3, use componentDidMount instead.');
  });

  it('falls back to a link target when the reference carries no label', () => {
    const verdict = readDeprecation([
      tag(
        'deprecated',
        { text: 'use ', kind: 'text' },
        { text: '{@link ', kind: 'link' },
        { text: 'Ref', kind: 'linkName' },
        { text: '}', kind: 'link' },
      ),
    ]);
    expect(verdict.message).toBe('use Ref.');
  });

  it('ignores an empty link label and uses the target', () => {
    const verdict = readDeprecation([
      tag(
        'deprecated',
        { text: '{@link ', kind: 'link' },
        { text: 'Ref', kind: 'linkName' },
        { text: '   ', kind: 'linkText' },
        { text: '}', kind: 'link' },
      ),
    ]);
    expect(verdict.message).toBe('Ref.');
  });

  it('prefers an explicit @since tag for the version', () => {
    const verdict = readDeprecation([
      tag('deprecated', { text: 'use something else' }),
      tag('since', { text: '4.2.0' }),
    ]);
    expect(verdict.since).toBe('4.2.0');
  });

  it('reads an inline "since <version>" phrase when no @since tag is present', () => {
    expect(
      readDeprecation([tag('deprecated', { text: 'removed since v3.1 — use foo' })]).since,
    ).toBe('3.1');
  });

  it("reads React's leading-version convention (@deprecated 16.3, use ...)", () => {
    expect(readDeprecation([tag('deprecated', { text: '16.3, use the constructor' })]).since).toBe(
      '16.3',
    );
  });

  it('leaves since null when the message names no version', () => {
    expect(readDeprecation([tag('deprecated', { text: 'just do not' })]).since).toBeNull();
  });

  it('does not mistake a trailing number for a leading version', () => {
    expect(
      readDeprecation([tag('deprecated', { text: 'use foo instead of 2 things' })]).since,
    ).toBeNull();
  });

  it('flags removal for each documented phrasing', () => {
    for (const phrase of [
      'this will be removed',
      'removed in the next major',
      'it will stop working in React 17',
      'slated for removal',
      'scheduled for removal',
    ]) {
      expect(readDeprecation([tag('deprecated', { text: phrase })]).for_removal).toBe(true);
    }
  });

  it('does not flag removal for a plain discouragement', () => {
    expect(readDeprecation([tag('deprecated', { text: 'prefer the new API' })]).for_removal).toBe(
      false,
    );
  });

  it('treats an explicit empty @since tag as absent and falls back to the message', () => {
    const verdict = readDeprecation([
      tag('deprecated', { text: 'gone since 9.9' }),
      tag('since', { text: '  ' }),
    ]);
    expect(verdict.since).toBe('9.9');
  });

  it('handles a @since tag with no text parts', () => {
    const verdict = readDeprecation([tag('deprecated', { text: 'gone' }), { name: 'since' }]);
    expect(verdict.since).toBeNull();
  });
});
