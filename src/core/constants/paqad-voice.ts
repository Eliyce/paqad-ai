/**
 * Canonical paqad voice + status vocabulary — the single source of truth for
 * the glyphs, verdict words, and status-block frame paqad speaks in across
 * every surface it appears on (issue #158):
 *
 *   - the in-chat narration contract baked into provider entry files
 *     (`src/adapters/shared/narration-contract.ts`),
 *   - the PR evidence comment (`src/verification/evidence-markdown.ts`),
 *   - the dashboard markdown (`src/dashboard/markdown.ts`).
 *
 * Change a glyph or a verdict word here and it changes everywhere, so paqad
 * sounds like one system across the chat, the PR comment, and the dashboard.
 *
 * Rules baked into the vocabulary itself:
 *   - Glyphs carry FIXED, reserved meaning — status only, never decoration.
 *   - Every glyph is always paired with a word, so each line stays fully
 *     legible with the emoji stripped (NO_COLOR, screen readers, piped/CI
 *     output, colour-blind readers).
 *   - markdown structure carries identity, never ANSI colour — ANSI is not
 *     portable across Claude Code / Codex / Cursor.
 */

/** The four status glyphs, keyed by semantic meaning. */
export const PAQAD_STATUS_GLYPH = {
  /** Passed, good, on track. */
  good: '🟢',
  /** Failed, blocking. */
  failed: '🔴',
  /** Inconclusive, needs a look, over-trust risk. */
  needsLook: '🟡',
  /** Not run, not applicable. */
  skipped: '⚪',
} as const;

export type PaqadStatusKind = keyof typeof PAQAD_STATUS_GLYPH;

/**
 * One-word label for each glyph. Used to build the legend and, more
 * importantly, to guarantee every status line is legible with the glyph
 * stripped — the word carries the meaning, the glyph only reinforces it.
 */
export const PAQAD_STATUS_LABEL: Record<PaqadStatusKind, string> = {
  good: 'good',
  failed: 'failed',
  needsLook: 'needs a look',
  skipped: 'skipped',
};

/**
 * The verdict headline paqad uses for an overall result. Reused by the PR
 * evidence comment and the narration contract so the merge verdict reads
 * identically in chat and on the PR.
 */
export const PAQAD_VERDICT = {
  pass: 'Safe to merge',
  fail: 'Needs your attention',
  inconclusive: 'Inconclusive',
} as const;

/**
 * The recurring branded frame. `**▸ paqad** · <label>` leads a status block;
 * a blockquote body carries the plain-language detail. The frame is stable
 * across every surface so recognition accrues without repeating the name on
 * every line.
 */
export const PAQAD_FRAME_LEAD = '**▸ paqad**';
export const PAQAD_FRAME_SEP = '·';

/** A status-block lead line: `**▸ paqad** · <label>`. */
export function paqadFrameLead(label: string): string {
  return `${PAQAD_FRAME_LEAD} ${PAQAD_FRAME_SEP} ${label}`;
}

/**
 * The status-glyph legend rendered as one inline line, e.g.
 * `🟢 good · 🔴 failed · 🟡 needs a look · ⚪ skipped`. Deterministic key order.
 */
export function paqadGlyphLegend(): string {
  return (Object.keys(PAQAD_STATUS_GLYPH) as PaqadStatusKind[])
    .map((kind) => `${PAQAD_STATUS_GLYPH[kind]} ${PAQAD_STATUS_LABEL[kind]}`)
    .join(` ${PAQAD_FRAME_SEP} `);
}

/**
 * Plain-English translation of every internal term paqad surfaces in chat. The
 * narration contract instructs the agent to say the `plain` phrasing, never the
 * `term`. Single source so the translations never drift between the entry-file
 * contract and the canonical managed doc.
 *
 * The framing is first-person and on-the-developer's-behalf on purpose: that is
 * the reciprocity trigger the feature rests on ("checked for you", not "the
 * system ran a check").
 */
export interface PaqadTermTranslation {
  /** The internal term as it appears in the pipeline / verification code. */
  term: string;
  /** What paqad says instead, in plain language, to the developer. */
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
    plain: "I worked out what this actually needs to do before building it.",
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
