export const PAQAD_STATUS_GLYPH = {
  good: '🟢',
  failed: '🔴',
  needsLook: '🟡',
  skipped: '⚪',
} as const;

export type PaqadStatusKind = keyof typeof PAQAD_STATUS_GLYPH;

export const PAQAD_STATUS_LABEL: Record<PaqadStatusKind, string> = {
  good: 'good',
  failed: 'failed',
  needsLook: 'needs a look',
  skipped: 'skipped',
};

export const PAQAD_VERDICT = {
  pass: 'Safe to merge',
  fail: 'Needs your attention',
  inconclusive: 'Inconclusive',
} as const;

export const PAQAD_FRAME_LEAD = '**▸ paqad**';
export const PAQAD_FRAME_SEP = '·';

export function paqadFrameLead(label: string): string {
  return `${PAQAD_FRAME_LEAD} ${PAQAD_FRAME_SEP} ${label}`;
}

export function paqadGlyphLegend(): string {
  return (Object.keys(PAQAD_STATUS_GLYPH) as PaqadStatusKind[])
    .map((kind) => `${PAQAD_STATUS_GLYPH[kind]} ${PAQAD_STATUS_LABEL[kind]}`)
    .join(` ${PAQAD_FRAME_SEP} `);
}

export interface PaqadTermTranslation {
  term: string;
  plain: string;
}

export const PAQAD_TERM_TRANSLATIONS: readonly PaqadTermTranslation[] = [
  {
    term: 'classification',
    plain: 'I read your request and judged how risky it is.',
  },
  {
    term: 'lane / routing',
    plain:
      'I picked the path: a quick path for small changes, the full path (spec → build → verify) for risky ones.',
  },
  {
    term: 'requirement derivation',
    plain: 'I worked out what this actually needs to do before building it.',
  },
  {
    term: 'verification gates',
    plain: 'I ran the safety checks for you before calling this done.',
  },
  {
    term: 'mutation testing',
    plain: 'I double-checked your tests actually catch bugs, not just run.',
  },
  {
    term: 'quality ratchet',
    plain: "I made sure nothing slipped below the quality bar you'd already set.",
  },
  {
    term: 'traceability',
    plain: 'I tied each requirement to the test that proves it.',
  },
  {
    term: 'decision pause',
    plain: "I hit a real choice that's yours to make, so I stopped to ask.",
  },
];
