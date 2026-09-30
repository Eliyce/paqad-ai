import type { ClassificationWorkflow, ResolutionMap } from '@/core/types/classification.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';
import type { PreClassificationResult } from '@/core/types/pre-classification.js';
import { detectDecisionForks } from '@/planning/decision-detector.js';

import { estimateContextBudgetHint } from './context-budget-estimator.js';
import { detectDeltaCandidate } from './delta-detector.js';
import { resolveImpacts } from './impact-resolver.js';
import { ModuleResolver } from './module-resolver.js';
import { matchRuleTriggers } from './rule-trigger-matcher.js';
import { resolveScope } from './scope-resolver.js';

interface WorkflowPattern {
  workflow: ClassificationWorkflow;
  priority: number;
  patterns: string[];
}

// The NAMED workflows (pentest, health, site-map, RCA, docs, research). These keep their
// current priority ABOVE the project-question check (issue #580 FR-2) and are matched as
// substrings, unchanged — their patterns are already whole phrases, so a question like
// "can you check my project's health?" still resolves to codebase-health here, before the
// question fallback ever runs.
const WORKFLOW_PATTERNS: WorkflowPattern[] = [
  { workflow: 'pentest-retest', priority: 250, patterns: ['pentest retest', 'pentest-retest'] },
  {
    workflow: 'pentest',
    priority: 240,
    patterns: ['run a pentest', 'penetration test', 'security audit'],
  },
  {
    workflow: 'health-retest',
    priority: 245,
    patterns: ['health retest', 'health-retest', 'codebase health retest'],
  },
  {
    workflow: 'codebase-health',
    priority: 235,
    // Kept below pentest (240) so "security audit" stays pentest; phrasings are
    // audit-flavoured so a "fix the bug" cleanup does not get stolen.
    patterns: [
      'codebase health',
      'code health',
      'health check',
      'health check-up',
      'health audit',
      "project's health",
      'project health',
      'audit my codebase',
      'audit the codebase',
      'find dead code',
      'check for unused',
      'cleanup audit',
    ],
  },
  {
    workflow: 'site-map-retest',
    priority: 233,
    patterns: ['site map retest', 'site-map retest', 'retest the site map', 'retest site map'],
  },
  {
    workflow: 'site-map',
    priority: 232,
    // Two-word "site map" is the doc sense; one-word "sitemap" is only ever verb-
    // qualified so a literal sitemap.xml feature request stays feature-development.
    patterns: ['site map', 'create sitemap', 'update sitemap', 'generate sitemap', 'journey map'],
  },
  { workflow: 'root-cause-analysis', priority: 230, patterns: ['root cause', 'rca'] },
  {
    workflow: 'module-documentation',
    priority: 225,
    patterns: ['module documentation', 'module docs', 'per module docs'],
  },
  {
    workflow: 'documentation-update',
    priority: 200,
    patterns: ['documentation', 'docs', 'documenation'],
  },
  { workflow: 'research', priority: 180, patterns: ['research', 'investigate'] },
];

// The CODE-CHANGE keywords (issue #580 FR-1). These run AFTER the project-question check
// (FR-2) and are matched as WHOLE-WORD tokens, never substrings — so `add` no longer fires
// inside "address", `fix` inside "prefix", `build` inside "rebuild", or `bug` inside
// "debug". Inflections are listed explicitly rather than grown by substring, so "added"
// matches feature-development while "address" does not (AC-8).
const CODE_CHANGE_PATTERNS: WorkflowPattern[] = [
  { workflow: 'cleanup', priority: 170, patterns: ['cleanup', 'clean up'] },
  {
    workflow: 'bug-fix',
    priority: 160,
    patterns: ['fix', 'fixes', 'fixing', 'fixed', 'bug', 'bugs'],
  },
  {
    workflow: 'feature-development',
    priority: 140,
    patterns: [
      'implement',
      'implements',
      'implementing',
      'implemented',
      'build',
      'builds',
      'building',
      'built',
      'add',
      'adds',
      'adding',
      'added',
      'feature',
      'features',
      'develop',
      'develops',
      'developing',
      'developed',
    ],
  },
];

