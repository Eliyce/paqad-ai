import type { FlakinessSmell, FlakinessSmellHit } from '@/core/types/flaky.js';

// Issue #106 §5 — surface the usual non-determinism culprits in a flaky test so
// the root cause is fixed, not the symptom. These are heuristics over the test's
// own source (and, as a fallback, its failure stack trace). They never decide
// flakiness on their own — `judgeStability` does — they only explain a confirmed
// flake so it can be repaired at the root.

interface SmellRule {
  smell: FlakinessSmell;
  /** Human-readable signal recorded when a pattern matches. */
  signal: string;
  pattern: RegExp;
}

// Patterns are deliberately conservative: each targets a concrete API or idiom
// rather than a broad word, to keep false positives low.
const SMELL_RULES: SmellRule[] = [
  // Timing — wall-clock reads and sleeps make a test depend on when it runs.
  { smell: 'timing', signal: 'Date.now', pattern: /\bDate\.now\s*\(/ },
  { smell: 'timing', signal: 'new Date()', pattern: /\bnew\s+Date\s*\(\s*\)/ },
  { smell: 'timing', signal: 'performance.now', pattern: /\bperformance\.now\s*\(/ },
  { smell: 'timing', signal: 'setTimeout', pattern: /\bsetTimeout\s*\(/ },
  { smell: 'timing', signal: 'setInterval', pattern: /\bsetInterval\s*\(/ },
  { smell: 'timing', signal: 'sleep', pattern: /\b(sleep|delay)\s*\(/ },
  // Randomness — unseeded randomness changes inputs between runs.
  { smell: 'randomness', signal: 'Math.random', pattern: /\bMath\.random\s*\(/ },
  { smell: 'randomness', signal: 'crypto.randomUUID', pattern: /\b(randomUUID|randomBytes)\s*\(/ },
  // Order-dependence — leaking state into sibling tests via shared hooks.
  {
    smell: 'order-dependence',
    signal: 'test.only / describe.only',
    pattern: /\b(test|it|describe)\.only\b/,
  },
  { smell: 'order-dependence', signal: 'beforeAll mutation', pattern: /\bbeforeAll\s*\(/ },
  // Shared / global state — process-wide mutation outlives the test.
  { smell: 'shared-state', signal: 'process.env mutation', pattern: /\bprocess\.env\.\w+\s*=/ },
  { smell: 'shared-state', signal: 'global assignment', pattern: /\b(globalThis|global)\.\w+\s*=/ },
  { smell: 'shared-state', signal: 'static mutable', pattern: /\b(let|var)\s+\w+\s*=.*\[\]/ },
  // Network / IO — real network or filesystem outside the test's control.
  { smell: 'network-io', signal: 'fetch', pattern: /\bfetch\s*\(/ },
  { smell: 'network-io', signal: 'http(s) request', pattern: /\bhttps?\.(get|request)\s*\(/ },
  { smell: 'network-io', signal: 'axios', pattern: /\baxios\b/ },
  { smell: 'network-io', signal: 'fs read/write', pattern: /\b(readFileSync|writeFileSync|fs\.)/ },
];

/**
 * Detects the common flakiness root-cause smells in a piece of test source (or,
 * as a fallback, a failure stack trace). Returns one hit per distinct
 * smell+signal, in a stable order, so the report is deterministic. An empty
 * array means no recognised smell — not "definitely not flaky".
 */
export function detectFlakinessSmells(source: string): FlakinessSmellHit[] {
  if (!source) {
    return [];
  }

  const seen = new Set<string>();
  const hits: FlakinessSmellHit[] = [];
  for (const rule of SMELL_RULES) {
    if (!rule.pattern.test(source)) {
      continue;
    }
    const key = `${rule.smell}:${rule.signal}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    hits.push({ smell: rule.smell, signal: rule.signal });
  }
  return hits;
}

/** The distinct smell categories present in a set of hits, in declared order. */
export function smellCategories(hits: FlakinessSmellHit[]): FlakinessSmell[] {
  const order: FlakinessSmell[] = [
    'timing',
    'order-dependence',
    'shared-state',
    'network-io',
    'randomness',
  ];
  const present = new Set(hits.map((hit) => hit.smell));
  return order.filter((smell) => present.has(smell));
}
