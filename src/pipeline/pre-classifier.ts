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

const WORKFLOW_PATTERNS: Array<{
  workflow: ClassificationWorkflow;
  priority: number;
  patterns: string[];
}> = [
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
  { workflow: 'cleanup', priority: 170, patterns: ['cleanup', 'clean up'] },
  { workflow: 'bug-fix', priority: 160, patterns: ['fix', 'bug'] },
  {
    workflow: 'feature-development',
    priority: 140,
    patterns: ['implement', 'build', 'add', 'feature', 'develop'],
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
  const winner = WORKFLOW_PATTERNS.flatMap((entry) =>
    entry.patterns
      .filter((pattern) => normalized.includes(normalizeText(pattern)))
      .map((pattern) => ({ workflow: entry.workflow, priority: entry.priority, pattern })),
  ).sort((left, right) => right.priority - left.priority)[0];

  return winner?.workflow;
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
