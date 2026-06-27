import { describe, expect, it } from 'vitest';

import { Bm25Index, tokenize } from '@/rag/lexical-bm25.js';

describe('tokenize', () => {
  it('splits camelCase, snake_case, and punctuation into shared terms', () => {
    expect(tokenize('canAccessAuth')).toEqual(['can', 'access', 'auth']);
    expect(tokenize('can_access_auth')).toEqual(['can', 'access', 'auth']);
    expect(tokenize('can access auth')).toEqual(['can', 'access', 'auth']);
    expect(tokenize('coupon.ledger')).toEqual(['coupon', 'ledger']);
  });

  it('splits ACRONYMWord boundaries', () => {
    expect(tokenize('HTTPServer')).toEqual(['http', 'server']);
  });
});

describe('Bm25Index', () => {
  const docs = [
    { id: 'auth', content: 'function canAccessAuth(user) { return user.role }' },
    { id: 'billing', content: 'function applyCoupon(order) { return order.total }' },
    { id: 'misc', content: 'some unrelated utility helpers and formatting code' },
  ];

  it('ranks the document that contains the exact identifier first', () => {
    const hits = new Bm25Index(docs).search('canAccessAuth');
    expect(hits[0]?.id).toBe('auth');
  });

  it('matches an identifier query against a natural-language document and vice versa', () => {
    const hits = new Bm25Index(docs).search('apply coupon');
    expect(hits[0]?.id).toBe('billing');
  });

  it('omits documents with no shared terms (score 0)', () => {
    const hits = new Bm25Index(docs).search('canAccessAuth');
    expect(hits.map((h) => h.id)).not.toContain('misc');
  });

  it('returns nothing for an empty query or empty corpus', () => {
    expect(new Bm25Index(docs).search('')).toEqual([]);
    expect(new Bm25Index([]).search('auth')).toEqual([]);
  });

  it('respects the topK cap', () => {
    const hits = new Bm25Index(docs).search('function user order', 1);
    expect(hits).toHaveLength(1);
  });
});
