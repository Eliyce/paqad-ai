import { Minimatch } from 'minimatch';

export type WorkstreamRisk = 'high' | 'routine';

export interface WorkstreamSeam {
  name: string;
  entry_file: string;
  wired_ac: string;
}

export interface Workstream {
  id: string;
  owned_files: string[];
  acs: string[];
  depends_on: string[];
  provides_seams: WorkstreamSeam[];
  uses_seams: string[];
  risk: WorkstreamRisk;
  size_budget: { files: number };
}

export interface JoiningEntry {
  id: string;
  area: JoiningArea;
  owned_files: string[];
}

export type JoiningArea = 'wiring' | 'gate-configs' | 'docs' | 'view' | 'lint-cleanup';

export type SlicingRule =
  | 'one-owner'
  | 'seam-only'
  | 'acs-in-own-tests'
  | 'acyclic'
  | 'size-budget'
  | 'module-map'
  | 'routine-on-sensitive';

export interface SlicingViolation {
  rule: SlicingRule;
  subject: string;
}

export interface SlicingInput {
  workstreams: readonly Partial<Workstream>[];
  stepFiles: readonly string[];
  criteria: readonly string[] | null;
  moduleOf: (file: string) => string | null;
  cores: number;
}

export interface SlicingResult {
  violations: SlicingViolation[];
  workstreams: Workstream[];
  waves: string[][];
  joining: JoiningEntry[];
}

export const WAVE_CAP_MAX = 6;
export const WAVE_CAP_MIN = 2;
export const JOINING_AREAS: readonly JoiningArea[] = ['wiring', 'gate-configs', 'docs', 'view'];
export const LINT_CLEANUP_ID = 'join-lint-cleanup';
export const SENSITIVE_PATH_PATTERNS: readonly string[] = [
  '**/auth/**',
  '**/*auth.*',
  '**/*signing*',
  '**/*signature*',
  '**/secrets/**',
  '**/*secret*',
  '**/*credential*',
  '**/*guard*',
  '**/*-gate.mjs',
  'runtime/hooks/**',
];

const TEST_GLOB = /(^|\/)(tests?|__tests__)(\/|$)|[._-](test|spec)\b|_test\./;

export function waveCap(cores: number): number {
  return Math.min(WAVE_CAP_MAX, Math.max(WAVE_CAP_MIN, Math.floor(cores / 2)));
}

const matchers = new Map<string, Minimatch>();

export function matchesGlob(file: string, glob: string): boolean {
  let matcher = matchers.get(glob);
  if (!matcher) {
    matcher = new Minimatch(glob, { dot: true });
    matchers.set(glob, matcher);
  }
  return matcher.match(file);
}

export function ownsFile(workstream: Pick<Workstream, 'owned_files'>, file: string): boolean {
  return workstream.owned_files.some((glob) => matchesGlob(file, glob));
}

export function normalizeWorkstream(raw: Partial<Workstream>): Workstream {
  return {
    id: String(raw.id ?? ''),
    owned_files: [...(raw.owned_files ?? [])],
    acs: [...(raw.acs ?? [])],
    depends_on: [...(raw.depends_on ?? [])],
    provides_seams: [...(raw.provides_seams ?? [])],
    uses_seams: [...(raw.uses_seams ?? [])],
    risk: raw.risk === 'routine' ? 'routine' : 'high',
    size_budget: { files: raw.size_budget?.files ?? Number.POSITIVE_INFINITY },
  };
}

export function isSensitivePath(file: string): boolean {
  return SENSITIVE_PATH_PATTERNS.some((glob) => matchesGlob(file, glob));
}

export function joiningAreaOf(file: string): JoiningArea {
  if (file.startsWith('docs/') || file.endsWith('.md')) return 'docs';
  if (
    file.startsWith('.paqad/') ||
    /\.(ya?ml|toml)$/.test(file) ||
    /(^|\/)[^/]*config[^/]*\.(json|[cm]?[jt]s)$/.test(file)
  ) {
    return 'gate-configs';
  }
  if (/\.(tsx|jsx|vue|svelte|css|scss|html)$/.test(file) || /(^|\/)(hud|view|ui)\//.test(file)) {
    return 'view';
  }
  return 'wiring';
}

export function computeWaves(workstreams: readonly Workstream[], cores: number): string[][] {
  const cap = waveCap(cores);
  const ids = new Set(workstreams.map((w) => w.id));
  const done = new Set<string>();
  const waves: string[][] = [];
  let remaining = workstreams.map((w) => w.id);
  while (remaining.length > 0) {
    const ready = remaining.filter((id) =>
      workstreams
        .find((w) => w.id === id)!
        .depends_on.every((dep) => !ids.has(dep) || done.has(dep)),
    );
    if (ready.length === 0) break;
    for (let i = 0; i < ready.length; i += cap) waves.push(ready.slice(i, i + cap));
    for (const id of ready) done.add(id);
    remaining = remaining.filter((id) => !done.has(id));
  }
  return waves;
}

