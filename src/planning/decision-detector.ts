import type { DecisionCategory } from './decision-packet.js';

export interface DetectedDecisionFork {
  category: DecisionCategory;
  confidence: number;
  signal: string;
  matched_text: string;
}

const SIGNALS: Array<{ category: DecisionCategory; signal: string; patterns: RegExp[] }> = [
  {
    category: 'create-vs-reuse',
    signal: 'reuse-vs-create',
    patterns: [
      /\b(reuse|existing)\b.{0,40}\b(create|build|make new|new)\b/i,
      /\b(create|build|make new|new)\b.{0,40}\b(reuse|existing)\b/i,
    ],
  },
  {
    category: 'component-reuse',
    signal: 'component-choice',
    patterns: [
      /\b(button|card|modal|drawer|tile|iconbutton|input|form)\b.{0,15}\bor\b.{0,15}\b(button|card|modal|drawer|tile|iconbutton|input|form)\b/i,
    ],
  },
  {
    category: 'architecture-path',
    signal: 'alternative-path',
    patterns: [/\b(or|either|alternatively|we could)\b/i],
  },
  {
    category: 'architecture-path',
    signal: 'multiple-file-paths',
    patterns: [
      /(?:[\w-]+\/)+[\w.-]+\.\w+.{0,40}\bor\b.{0,40}(?:[\w-]+\/)+[\w.-]+\.\w+/i,
      /(?:[\w-]+\/)+[\w.-]+\.\w+.{0,40}(?:[\w-]+\/)+[\w.-]+\.\w+/i,
    ],
  },
];

export function detectDecisionForks(request: string): DetectedDecisionFork[] {
  const forks: DetectedDecisionFork[] = [];

  for (const candidate of SIGNALS) {
    for (const pattern of candidate.patterns) {
      const match = request.match(pattern);
      if (match) {
        forks.push({
          category: candidate.category,
          confidence: confidenceFor(candidate.signal),
          signal: candidate.signal,
          matched_text: match[0],
        });
        break;
      }
    }
  }

  return forks;
}

function confidenceFor(signal: string): number {
  switch (signal) {
    case 'reuse-vs-create':
      return 0.92;
    case 'component-choice':
      return 0.84;
    default:
      return 0.64;
  }
}
