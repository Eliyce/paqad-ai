import type { FlakinessSmell, FlakinessSmellHit } from '@/core/types/flaky.js';

interface SmellRule {
  smell: FlakinessSmell;
  signal: string;
  pattern: RegExp;
}

const SMELL_RULES: SmellRule[] = [
  { smell: 'timing', signal: 'Date.now', pattern: /\bDate\.now\s*\(/ },
  { smell: 'timing', signal: 'new Date()', pattern: /\bnew\s+Date\s*\(\s*\)/ },
  { smell: 'timing', signal: 'performance.now', pattern: /\bperformance\.now\s*\(/ },
  { smell: 'timing', signal: 'setTimeout', pattern: /\bsetTimeout\s*\(/ },
  { smell: 'timing', signal: 'setInterval', pattern: /\bsetInterval\s*\(/ },
  { smell: 'timing', signal: 'sleep', pattern: /\b(sleep|delay)\s*\(/ },
  { smell: 'randomness', signal: 'Math.random', pattern: /\bMath\.random\s*\(/ },
  { smell: 'randomness', signal: 'crypto.randomUUID', pattern: /\b(randomUUID|randomBytes)\s*\(/ },
  {
    smell: 'order-dependence',
    signal: 'test.only / describe.only',
    pattern: /\b(test|it|describe)\.only\b/,
  },
  { smell: 'order-dependence', signal: 'beforeAll mutation', pattern: /\bbeforeAll\s*\(/ },
  { smell: 'shared-state', signal: 'process.env mutation', pattern: /\bprocess\.env\.\w+\s*=/ },
  { smell: 'shared-state', signal: 'global assignment', pattern: /\b(globalThis|global)\.\w+\s*=/ },
  { smell: 'shared-state', signal: 'static mutable', pattern: /\b(let|var)\s+\w+\s*=.*\[\]/ },
  { smell: 'network-io', signal: 'fetch', pattern: /\bfetch\s*\(/ },
  { smell: 'network-io', signal: 'http(s) request', pattern: /\bhttps?\.(get|request)\s*\(/ },
  { smell: 'network-io', signal: 'axios', pattern: /\baxios\b/ },
  { smell: 'network-io', signal: 'fs read/write', pattern: /\b(readFileSync|writeFileSync|fs\.)/ },
];

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
