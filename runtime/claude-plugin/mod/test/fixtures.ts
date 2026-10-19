// Fixture snapshots for the paqad HUD mod's tests (issue #639, Parts 8 and 9), shaped exactly as
// `src/hud/snapshot.ts` writes `.paqad/session/hud/<session>.json` (a vitest test pins the
// keys). They follow the issue's made-up changes: ORD-490 (fast-lane copy fix), ORD-482
// (graduated-lane bug fix) and ORD-501 (full-lane feature), plus one fixture per band state.
// Shared by the vitest suite and the `claude plugin test` files; not shipped in the package.

export const NOW = Date.parse('2026-10-18T09:00:00.000Z');

type Raw = Record<string, unknown>;

const STAGE_IDS = [
  'ticket_intake',
  'planning',
  'specification',
  'development',
  'review',
  'checks',
  'documentation_sync',
  'delivery',
] as const;

const MANDATORY = new Set([
  'planning',
  'specification',
  'development',
  'review',
  'checks',
  'documentation_sync',
]);

/** Stage rows for the eight stages; `states` names the ones that are not `missing`. */
export function stages(
  states: Partial<Record<(typeof STAGE_IDS)[number], string>>,
  started: Partial<Record<(typeof STAGE_IDS)[number], string>> = {},
): Raw[] {
  return STAGE_IDS.map((stage) => {
    const state = states[stage] ?? 'missing';
    const startedAt = started[stage] ?? (state === 'missing' ? null : '2026-10-18T08:30:00.000Z');
    return {
      stage,
      state,
      mandatory: MANDATORY.has(stage),
      started_at: startedAt,
      ended_at: state === 'complete' ? '2026-10-18T08:40:00.000Z' : null,
      duration_ms: state === 'complete' ? 600000 : null,
      duration_unreliable: false,
      agent: state === 'missing' ? null : 'orchestrator',
      proof_file: null,
    };
  });
}

const ALL_DONE = {
  planning: 'complete',
  specification: 'complete',
  development: 'complete',
  review: 'complete',
  checks: 'complete',
  documentation_sync: 'complete',
} as const;

/** A whole snapshot with no change in progress; `over` replaces top-level fields. */
export function snapshot(over: Raw = {}): Raw {
  return {
    schema: 'paqad.hud/2',
    session_id: 'ses-fixture',
    generated_at: '2026-10-18T09:00:00.000Z',
    active: false,
    route: null,
    lane: null,
    lane_reason: null,
    headline: { text: 'Ready. No change in progress.', tone: 'neutral' },
    change: null,
    paused: [],
    stages: [],
    table: null,
    claims: [],
    gates: [],
    flags: [],
    rules: { recorded: false, applicable: null, loaded_at: null },
    findings: null,
    decisions: { pending: [], resolved: 0 },
    questions: null,
    last_block: null,
    ship: null,
    verdict: null,
    receipt: null,
    evidence_expected: [],
    isolation: null,
    cost: null,
    ...over,
  };
}

function change(issue: string, title: string, branch: string): Raw {
  return { dir: `${issue}-dir`, id: `${issue}-id`, issue, title, branch, status: 'active' };
}

function ship(commits: number): Raw {
  return { commits, commit_decision: null, merge_commit: null, push: null, pr: null, ci: null };
}

function verdict(kind: 'pass' | 'fail' | 'inconclusive', word: string, reasons: string[] = []) {
  return {
    schema: 'paqad.hud-verdict/1',
    session_id: 'ses-fixture',
    word,
    kind,
    passed: kind === 'pass',
    reasons,
    written_at: '2026-10-18T08:59:00.000Z',
  };
}

/** ORD-490, fast lane: plan only, no frozen spec, the build running for two minutes. */
export const FAST_ORD_490 = snapshot({
  active: true,
  route: 'feature-development',
  lane: 'fast',
  lane_reason: 'a one-line copy fix',
  headline: { text: 'Build in progress. Next: Review.', tone: 'working' },
  change: change('ORD-490', 'The order email says recieved', 'fix/ORD-490-received'),
  stages: stages(
    { planning: 'complete', development: 'running' },
    { development: '2026-10-18T08:58:00.000Z' },
  ),
  rules: { recorded: true, applicable: 4, loaded_at: '2026-10-18T08:57:00.000Z' },
  ship: ship(0),
  isolation: { status: 'not-applicable', stages: 0, tokens_not_recarried: 0 },
});