function findCycle(workstreams: readonly Workstream[]): string[] | null {
  const byId = new Map(workstreams.map((w) => [w.id, w]));
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === 'done') return null;
    if (state.get(id) === 'visiting') return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 'visiting');
    stack.push(id);
    for (const dep of byId.get(id)?.depends_on ?? []) {
      if (!byId.has(dep)) continue;
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, 'done');
    return null;
  };
  for (const w of workstreams) {
    const cycle = visit(w.id);
    if (cycle) return cycle;
  }
  return null;
}

export function validateSlicing(input: SlicingInput): SlicingResult {
  const workstreams = input.workstreams.map(normalizeWorkstream);
  const violations: SlicingViolation[] = [];
  const add = (rule: SlicingRule, subject: string): void => {
    if (!violations.some((v) => v.rule === rule && v.subject === subject)) {
      violations.push({ rule, subject });
    }
  };

  const owned = new Map<string, string[]>();
  const leadFiles: string[] = [];
  for (const file of input.stepFiles) {
    const owners = workstreams.filter((w) => ownsFile(w, file)).map((w) => w.id);
    if (owners.length > 1) add('one-owner', file);
    if (owners.length === 0) leadFiles.push(file);
    for (const id of owners) owned.set(id, [...(owned.get(id) ?? []), file]);
  }

  const providers = new Map<string, string>();
  for (const w of workstreams) for (const seam of w.provides_seams) providers.set(seam.name, w.id);
  for (const w of workstreams) {
    for (const seam of w.uses_seams) {
      const provider = providers.get(seam);
      if (provider !== undefined && provider !== w.id && !w.depends_on.includes(provider)) {
        add('seam-only', w.id);
      }
    }
  }

  const acOwners = new Map<string, string[]>();
  for (const w of workstreams) {
    if (!w.owned_files.some((glob) => TEST_GLOB.test(glob))) add('acs-in-own-tests', w.id);
    for (const ac of w.acs) acOwners.set(ac, [...(acOwners.get(ac) ?? []), w.id]);
  }
  for (const [ac, owners] of acOwners) if (owners.length > 1) add('acs-in-own-tests', ac);
  for (const ac of input.criteria ?? []) if (!acOwners.has(ac)) add('acs-in-own-tests', ac);

  const known = new Set(workstreams.map((w) => w.id));
  for (const w of workstreams) {
    for (const dep of w.depends_on) if (!known.has(dep)) add('acyclic', `${w.id} -> ${dep}`);
  }
  const cycle = findCycle(workstreams);
  if (cycle) add('acyclic', cycle.join(' -> '));

  for (const w of workstreams) {
    const files = owned.get(w.id) ?? [];
    if (files.length > w.size_budget.files) add('size-budget', w.id);
    const modules = new Set(files.map((f) => input.moduleOf(f)).filter((m) => m !== null));
    if (modules.size > 1) add('module-map', w.id);
    if (w.risk === 'routine') {
      for (const file of files) if (isSensitivePath(file)) add('routine-on-sensitive', file);
    }
  }

  const joining: JoiningEntry[] = [];
  for (const area of JOINING_AREAS) {
    const files = leadFiles.filter((f) => joiningAreaOf(f) === area);
    if (files.length > 0) joining.push({ id: `join-${area}`, area, owned_files: files });
  }
  joining.push({ id: LINT_CLEANUP_ID, area: 'lint-cleanup', owned_files: [] });

  return {
    violations,
    workstreams,
    waves: violations.some((v) => v.rule === 'acyclic')
      ? []
      : computeWaves(workstreams, input.cores),
    joining,
  };
}

export function renderSlicingViolation(violation: SlicingViolation): string {
  return `slicing rule ${violation.rule}: ${violation.subject}`;
}

export function seamJoiningEntry(
  seam: WorkstreamSeam,
  joining: readonly JoiningEntry[],
): JoiningEntry | null {
  return (
    joining.find((entry) => entry.owned_files.includes(seam.entry_file)) ??
    joining.find((entry) => entry.area === 'wiring') ??
    null
  );
}

export interface SliceModel {
  model: string;
  effort: string;
  escalated: boolean;
}

export const STRONG_MODEL = 'inherit';
export const ROUTINE_MODEL = 'sonnet';
export const ESCALATE_AFTER_FAILURES = 2;

export function sliceModel(risk: WorkstreamRisk, gateFailures: number): SliceModel {
  if (risk === 'high') return { model: STRONG_MODEL, effort: 'high', escalated: false };
  if (gateFailures >= ESCALATE_AFTER_FAILURES) {
    return { model: STRONG_MODEL, effort: 'high', escalated: true };
  }
  return { model: ROUTINE_MODEL, effort: 'medium', escalated: false };
}

export function sliceOutOfAttempts(risk: WorkstreamRisk, gateFailures: number): boolean {
  return risk === 'high'
    ? gateFailures >= ESCALATE_AFTER_FAILURES
    : gateFailures >= ESCALATE_AFTER_FAILURES + 1;
}