export interface PreClassifierInput {
  request: string;
  profile?: Pick<ProjectProfile, 'intelligence' | 'stack_profile'>;
  resolved_workflow?: {
    workflow: ClassificationWorkflow | null;
  };
  projectRoot?: string;
}

export class PreClassifier {
  constructor(private readonly projectRoot: string = process.cwd()) {}

  async classify(input: PreClassifierInput): Promise<PreClassificationResult> {
    const resolutionMap: ResolutionMap = {};
    const unresolved = new Set<string>();
    const evidence: string[] = [];
    const detectedForks = detectDecisionForks(input.request);
    const workflow = resolveWorkflow(input.request, input.resolved_workflow?.workflow ?? null);
    if (workflow !== undefined) {
      resolutionMap.workflow = 'deterministic';
      evidence.push(`workflow:${workflow}`);
    } else {
      unresolved.add('workflow');
    }

    const moduleResolver = new ModuleResolver(this.projectRoot, input.profile);
    const modulesPromise = moduleResolver.resolve(input.request);

    const result = await withTimeout(
      (async () => {
        const modules = await modulesPromise;
        const modulePaths = modules.modules.map((entry) => entry.path);
        if (modulePaths.length > 0) {
          resolutionMap.affected_modules =
            modules.source === 'rag' ? 'deterministic:rag' : 'deterministic';
          evidence.push(`modules:${modules.source}`);
        } else {
          unresolved.add('affected_modules');
        }

        const [scope, impacts, delta, ruleTriggers] = await Promise.all([
          resolveScope(this.projectRoot, modulePaths).catch(() => {
            unresolved.add('scope');
            return { scope: 'single-module' as const, scope_graph_depth: 0 };
          }),
          Promise.resolve(resolveImpacts({ requestText: input.request, modulePaths })),
          detectDeltaCandidate(this.projectRoot, modulePaths).catch(() => {
            unresolved.add('delta_candidate');
            return {
              delta_candidate: false,
              base_manifest_slug: null,
              prior_requirement_count: null,
              prior_criterion_count: null,
            };
          }),
          matchRuleTriggers(this.projectRoot, modulePaths).catch(() => {
            unresolved.add('matched_rule_triggers');
            return [];
          }),
        ]);

        resolutionMap.scope = unresolved.has('scope') ? 'default' : 'deterministic:graph';
        resolutionMap.database_impact = impacts.resolution_sources.database_impact;
        resolutionMap.api_impact = impacts.resolution_sources.api_impact;
        resolutionMap.ui_impact = impacts.resolution_sources.ui_impact;
        resolutionMap.compliance_sensitivity = impacts.resolution_sources.compliance_sensitivity;
        resolutionMap.customer_facing_impact = impacts.resolution_sources.customer_facing_impact;
        resolutionMap.reversibility = impacts.resolution_sources.reversibility;
        resolutionMap.data_sensitivity = impacts.resolution_sources.data_sensitivity;
        resolutionMap.delta_candidate = delta.delta_candidate
          ? 'deterministic:manifest'
          : 'default';
        resolutionMap.context_budget_hint = 'deterministic';
        resolutionMap.matched_rule_triggers = ruleTriggers.length > 0 ? 'deterministic' : 'default';

        const normalizedScope =
          modules.source === 'stack-heuristic' && scope.scope === 'single-file'
            ? 'single-module'
            : scope.scope;
        const contextBudgetHint = estimateContextBudgetHint({
          scope: normalizedScope,
          delta_candidate: delta.delta_candidate,
          workflow: workflow ?? null,
        });

        return {
          resolved: {
            workflow: workflow ?? undefined,
            affected_modules: modulePaths,
            affected_modules_source: modules.source,
            scope: normalizedScope,
            scope_graph_depth: scope.scope_graph_depth,
            database_impact: impacts.database_impact,
            api_impact: impacts.api_impact,
            ui_impact: impacts.ui_impact,
            compliance_sensitivity: impacts.compliance_sensitivity,
            customer_facing_impact: impacts.customer_facing_impact,
            reversibility: impacts.reversibility,
            data_sensitivity: impacts.data_sensitivity,
            delta_candidate: delta.delta_candidate,
            base_manifest_slug: delta.base_manifest_slug,
            prior_requirement_count: delta.prior_requirement_count,
            prior_criterion_count: delta.prior_criterion_count,
            context_budget_hint: contextBudgetHint,
            matched_rule_triggers: ruleTriggers,
            decision_category: detectedForks[0]?.category,
          },
          hints: {},
          unresolved: Array.from(unresolved),
          resolution_map: resolutionMap,
          evidence: [
            ...evidence,
            ...detectedForks.map((fork) => `decision-fork:${fork.category}:${fork.signal}`),
          ],
          detected_forks: detectedForks,
        } satisfies PreClassificationResult;
      })(),
      300,
      {
        resolved: {
          workflow: workflow ?? undefined,
          affected_modules: [],
          affected_modules_source: 'default',
          scope: 'single-module',
          scope_graph_depth: 0,
          database_impact: 'none',
          api_impact: 'none',
          ui_impact: 'none',
          compliance_sensitivity: 'none',
          customer_facing_impact: 'internal',
          reversibility: 'easily-reversible',
          data_sensitivity: 'none',
          delta_candidate: false,
          base_manifest_slug: null,
          prior_requirement_count: null,
          prior_criterion_count: null,
          context_budget_hint: 'minimal',
          matched_rule_triggers: [],
          decision_category: detectedForks[0]?.category,
        },
        hints: {},
        unresolved: [
          'affected_modules',
          'scope',
          'delta_candidate',
          'database_impact',
          'api_impact',
          'ui_impact',
          'matched_rule_triggers',
        ],
        resolution_map: resolutionMap,
        evidence: [
          ...evidence,
          ...detectedForks.map((fork) => `decision-fork:${fork.category}:${fork.signal}`),
          'timeout',
        ],
        detected_forks: detectedForks,
      } satisfies PreClassificationResult,
    );

    return result;
  }
}

