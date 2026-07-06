import type { DecisionCategory } from './decision-packet.js';

export interface DetectedDecisionFork {
  category: DecisionCategory;
  confidence: number;
  signal: string;
  matched_text: string;
}

interface DecisionSignal {
  category: DecisionCategory;
  signal: string;
  patterns: RegExp[];
  /**
   * Optional guard applied to a pattern match before it counts as a fork. Used to
   * keep a signal genuinely tight (e.g. two *distinct* file paths, not the same
   * path twice) so a high-confidence signal cannot fire on a coincidence.
   */
  validate?: (match: RegExpMatchArray) => boolean;
}

const SIGNALS: DecisionSignal[] = [
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
  // The TIGHT architecture-path signal that self-arm is allowed to mint on (#300):
  // two DISTINCT file paths explicitly offered as alternatives ("live in X or Y",
  // "X vs Y"). This is a real "which path" fork, so it carries a high confidence.
  // Placed before the broad signals so its match is available; the broad ones below
  // still emit their own low-confidence forks for detection-only callers.
  {
    category: 'architecture-path',
    signal: 'explicit-path-fork',
    patterns: [
      /((?:[\w-]+\/)+[\w.-]+\.\w+)\s*(?:,\s*)?\b(?:or|vs\.?|versus)\b\s*((?:[\w-]+\/)+[\w.-]+\.\w+)/i,
    ],
    validate: (match) => match[1].toLowerCase() !== match[2].toLowerCase(),
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
      if (match && (!candidate.validate || candidate.validate(match))) {
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
    case 'explicit-path-fork':
      return 0.9;
    case 'component-choice':
      return 0.84;
    default:
      return 0.64;
  }
}
