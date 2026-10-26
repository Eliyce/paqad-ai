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

const ALL_LANE_STAGES = [
  'planning',
  'specification',
  'development',
  'review',
  'checks',
  'documentation_sync',
];

const ALL_DONE = {
  planning: 'complete',
  specification: 'complete',
  development: 'complete',
  review: 'complete',
  checks: 'complete',
  documentation_sync: 'complete',
} as const;

export function snapshot(over: Raw = {}): Raw {
  return {
    schema: 'paqad.hud/3',
    session_id: 'ses-fixture',
    generated_at: '2026-10-18T09:00:00.000Z',
    scope: { qualified: true, reason: 'qualified' },
    workflow: null,
    active: false,
    route: null,
    lane: null,
    lane_reason: null,
    headline: { text: 'Ready. No change in progress.', tone: 'neutral' },
    change: null,
    paused: [],
    stages: [],
    timeline: [],
    table: null,
    claims: [],
    gates: [],
    gates_expected: [],
    flags: [],
    rules: { recorded: false, applicable: null, loaded_at: null },
    findings: null,
    decisions: { pending: [], resolved: 0 },
    questions: null,
    last_block: null,
    delivery_plan: null,
    plan: null,
    ship: null,
    verdict: null,
    receipt: null,
    evidence_expected: [],
    isolation: null,
    cost: null,
    tech_debt: null,
    rule_overrides: null,
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

type SeatState = 'seated' | 'writing' | 'done';

function seatTokens(input: number, output: number, cacheRead: number, cacheWrite: number): Raw {
  return {
    input,
    output,
    cache_read: cacheRead,
    cache_write: cacheWrite,
    total: input + output + cacheRead + cacheWrite,
  };
}

interface SeatPlan {
  role: string;
  origin: 'standing' | 'detector';
  reason: string;
  budget: number;
  clamped: boolean;
  findings: number;
  exact: Raw | null;
  estimate: number;
  started: string;
  done: string;
  record?: Raw | null;
}

const STANDING_REASON = 'standing expert (always at the table)';
const SEATED_AT = '2026-10-18T08:10:00.000Z';

function seat(plan: SeatPlan, state: SeatState, late = false): Raw {
  const landed = state === 'done';
  return {
    role: plan.role,
    reason: plan.reason,
    origin: plan.origin,
    state,
    seated_at: SEATED_AT,
    started_at: state === 'seated' ? null : plan.started,
    done_at: landed ? plan.done : null,
    budget_tokens: plan.budget,
    clamped: plan.clamped,
    tokens_estimate: landed ? plan.estimate : null,
    tokens: landed ? plan.exact : null,
    tokens_exact: landed && plan.exact !== null,
    findings: landed ? plan.findings : null,
    late,
    track_record: plan.record ?? null,
  };
}

const CHIEF_PLAN: SeatPlan = {
  role: 'chief-architect',
  origin: 'standing',
  reason: 'chairs the High Table',
  budget: 10000,
  clamped: false,
  findings: 0,
  exact: seatTokens(12, 1400, 24000, 3100),
  estimate: 3000,
  started: '2026-10-18T08:13:10.000Z',
  done: '2026-10-18T08:15:10.000Z',
};

function chief(state: SeatState | null, verdict: string | null = 'proceed'): Raw | null {
  if (state === null) return null;
  return { ...seat(CHIEF_PLAN, state), findings: null, verdict: state === 'done' ? verdict : null };
}

const standing = (
  role: string,
  findings: number,
  exact: Raw,
  started: string,
  done: string,
): SeatPlan => ({
  role,
  origin: 'standing',
  reason: STANDING_REASON,
  budget: 4000,
  clamped: false,
  findings,
  exact,
  estimate: 900,
  started,
  done,
});

export const ORD_501_SEATS: readonly SeatPlan[] = [
  {
    ...standing(
      'product-owner',
      2,
      seatTokens(5, 410, 15000, 6000),
      '2026-10-18T08:10:05.000Z',
      '2026-10-18T08:12:10.000Z',
    ),
    record: { changes: 6, changed_spec: 4, empty: 1, avg_tokens: 2300 },
  },
  standing(
    'application-architect',
    2,
    seatTokens(6, 450, 16000, 6200),
    '2026-10-18T08:10:05.000Z',
    '2026-10-18T08:12:40.000Z',
  ),
  standing(
    'user-flow-writer',
    1,
    seatTokens(4, 300, 14000, 5800),
    '2026-10-18T08:10:06.000Z',
    '2026-10-18T08:11:50.000Z',
  ),
  standing(
    'qa-engineer',
    2,
    seatTokens(5, 430, 16000, 7600),
    '2026-10-18T08:10:06.000Z',
    '2026-10-18T08:12:20.000Z',
  ),
  {
    role: 'security-auditor',
    origin: 'detector',
    reason: 'the export carries customer emails and addresses',
    budget: 6000,
    clamped: false,
    findings: 3,
    exact: seatTokens(7, 620, 21000, 8100),
    estimate: 1500,
    started: '2026-10-18T08:10:07.000Z',
    done: '2026-10-18T08:13:05.000Z',
  },
  {
    role: 'db-expert',
    origin: 'detector',
    reason: 'the export reads every order in a date range',
    budget: 6000,
    clamped: true,
    findings: 2,
    exact: seatTokens(6, 540, 19000, 7000),
    estimate: 1300,
    started: '2026-10-18T08:10:07.000Z',
    done: '2026-10-18T08:12:55.000Z',
  },
  {
    role: 'performance-analyst',
    origin: 'detector',
    reason: 'a large export must not slow the orders page',
    budget: 5000,
    clamped: false,
    findings: 1,
    exact: null,
    estimate: 1900,
    started: '2026-10-18T08:10:08.000Z',
    done: '2026-10-18T08:12:30.000Z',
  },
];

export const SETTLED_DECISION = 'D-01M3Y1RB507QW3K9F2D8MZXN4R';
export const AUTO_ANSWER_DECISION = 'D-01M39VEJR07QW3K9F2D8MZXN4S';
export const OPEN_CONFLICT = 'Customer email in the export';

const ORD_501_RULINGS = {
  accepted: [
    'EX-product-owner-1',
    'EX-product-owner-2',
    'EX-application-architect-1',
    'EX-application-architect-2',
    'EX-user-flow-writer-1',
    'EX-qa-engineer-1',
    'EX-qa-engineer-2',
    'EX-security-auditor-1',
    'EX-db-expert-1',
  ],
  declined: [
    {
      id: 'EX-performance-analyst-1',
      reason:
        'Streaming the file is out of scope for the first version; exports stop at 10,000 rows.',
    },
  ],
  conflicts: [
    {
      target: OPEN_CONFLICT,
      recommendation: 'leave the email out by default and let an admin turn it on.',
      rationale:
        'The security auditor wants it masked and the product owner wants it for support; an opt-in keeps both.',
    },
  ],
  renames: [{ id: 'EX-user-flow-writer-1', target: 'Export orders' }],
  settled: [{ target: 'Date range limit', chosen: '90 days at most', source: SETTLED_DECISION }],
};

const ORD_501_GAPS = [
  {
    area: 'File retention',
    why_it_matters: 'A generated file with customer data could linger.',
    question: 'How long should a generated export file be kept?',
  },
];

const ORD_501_QUESTIONS = {
  asked: 1,
  auto_answered: [
    { question: 'Which file format should the export use?', source: AUTO_ANSWER_DECISION },
  ],
};

export const ORD_501_CREDITS = [
  { line: 'FR-1', roles: ['product-owner', 'user-flow-writer'] },
  { line: 'FR-2', roles: ['application-architect'] },
  { line: 'FR-3', roles: ['db-expert'] },
  { line: 'FR-4', roles: ['security-auditor'] },
  { line: 'FR-5', roles: ['security-auditor', 'product-owner'] },
  { line: 'FR-6', roles: ['qa-engineer'] },
  { line: 'FR-7', roles: ['user-flow-writer'] },
  { line: 'FR-8', roles: ['application-architect', 'db-expert'] },
  { line: 'NFR-1', roles: ['performance-analyst'] },
  { line: 'NFR-2', roles: ['security-auditor'] },
  { line: 'INV-1', roles: ['db-expert'] },
  { line: 'INV-2', roles: ['qa-engineer', 'product-owner'] },
];

export type Ord501Phase = 'seated' | 'writing' | 'landing' | 'chief' | 'ruled' | 'frozen';

export const ORD_501_PHASES: readonly Ord501Phase[] = [
  'seated',
  'writing',
  'landing',
  'chief',
  'ruled',
  'frozen',
];

const LANDED_EARLY = new Set(['user-flow-writer', 'product-owner', 'qa-engineer']);

export function ord501Table(phase: Ord501Phase): Raw {
  const stateOf = (plan: SeatPlan): SeatState => {
    if (phase === 'seated') return 'seated';
    if (phase === 'writing') return 'writing';
    if (phase === 'landing') return LANDED_EARLY.has(plan.role) ? 'done' : 'writing';
    return 'done';
  };
  const ruled = phase === 'ruled' || phase === 'frozen';
  return {
    skipped: false,
    met_after_freeze: false,
    seats: ORD_501_SEATS.map((plan) => seat(plan, stateOf(plan))),
    chief: chief(phase === 'chief' ? 'writing' : ruled ? 'done' : null),
    rulings: ruled ? ORD_501_RULINGS : null,
    gaps: ruled ? ORD_501_GAPS : [],
    questions: ruled ? ORD_501_QUESTIONS : null,
    credits: phase === 'frozen' ? ORD_501_CREDITS : [],
  };
}

export const ORD_482_SEATS: readonly SeatPlan[] = [
  standing(
    'product-owner',
    1,
    seatTokens(4, 320, 12000, 4100),
    '2026-10-18T08:20:01.000Z',
    '2026-10-18T08:21:40.000Z',
  ),
  standing(
    'application-architect',
    1,
    seatTokens(5, 360, 12500, 4300),
    '2026-10-18T08:20:01.000Z',
    '2026-10-18T08:22:05.000Z',
  ),
  standing(
    'user-flow-writer',
    1,
    seatTokens(4, 280, 11000, 3900),
    '2026-10-18T08:20:02.000Z',
    '2026-10-18T08:21:30.000Z',
  ),
  standing(
    'qa-engineer',
    2,
    seatTokens(5, 410, 13000, 4600),
    '2026-10-18T08:20:02.000Z',
    '2026-10-18T08:22:20.000Z',
  ),
];

export type Ord482Phase = 'writing' | 'landing' | 'ruled';
export const ORD_482_PHASES: readonly Ord482Phase[] = ['writing', 'landing', 'ruled'];

export function ord482Table(phase: Ord482Phase): Raw {
  const early = new Set(['user-flow-writer', 'product-owner']);
  const stateOf = (plan: SeatPlan): SeatState =>
    phase === 'writing'
      ? 'writing'
      : phase === 'landing' && !early.has(plan.role)
        ? 'writing'
        : 'done';
  const ruled = phase === 'ruled';
  return {
    skipped: false,
    met_after_freeze: false,
    seats: ORD_482_SEATS.map((plan) => seat(plan, stateOf(plan))),
    chief: chief(ruled ? 'done' : null),
    rulings: ruled
      ? {
          accepted: [
            'EX-product-owner-1',
            'EX-application-architect-1',
            'EX-user-flow-writer-1',
            'EX-qa-engineer-1',
            'EX-qa-engineer-2',
          ],
          declined: [],
          conflicts: [],
          renames: [],
          settled: [],
        }
      : null,
    gaps: [],
    questions: ruled ? { asked: 0, auto_answered: [] } : null,
    credits: [],
  };
}

type ProofStep = [string, string, string | null, 'done' | 'failed' | 'not-yet'];
type ProofGate = [string, string, string];

export function proofStage(
  stage: string,
  words: string,
  state: string,
  steps: readonly ProofStep[],
  gates: readonly ProofGate[] = [],
): Raw {
  return {
    stage,
    words,
    state,
    steps: steps.map(([id, text, detail, done]) => ({ id, words: text, detail, state: done })),
    gates: gates.map(([code, text, verdict]) => ({ code, words: text, state: verdict })),
  };
}

export const FAST_ORD_490_PROOF: Raw[] = [
  proofStage('planning', 'Plan', 'complete', [
    ['plan', 'Plan compiled', '2 steps', 'done'],
    ['reuse', 'Reuse checked', '3 sources consulted', 'done'],
  ]),
  proofStage(
    'development',
    'Build',
    'running',
    [
      ['rules', 'Rules loaded', '4 rules apply', 'done'],
      ['edits', 'Edits made', '1 file changed', 'done'],
      ['built', 'Plan steps built', '1 of 2', 'not-yet'],
    ],
    [
      ['change-completeness', 'Nothing left half done', 'not-judged'],
      ['extension-surface', 'Public surface stays stable', 'not-judged'],
      ['duplication', 'No near-copies added', 'not-judged'],
    ],
  ),
  proofStage(
    'checks',
    'Checks',
    'missing',
    [['checks', 'Checks run', null, 'not-yet']],
    [
      ['ac-test-mapping', 'Every criterion has a test', 'not-judged'],
      ['code-tests-lint', 'Tests, types and lint pass', 'not-judged'],
      ['mutation-testing', 'Tests catch real mutations', 'not-judged'],
      ['quality-ratchet', 'Quality did not drop', 'not-judged'],
    ],
  ),
];

export const FULL_ORD_501_PROOF: Raw[] = [
  proofStage('planning', 'Plan', 'complete', [
    ['plan', 'Plan compiled', '6 steps', 'done'],
    ['reuse', 'Reuse checked', '5 sources consulted', 'done'],
  ]),
  proofStage(
    'specification',
    'Spec',
    'complete',
    [
      ['grounded', 'Grounded in the code', '8 references', 'done'],
      ['experts', 'Experts seated', '7 experts', 'done'],
      ['questions', 'Questions answered', '4 of 4', 'done'],
      ['frozen', 'Spec frozen', '6 criteria', 'done'],
    ],
    [['spec-review', 'The spec was reviewed', 'pass']],
  ),
  proofStage(
    'development',
    'Build',
    'complete',
    [
      ['rules', 'Rules loaded', '12 rules apply', 'done'],
      ['edits', 'Edits made', '9 files changed', 'done'],
      ['built', 'Plan steps built', '6 of 6', 'done'],
    ],
    [
      ['change-completeness', 'Nothing left half done', 'pass'],
      ['extension-surface', 'Public surface stays stable', 'pass'],
      ['duplication', 'No near-copies added', 'pass'],
    ],
  ),
  proofStage(
    'review',
    'Review',
    'complete',
    [['review', 'Review recorded', '2 findings', 'done']],
    [['implementation-review', 'The code was reviewed', 'pass']],
  ),
  proofStage(
    'checks',
    'Checks',
    'complete',
    [['checks', 'Checks passed', '4 of 4 commands', 'done']],
    [
      ['ac-test-mapping', 'Every criterion has a test', 'pass'],
      ['code-tests-lint', 'Tests, types and lint pass', 'pass'],
      ['mutation-testing', 'Tests catch real mutations', 'not-required'],
      ['quality-ratchet', 'Quality did not drop', 'pass'],
    ],
  ),
  proofStage(
    'documentation_sync',
    'Docs',
    'complete',
    [['docs', 'Docs updated', '2 files changed', 'done']],
    [
      ['module-docs-structure', 'Module docs keep their shape', 'pass'],
      ['instructions-docs-structure', 'Instruction docs keep their shape', 'not-required'],
      ['documentation-freshness', 'Docs match the code', 'pass'],
    ],
  ),
];

export const FAST_ORD_490 = snapshot({
  scope: { qualified: true, reason: 'qualified' },
  active: true,
  route: 'feature-development',
  lane: 'fast',
  lane_stages: ['planning', 'development', 'checks'],
  lane_reason: 'a one-line copy fix',
  headline: {
    text: 'Building',
    tone: 'working',
    row: 15,
    word: 'Working',
    clock_from: '2026-10-18T08:58:00.000Z',
  },
  change: change('ORD-490', 'The order email says recieved', 'fix/ORD-490-received'),
  stages: stages(
    { planning: 'complete', development: 'running' },
    { development: '2026-10-18T08:58:00.000Z' },
  ),
  rules: { recorded: true, applicable: 4, loaded_at: '2026-10-18T08:57:00.000Z' },
  ship: ship(0),
  isolation: { status: 'not-applicable', stages: 0, tokens_not_recarried: 0 },
  proof: FAST_ORD_490_PROOF,
});

export const GRADUATED_ORD_482 = snapshot({
  scope: { qualified: true, reason: 'qualified' },
  active: true,
  route: 'feature-development',
  lane: 'graduated',
  lane_stages: ALL_LANE_STAGES,
  lane_reason: 'a bug fix that touches contact matching',
  headline: { text: '1 decision is waiting for you', tone: 'needs-you', row: 6, word: 'Needs you' },
  change: change(
    'ORD-482',
    'Keep the copied phone after a re-sync',
    'fix/ORD-482-keep-copied-phone',
  ),
  stages: stages({ planning: 'complete', specification: 'complete' }),
  table: ord482Table('ruled'),
  decisions: {
    pending: [
      { id: 'D-01J0', category: 'fix.proof_method', question: 'How should the fix be proven?' },
    ],
    resolved: 2,
  },
  rules: { recorded: true, applicable: 9, loaded_at: '2026-10-18T08:50:00.000Z' },
  ship: ship(0),
});

export const FULL_ORD_501 = snapshot({
  scope: { qualified: true, reason: 'qualified' },
  active: true,
  route: 'feature-development',
  lane: 'full',
  lane_stages: ALL_LANE_STAGES,
  lane_reason: 'a new export of customer data',
  headline: { text: 'Safe to merge. 1 flag open.', tone: 'warn' },
  change: change('ORD-501', 'Add CSV export to the orders page', 'feat/ORD-501-csv-export'),
  stages: stages(ALL_DONE),
  table: ord501Table('frozen'),
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
  start_point: { source: 'start_commit', base: null, files_known: true },
  proof: FULL_ORD_501_PROOF,
});

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

export const PAUSED = snapshot({
  scope: { qualified: false, reason: 'not-feature-route' },
  route: 'project-question',
  headline: { text: 'A change is paused. Say "continue" to pick it up.', tone: 'neutral' },
  paused: [{ workflow: 'feature-development', lane: 'graduated' }],
});

export const OTHER_WORKFLOW = snapshot({
  scope: { qualified: false, reason: 'not-feature-route' },
  route: 'project-question',
  headline: { text: 'Working on project question.', tone: 'working' },
});

export const STOPPED = snapshot({
  ...FAST_ORD_490,
  last_block: { text: 'RULE-13 stopped an edit to src/orders/export.ts.' },
});

export const BRANCH_WARNING = snapshot({
  ...GRADUATED_ORD_482,
  headline: { text: 'Next: Build.', tone: 'working' },
  decisions: { pending: [], resolved: 3 },
  flags: [{ id: 'branch-inherited', text: '73 commits from other tickets ride on this branch.' }],
});

export const STATE_FIXTURES = {
  Ready: snapshot(),
  Working: FAST_ORD_490,
  'Branch warning': BRANCH_WARNING,
  'Needs you': GRADUATED_ORD_482,
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

export function fileText(raw: Raw): string {
  return `${JSON.stringify(raw, null, 2)}\n`;
}

function tokens(input: number, output: number, cacheRead: number, cacheWrite: number): Raw {
  return {
    input,
    output,
    cache_read: cacheRead,
    cache_write: cacheWrite,
    total: input + output + cacheRead + cacheWrite,
  };
}

export function costRecord(over: Raw = {}): Raw {
  return {
    computed_at: '2026-10-18T08:59:30.000Z',
    window: {
      from: '2026-10-18T08:00:00.000Z',
      to: '2026-10-18T08:59:00.000Z',
      sealed: true,
      sealed_by: 'receipt',
    },
    scope: 'change',
    price_table_date: '2026-10-19',
    price_source: 'https://platform.claude.com/docs/en/about-claude/pricing',
    basis: 'API-equivalent estimate',
    label: 'estimate at API prices (API-equivalent on a Pro or Max plan)',
    plan_note:
      'On a Pro or Max plan you pay a flat fee, not these prices. The figure is what the same tokens would cost on the API.',
    tokens: tokens(2000, 98000, 1100000, 100000),
    usd: 4.6,
    unpriced_models: [],
    by_stage: [
      { stage: 'planning', tokens: tokens(200, 9800, 100000, 10000), usd: 0.42 },
      { stage: 'specification', tokens: tokens(500, 24500, 260000, 25000), usd: 1.1 },
      { stage: 'development', tokens: tokens(900, 45100, 544000, 50000), usd: 2.3 },
      { stage: 'review', tokens: tokens(100, 6900, 78000, 5000), usd: 0.31 },
      { stage: 'checks', tokens: tokens(100, 2900, 35000, 2000), usd: 0.12 },
      { stage: 'documentation_sync', tokens: tokens(100, 1900, 26000, 2000), usd: 0.09 },
      { stage: 'orchestrator', tokens: tokens(100, 6900, 57000, 6000), usd: 0.26 },
    ],
    by_expert: [
      {
        role: 'security-auditor',
        tokens: tokens(40, 1960, 34000, 4000),
        usd: 0.14,
        exact: true,
      },
      { role: 'db-expert', tokens: tokens(30, 1470, 25500, 3000), usd: 0.11, exact: true },
      { role: 'qa-engineer', tokens: tokens(0, 0, 0, 1800), usd: null, exact: false },
    ],
    chief: { tokens: tokens(25, 1225, 21250, 2500), usd: 0.09, exact: true },
    not_counted: [
      'The fast mode premium',
      'The 1.1 times multiplier for US-only inference',
      'Batch discounts',
    ],
    live: false,
    ...over,
  };
}

export const FULL_ORD_501_COST = snapshot({ ...FULL_ORD_501, cost: costRecord() });

export const FAST_ORD_490_COST = snapshot({
  ...FAST_ORD_490,
  cost: costRecord({
    window: { from: '2026-10-18T08:56:00.000Z', to: '2026-10-18T09:00:00.000Z', sealed: false },
    tokens: tokens(300, 4700, 60000, 5000),
    usd: 0.21,
    by_stage: [
      { stage: 'planning', tokens: tokens(100, 1900, 20000, 2000), usd: 0.08 },
      { stage: 'development', tokens: tokens(200, 2800, 40000, 3000), usd: 0.13 },
    ],
    by_expert: [],
    chief: null,
  }),
});

export const UNPRICED_COST = snapshot({
  ...FAST_ORD_490,
  cost: costRecord({
    tokens: tokens(100, 900, 9000, 0),
    usd: null,
    unpriced_models: ['claude-future-9'],
    by_stage: [{ stage: 'development', tokens: tokens(100, 900, 9000, 0), usd: null }],
    by_expert: [],
    chief: null,
  }),
});

export function ord501At(phase: Ord501Phase): Raw {
  if (phase === 'frozen') return FULL_ORD_501;
  const ruled = phase === 'ruled';
  return snapshot({
    ...FULL_ORD_501,
    headline: ruled
      ? {
          text: 'The chief architect has 1 question for you',
          tone: 'needs-you',
          row: 5,
          word: 'Needs you',
        }
      : {
          text: 'The High Table is writing its notes',
          tone: 'working',
          row: 15,
          word: 'Working',
          clock_from: '2026-10-18T08:09:00.000Z',
        },
    stages: stages(
      { planning: 'complete', specification: 'running' },
      { specification: '2026-10-18T08:09:00.000Z' },
    ),
    table: ord501Table(phase),
    flags: [],
    findings: null,
    decisions: ruled
      ? {
          pending: [
            {
              id: 'D-01M5AQ0000000000000000000A',
              category: 'spec.expert_conflict',
              question: `Experts disagree on ${OPEN_CONFLICT}`,
            },
          ],
          resolved: 1,
        }
      : { pending: [], resolved: 1 },
    ship: ship(0),
    verdict: null,
    receipt: null,
  });
}

export const ORD_501_SEQUENCE = ORD_501_PHASES.map(ord501At);

export function ord482At(phase: Ord482Phase): Raw {
  if (phase === 'ruled') return GRADUATED_ORD_482;
  return snapshot({
    ...GRADUATED_ORD_482,
    headline: { text: 'Spec in progress. Next: Build.', tone: 'working' },
    stages: stages(
      { planning: 'complete', specification: 'running' },
      { specification: '2026-10-18T08:19:30.000Z' },
    ),
    table: ord482Table(phase),
    decisions: { pending: [], resolved: 2 },
  });
}

export const ORD_482_SEQUENCE = ORD_482_PHASES.map(ord482At);

export const LATE_TABLE = snapshot({
  ...FULL_ORD_501,
  headline: { text: 'Safe to merge. 1 flag open.', tone: 'warn' },
  table: {
    ...ord501Table('frozen'),
    met_after_freeze: true,
    seats: ORD_501_SEATS.map((plan) =>
      seat(
        plan.role === 'security-auditor' ? { ...plan, done: '2026-10-18T08:40:00.000Z' } : plan,
        'done',
        plan.role === 'security-auditor',
      ),
    ),
    credits: [],
  },
  flags: [{ id: 'high-table-late', text: 'The High Table met after the spec was frozen.' }],
  findings: null,
});

export const EXPERTS_OFF = snapshot({ ...GRADUATED_ORD_482, table: null });

export const SKIPPED_TABLE = snapshot({
  ...FULL_ORD_501,
  table: {
    skipped: true,
    met_after_freeze: false,
    seats: [],
    chief: null,
    rulings: null,
    gaps: [],
    questions: null,
    credits: [],
  },
});

const FULL_DELIVERY = { commit: true, push: true, pr: true, ci: true, merge: true, reason: null };

const OPEN_PR = {
  number: 12,
  url: 'https://example.test/pull/12',
  draft: false,
  head_sha: 'aaa1111',
};

const COMMITS = [
  { sha: 'a1c9e2f0000000', subject: 'Add the CSV export button', own: true },
  { sha: '7f02d410000000', subject: 'Stream the rows', own: true },
  { sha: '64e4c850000000', subject: 'Upgrade changes from main', own: false },
];

function job(name: string, status: string, conclusion: string | null, seconds: number | null) {
  return {
    name,
    status,
    conclusion,
    started_at: seconds === null ? null : '2026-10-18T08:58:00.000Z',
    completed_at:
      seconds === null
        ? null
        : new Date(Date.parse('2026-10-18T08:58:00.000Z') + seconds * 1000).toISOString(),
  };
}

function shipped(over: Raw = {}): Raw {
  return {
    commits: 2,
    commit_decision: null,
    merge_commit: null,
    push: { state: 'pushed', branch: 'feat/ORD-501-csv-export', sha: 'aaa1111' },
    pr: OPEN_PR,
    pr_state: 'open',
    pr_title: 'Add CSV export to the orders page',
    pr_additions: 412,
    pr_deletions: 87,
    files_changed: 14,
    commit_list: COMMITS,
    inherited_count: 1,
    all_green: false,
    merged: false,
    ...over,
  };
}

const DELIVERING_STAGES = stages(
  { ...ALL_DONE, delivery: 'running' },
  { delivery: '2026-10-18T08:57:00.000Z' },
);

export const SCENE_FIXTURES = {
  'High Table writing': ord501At('writing'),
  Building: snapshot({
    ...FULL_ORD_501,
    headline: {
      text: 'Building',
      tone: 'working',
      row: 15,
      word: 'Working',
      clock_from: '2026-10-18T08:55:00.000Z',
    },
    stages: stages(
      { planning: 'complete', specification: 'complete', development: 'running' },
      { development: '2026-10-18T08:55:00.000Z' },
    ),
    flags: [],
    findings: null,
    verdict: null,
    receipt: null,
    delivery_plan: FULL_DELIVERY,
    ship: shipped({
      push: null,
      pr: null,
      pr_state: null,
      commits: 1,
      commit_list: COMMITS.slice(0, 1),
    }),
  }),
  'Needs you': ord501At('ruled'),
  'Shipping with CI live': snapshot({
    ...FULL_ORD_501,
    headline: {
      text: `Watching CI on PR ${'#'}12`,
      tone: 'working',
      row: 14,
      word: 'Working',
      clock_from: '2026-10-18T08:57:00.000Z',
    },
    stages: DELIVERING_STAGES,
    flags: [],
    delivery_plan: FULL_DELIVERY,
    ship: shipped({
      ci: {
        sha: 'aaa1111',
        state: 'pending',
        done: 3,
        total: 6,
        reason: null,
        source: 'deliver',
        jobs: [
          job('Lint and types', 'completed', 'success', 38),
          job('Unit 1 of 3', 'completed', 'success', 64),
          job('Unit 2 of 3', 'completed', 'success', 71),
          job('Unit 3 of 3', 'in_progress', null, null),
          job('End to end', 'in_progress', null, null),
          job('Windows', 'queued', null, null),
        ],
      },
    }),
  }),
  Failed: snapshot({
    ...FULL_ORD_501,
    headline: {
      text: 'Tests, types or lint failed',
      tone: 'bad',
      row: 12,
      word: 'Needs your attention',
    },
    stages: stages({ ...ALL_DONE, checks: 'failed' }),
    gates: [
      { name: 'code-tests-lint', required: true, strength: 'deterministic', verdict: 'fail' },
      { name: 'duplication', required: true, strength: 'deterministic', verdict: 'pass' },
    ],
    flags: [],
    verdict: verdict('fail', 'Needs your attention', ['code-tests-lint: 3 tests failed']),
  }),
  'All green': snapshot({
    ...FULL_ORD_501,
    headline: {
      text: `Safe to merge: PR ${'#'}12 is ready for your merge`,
      tone: 'good',
      row: 8,
      word: 'Safe to merge',
      rung: 'safe-to-merge',
    },
    rung: 'safe-to-merge',
    flags: [],
    stages: DELIVERING_STAGES,
    delivery_plan: FULL_DELIVERY,
    ship: shipped({
      ci: {
        sha: 'aaa1111',
        state: 'pass',
        done: 6,
        total: 6,
        reason: null,
        source: 'stop-check',
        jobs: [
          job('Lint and types', 'completed', 'success', 38),
          job('Unit', 'completed', 'success', 96),
        ],
      },
      all_green: true,
    }),
  }),
  'Fast lane': FAST_ORD_490,
  'Edit only': snapshot({
    ...FAST_ORD_490,
    headline: {
      text: 'Done',
      tone: 'good',
      row: 16,
      word: 'Done',
      rung: 'done',
      note: 'left uncommitted, as you asked',
    },
    rung: 'done',
    stages: stages({ planning: 'complete', development: 'complete', checks: 'complete' }),
    gates: [
      { name: 'code-tests-lint', required: true, strength: 'deterministic', verdict: 'pass' },
    ],
    delivery_plan: {
      commit: false,
      push: false,
      pr: false,
      ci: false,
      merge: false,
      reason: 'edit only',
    },
    ship: shipped({
      commits: 0,
      commit_decision: 'decline',
      push: null,
      pr: null,
      pr_state: null,
      commit_list: [],
      files_changed: 1,
    }),
    verdict: verdict('pass', 'Safe to merge'),
  }),
  'No CI': snapshot({
    ...FULL_ORD_501,
    headline: {
      text: 'Delivering',
      tone: 'working',
      row: 15,
      word: 'Working',
      clock_from: '2026-10-18T08:57:00.000Z',
    },
    flags: [],
    stages: DELIVERING_STAGES,
    delivery_plan: { ...FULL_DELIVERY, ci: false },
    ship: shipped(),
  }),
  Closed: FULL_ORD_501,
  Question: snapshot({
    ...OTHER_WORKFLOW,
    workflow: {
      name: 'project-question',
      started_at: '2026-10-18T08:50:00.000Z',
      tokens: 84000,
      usd: 0.05,
      unpriced: [],
    },
  }),
  'Health check': snapshot({
    ...OTHER_WORKFLOW,
    route: 'codebase-health',
    headline: { text: 'Working on codebase health.', tone: 'working' },
    workflow: {
      name: 'codebase-health',
      started_at: '2026-10-18T08:40:00.000Z',
      tokens: null,
      usd: null,
      unpriced: [],
    },
  }),
} as const;