function resolveWorkflow(
  requestText: string,
  routedWorkflow: ClassificationWorkflow | null,
): ClassificationWorkflow | undefined {
  if (routedWorkflow !== undefined && routedWorkflow !== null) {
    return routedWorkflow;
  }

  const normalized = normalizeText(requestText);

  // 1. NAMED workflows first — unchanged priority and substring match (issue #580 FR-2), so a
  //    "check my project's health" or "run a pentest" resolves before the question check.
  const named = highestMatch(WORKFLOW_PATTERNS, (pattern) =>
    normalized.includes(normalizeText(pattern)),
  );
  if (named) {
    return named;
  }

  // 2. A question about the codebase beats the code-change keywords (issue #580 FR-2/FR-3):
  //    "Why does the prefix get dropped?" is a question, not a bug fix. An explicit "don't
  //    code" or "file an issue" ask is also a project-question (FR-4/FR-5). All of these run
  //    BEFORE the code-change tier, and a polite code request ("Can you add a logout button?")
  //    is deliberately excluded so it still routes to feature-development (AC-2).
  if (
    isQuestionRoute(requestText) ||
    hasCodeNegation(normalized) ||
    isCreateArtifactAsk(normalized)
  ) {
    return 'project-question';
  }

  // 3. CODE-CHANGE keywords, matched as whole words (issue #580 FR-1).
  const codeChange = highestMatch(CODE_CHANGE_PATTERNS, (pattern) =>
    matchesWholeWord(normalized, pattern),
  );
  if (codeChange) {
    return codeChange;
  }

  return undefined;
}

/** The highest-priority workflow whose any pattern satisfies `matches`, or undefined. */
function highestMatch(
  table: readonly WorkflowPattern[],
  matches: (pattern: string) => boolean,
): ClassificationWorkflow | undefined {
  return table
    .flatMap((entry) =>
      entry.patterns
        .filter(matches)
        .map((pattern) => ({ workflow: entry.workflow, priority: entry.priority, pattern })),
    )
    .sort((left, right) => right.priority - left.priority)[0]?.workflow;
}

/** Whether `pattern` appears as a whole-word token sequence in the normalized text. */
function matchesWholeWord(normalized: string, pattern: string): boolean {
  return ` ${normalized} `.includes(` ${normalizeText(pattern)} `);
}

/** Strong interrogatives that mark a question wherever they appear (issue #576 / #580 FR-3). */
const QUESTION_ANYWHERE_LEADS = new Set([
  'how',
  'where',
  'what',
  'whats',
  'why',
  'which',
  'explain',
  'example',
]);

