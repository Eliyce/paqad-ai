import {
  selectRetrievalDepth,
  escalateDepth,
  gateRetrieval,
  topNForDepth,
} from '@/context/retrieval-depth-router.js';
import type { DepthRoutingInput } from '@/context/retrieval-depth-router.js';
import type { RetrievalDepth } from '@/context/types.js';

describe('selectRetrievalDepth', () => {
  describe('returns none', () => {
    it('for investigation workflow with trivial complexity', () => {
      expect(selectRetrievalDepth({ workflow: 'investigation', complexity: 'trivial' })).toBe(
        'none',
      );
    });

    it('for investigation workflow with low complexity', () => {
      expect(selectRetrievalDepth({ workflow: 'investigation', complexity: 'low' })).toBe('none');
    });

    it('for trivial complexity with single-file scope', () => {
      expect(selectRetrievalDepth({ complexity: 'trivial', scope: 'single-file' })).toBe('none');
    });
  });

  describe('returns deep', () => {
    it('for high complexity', () => {
      expect(selectRetrievalDepth({ complexity: 'high' })).toBe('deep');
    });

    it('for very-high complexity', () => {
      expect(selectRetrievalDepth({ complexity: 'very-high' })).toBe('deep');
    });

    it('for system-wide scope', () => {
      expect(selectRetrievalDepth({ scope: 'system-wide' })).toBe('deep');
    });

    it('for high risk', () => {
      expect(selectRetrievalDepth({ risk: 'high' })).toBe('deep');
    });

    it('for high risk even with low complexity', () => {
      expect(selectRetrievalDepth({ complexity: 'low', risk: 'high' })).toBe('deep');
    });
  });

  describe('returns standard', () => {
    it('for medium complexity with low risk', () => {
      expect(selectRetrievalDepth({ complexity: 'medium', risk: 'low' })).toBe('standard');
    });

    it('for low complexity with low risk (non-investigation)', () => {
      expect(selectRetrievalDepth({ complexity: 'low', risk: 'low', workflow: 'bug-fix' })).toBe(
        'standard',
      );
    });

    it('for null workflow with trivial complexity but multi-module scope', () => {
      expect(
        selectRetrievalDepth({ complexity: 'trivial', scope: 'multi-module', workflow: null }),
      ).toBe('standard');
    });

    it('for empty input (all signals absent)', () => {
      const input: DepthRoutingInput = {};
      expect(selectRetrievalDepth(input)).toBe('standard');
    });

    it('for investigation workflow with medium complexity', () => {
      expect(selectRetrievalDepth({ workflow: 'investigation', complexity: 'medium' })).toBe(
        'standard',
      );
    });
  });

  it('is deterministic — same input always yields same output', () => {
    const input: DepthRoutingInput = {
      complexity: 'medium',
      risk: 'medium',
      scope: 'single-module',
    };
    expect(selectRetrievalDepth(input)).toBe(selectRetrievalDepth(input));
  });

  it('reaches none depth for classifier-emitted trivial single-file cleanup signals', () => {
    expect(
      selectRetrievalDepth({
        workflow: 'cleanup',
        complexity: 'trivial',
        scope: 'single-file',
      }),
    ).toBe('none');
  });
});

describe('escalateDepth', () => {
  it.each([
    ['none', 'standard'],
    ['standard', 'deep'],
    ['deep', 'deep'],
  ] as [RetrievalDepth, RetrievalDepth][])('escalates "%s" → "%s"', (from, to) => {
    expect(escalateDepth(from)).toBe(to);
  });

  it('is bounded — escalating deep returns deep', () => {
    expect(escalateDepth('deep')).toBe('deep');
  });
});

describe('topNForDepth', () => {
  const base = 20;

  it('returns 0 for none (skip vector retrieval)', () => {
    expect(topNForDepth('none', base)).toBe(0);
  });

  it('returns base topN for standard', () => {
    expect(topNForDepth('standard', base)).toBe(20);
  });

  it('returns base * 3 for deep', () => {
    expect(topNForDepth('deep', base)).toBe(60);
  });

  it('scales correctly with different base values', () => {
    expect(topNForDepth('deep', 10)).toBe(30);
    expect(topNForDepth('standard', 5)).toBe(5);
    expect(topNForDepth('none', 100)).toBe(0);
  });
});

describe('gateRetrieval (F14)', () => {
  it('skips retrieval for a self-contained stage (trivial single-file)', () => {
    const gate = gateRetrieval({ complexity: 'trivial', scope: 'single-file', baseTopN: 20 });
    expect(gate.depth).toBe('none');
    expect(gate.topN).toBe(0);
    expect(gate.skip).toBe(true);
  });

  it('uses standard depth for an ordinary stage', () => {
    const gate = gateRetrieval({ complexity: 'medium', scope: 'single-module', baseTopN: 20 });
    expect(gate.depth).toBe('standard');
    expect(gate.topN).toBe(20);
    expect(gate.skip).toBe(false);
  });

  it('expands the candidate pool for a system-wide / high-risk stage', () => {
    const gate = gateRetrieval({ scope: 'system-wide', baseTopN: 20 });
    expect(gate.depth).toBe('deep');
    expect(gate.topN).toBe(60);
    expect(gate.skip).toBe(false);
  });
});
