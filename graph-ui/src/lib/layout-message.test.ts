import { describe, expect, it } from 'vitest';

import { isLayoutRequest, isTrustedLayoutOrigin } from './layout-message';

describe('layout worker message checks', () => {
  it('accepts messages from the owning page or a dedicated-worker empty origin', () => {
    expect(isTrustedLayoutOrigin('', 'http://127.0.0.1:4000')).toBe(true);
    expect(isTrustedLayoutOrigin('http://127.0.0.1:4000', 'http://127.0.0.1:4000')).toBe(true);
  });

  it('rejects messages from any other origin', () => {
    expect(isTrustedLayoutOrigin('https://evil.example', 'http://127.0.0.1:4000')).toBe(false);
    expect(isTrustedLayoutOrigin('null', 'http://127.0.0.1:4000')).toBe(false);
  });

  it('accepts a well-formed layout request', () => {
    expect(
      isLayoutRequest({
        nodes: [{ id: 'a', x: 0, y: 1 }],
        edges: [{ source: 'a', target: 'a' }],
        iterations: 10,
      }),
    ).toBe(true);
    expect(isLayoutRequest({ nodes: [], edges: [], iterations: 0 })).toBe(true);
  });

  it('ignores messages that are not layout requests', () => {
    expect(isLayoutRequest(null)).toBe(false);
    expect(isLayoutRequest('layout')).toBe(false);
    expect(isLayoutRequest({ nodes: [], edges: [] })).toBe(false);
    expect(isLayoutRequest({ nodes: {}, edges: [], iterations: 1 })).toBe(false);
    expect(isLayoutRequest({ nodes: [], edges: {}, iterations: 1 })).toBe(false);
    expect(isLayoutRequest({ nodes: [{ id: 1, x: 0, y: 0 }], edges: [], iterations: 1 })).toBe(
      false,
    );
    expect(isLayoutRequest({ nodes: [{ id: 'a', x: '0', y: 0 }], edges: [], iterations: 1 })).toBe(
      false,
    );
    expect(isLayoutRequest({ nodes: [], edges: [{ source: 'a' }], iterations: 1 })).toBe(false);
    expect(isLayoutRequest({ nodes: [], edges: [null], iterations: 1 })).toBe(false);
    expect(isLayoutRequest({ nodes: [], edges: [], iterations: Number.NaN })).toBe(false);
    expect(isLayoutRequest({ nodes: [], edges: [], iterations: -1 })).toBe(false);
  });
});