/** ORD-482, graduated lane: planned, a proof-method decision waiting. */
export const GRADUATED_ORD_482 = snapshot({
  active: true,
  route: 'feature-development',
  lane: 'graduated',
  lane_reason: 'a bug fix that touches contact matching',
  headline: { text: 'Needs you: 1 decision waiting.', tone: 'needs-you' },
  change: change(
    'ORD-482',
    'Keep the copied phone after a re-sync',
    'fix/ORD-482-keep-copied-phone',
  ),
  stages: stages({ planning: 'complete', specification: 'complete' }),
  table: {
    skipped: false,
    met_after_freeze: false,
    seats: [],
    chief: null,
    rulings: null,
    gaps: [],
    questions: null,
    credits: [],
  },
  decisions: {
    pending: [
      { id: 'D-01J0', category: 'fix.proof_method', question: 'How should the fix be proven?' },
    ],
    resolved: 2,
  },
  rules: { recorded: true, applicable: 9, loaded_at: '2026-10-18T08:50:00.000Z' },
  ship: ship(0),
});

/** ORD-501, full lane: every stage done, Safe to merge, and one near-copy still open. */
export const FULL_ORD_501 = snapshot({
  active: true,
  route: 'feature-development',
  lane: 'full',
  lane_reason: 'a new export of customer data',
  headline: { text: 'Safe to merge. 1 flag open.', tone: 'warn' },
  change: change('ORD-501', 'Add CSV export to the orders page', 'feat/ORD-501-csv-export'),
  stages: stages(ALL_DONE),
  gates: [
    { name: 'code-tests-lint', required: true, strength: 'deterministic', verdict: 'pass' },
    { name: 'duplication', required: true, strength: 'deterministic', verdict: 'pass' },
  ],
  flags: [{ id: 'near-copies', text: '1 near-copy of existing code is open.' }],
  rules: { recorded: true, applicable: 12, loaded_at: '2026-10-18T08:35:00.000Z' },
  findings: {
    rules: { status: 'clean', total: 0, counts: {}, blocking: false },
    near_copies: { status: 'open', total: 1, counts: {}, blocking: false },
  },
  decisions: { pending: [], resolved: 4 },
  ship: ship(3),
  verdict: verdict('pass', 'Safe to merge'),
  receipt: { path: '/repo/.paqad/session/hud/ses-fixture.receipt.md' },
});

/** The same change with nothing flagged: green. */
export const SAFE_CLEAN = snapshot({
  ...FULL_ORD_501,
  headline: { text: 'Safe to merge.', tone: 'good' },
  flags: [],
  findings: null,
});

export const INCONCLUSIVE = snapshot({
  ...FULL_ORD_501,
  headline: { text: 'Inconclusive.', tone: 'warn' },
  flags: [],
  verdict: verdict('inconclusive', 'Inconclusive', ['mutation-testing: did not run']),
});

export const NEEDS_ATTENTION = snapshot({
  ...FULL_ORD_501,
  headline: { text: 'Needs your attention.', tone: 'bad' },
  flags: [],
  stages: stages({ ...ALL_DONE, review: 'missing' }),
  verdict: verdict('fail', 'Needs your attention', ['change-completeness: review missing']),
});

/** A paused change, nothing active. */
export const PAUSED = snapshot({
  route: 'project-question',
  headline: { text: 'A change is paused. Say "continue" to pick it up.', tone: 'neutral' },
  paused: [{ workflow: 'feature-development', lane: 'graduated' }],
});

/** Another workflow is running (no change in progress). */
export const OTHER_WORKFLOW = snapshot({
  route: 'project-question',
  headline: { text: 'Working on project question.', tone: 'working' },
});

/** A rule stopped an edit (Part 18 records this; nothing writes it today). */
export const STOPPED = snapshot({
  ...FAST_ORD_490,
  last_block: { text: 'RULE-13 stopped an edit to src/orders/export.ts.' },
});

/** The branch carries other tickets' commits (Part 22 raises this flag; nothing does today). */
export const BRANCH_WARNING = snapshot({
  ...GRADUATED_ORD_482,
  headline: { text: 'Next: Build.', tone: 'working' },
  decisions: { pending: [], resolved: 3 },
  flags: [{ id: 'branch-inherited', text: '73 commits from other tickets ride on this branch.' }],
});

/** The fixture behind each of the nine band states. */
export const STATE_FIXTURES = {
  Ready: snapshot(),
  Working: FAST_ORD_490,
  'Branch warning': BRANCH_WARNING,
  'Needs you': GRADUATED_ORD_482,
  Stopped: STOPPED,
  Inconclusive: INCONCLUSIVE,
  'Safe to merge': SAFE_CLEAN,
  'Needs your attention': NEEDS_ATTENTION,
  Paused: PAUSED,
} as const;

export const RECEIPT_TEXT = [
  '**▸ paqad** · Safe to merge',
  '> 🟢 planning: done',
  '> 🟢 specification: done',
].join('\n');

/** The fixture's file text, as the snapshot writer leaves it on disk. */
export function fileText(raw: Raw): string {
  return `${JSON.stringify(raw, null, 2)}\n`;
}