/** Code verbs (with inflections) whose imperative use marks a polite CODE request, not a question. */
const CODE_VERBS = new Set([
  'fix',
  'fixes',
  'fixing',
  'fixed',
  'add',
  'adds',
  'adding',
  'added',
  'implement',
  'implements',
  'implementing',
  'implemented',
  'build',
  'builds',
  'building',
  'built',
  'refactor',
  'refactors',
  'refactoring',
  'refactored',
  'change',
  'changes',
  'changing',
  'changed',
  'update',
  'updates',
  'updating',
  'updated',
  'remove',
  'removes',
  'removing',
  'removed',
  'rename',
  'renames',
  'renaming',
  'renamed',
  'migrate',
  'migrates',
  'migrating',
  'migrated',
]);

/** Lead-ins after which a code verb is a polite request to change code (issue #580 FR-3). */
const POLITE_LEAD_INS = ['can you', 'could you', 'would you', 'please', 'let s'];

/**
 * Whether the request is a QUESTION about the codebase rather than an ask to change it
 * (issue #580 FR-3). True when it carries a strong wh-word anywhere (`explain how the cart
 * works`), opens with `in short`/`show me`, or ends with `?` — AND is not a polite code
 * request. The auxiliary leads FR-3 lists (`is`, `does`, `can`, …) are recognized by their
 * trailing `?`, not as a bare first token, so an imperative like "do the thing" is never
 * read as a question. Exported so the rule can be table-tested on its own. Takes the RAW
 * request because `?` is stripped by normalization.
 */
export function isQuestionRoute(requestText: string): boolean {
  const normalized = normalizeText(requestText);
  const tokens = normalized.length > 0 ? normalized.split(' ') : [];
  const interrogative =
    tokens.some((token) => QUESTION_ANYWHERE_LEADS.has(token)) ||
    normalized.startsWith('in short') ||
    normalized.includes('show me') ||
    /\?\s*$/.test(requestText);
  return interrogative && !isPoliteCodeRequest(normalized);
}

/**
 * Whether a code verb starts a clause or follows a polite lead-in ("can you fix …", "please
 * add …") — the marker of a polite REQUEST to change code, which must stay feature-development
 * even when it ends with `?` (issue #580 FR-3, AC-2).
 */
function isPoliteCodeRequest(normalized: string): boolean {
  const tokens = normalized.length > 0 ? normalized.split(' ') : [];
  if (tokens[0] && CODE_VERBS.has(tokens[0])) {
    return true;
  }
  return POLITE_LEAD_INS.some((lead) => {
    const next = normalized.split(`${lead} `)[1]?.split(' ')[0];
    return next !== undefined && CODE_VERBS.has(next);
  });
}

/** Phrases that explicitly forbid code changes → project-question (issue #580 FR-4). */
const CODE_NEGATIONS = [
  'no code changes',
  'no code change',
  'no code',
  'do not code',
  'dont code',
  'without changing',
  'not to code',
];

/** Whether the request explicitly asks for no code change (issue #580 FR-4). */
export function hasCodeNegation(normalized: string): boolean {
  return CODE_NEGATIONS.some((phrase) => normalized.includes(normalizeText(phrase)));
}

const CREATE_VERBS = ['create', 'file', 'open', 'write', 'draft'];
const ARTIFACT_NOUNS = ['issue', 'ticket', 'bug report', 'write up'];

/**
 * Whether the request asks to author a text artifact — an issue, ticket, or write-up — which
 * produces text, not code, so it routes to project-question (issue #580 FR-5). Suppressed when
 * the same prompt also asks to implement something, so "file an issue and implement the fix"
 * stays feature-development.
 */
export function isCreateArtifactAsk(normalized: string): boolean {
  const hasCreateVerb = CREATE_VERBS.some((verb) => matchesWholeWord(normalized, verb));
  const hasArtifactNoun = ARTIFACT_NOUNS.some((noun) => normalized.includes(normalizeText(noun)));
  if (!hasCreateVerb || !hasArtifactNoun) {
    return false;
  }
  const alsoImplements = /\b(implement|and (?:fix|add|build|change|update))\b/.test(normalized);
  return !alsoImplements;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
