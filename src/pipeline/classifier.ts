import { stripTrailingChars } from '@/core/path-utils.js';
import { getPrimaryStack } from '@/core/stack-profile.js';
import type {
  ClassificationResult,
  ClassificationScope,
  ClassificationWorkflow,
  ResolutionMap,
  TargetCapability,
  WorkflowSource,
} from '@/core/types/classification.js';
import type { Domain, Stack } from '@/core/types/domain.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';
import {
  applyActiveImplementationSession,
  readActiveImplementationSession,
} from '@/session/active-implementation.js';

import { computeClassificationConfidence } from './confidence-scorer.js';
import { PostClassifier } from './post-classifier.js';
import { PreClassifier } from './pre-classifier.js';
import { shouldSkipLlm } from './llm-skip-evaluator.js';
import { resolveFrameworkConfig } from '@/core/framework-config.js';
import { resolveAnalyticsGate } from '@/analytics/gate.js';
import type { AnalyticsGateStatus } from '@/core/types/classification.js';

export interface ClassifierInput {
  request: string;
  profile?: Pick<
    ProjectProfile,
    'active_capabilities' | 'intelligence' | 'stack_profile' | 'routing'
  >;
  resolved_workflow?: {
    workflow: ClassificationWorkflow | null;
    custom_workflow_name?: string | null;
    workflow_source?: WorkflowSource;
    workflow_reason?: string | null;
    matched_rule?: string | null;
  };
}

export interface RequestClassifierOptions {
  projectRoot?: string;
}

export class RequestClassifier {
  private readonly projectRoot?: string;

  constructor(options: RequestClassifierOptions = {}) {
    this.projectRoot = options.projectRoot;
  }

  async classify(input: ClassifierInput): Promise<ClassificationResult> {
    const requestText = input.request.trim();
    const preResult = await new PreClassifier(this.projectRoot).classify({
      request: requestText,
      profile: input.profile,
      resolved_workflow: input.resolved_workflow,
    });
    const resolutionMap: ResolutionMap = { ...preResult.resolution_map };
    const baseConfidence = computeClassificationConfidence(resolutionMap);
    const deterministicOnly = shouldSkipLlm(preResult, baseConfidence, requestText, resolutionMap);
    const initialClassification = deterministicOnly
      ? buildFromPreResult(input, preResult, resolutionMap)
      : runReducedScopeClassification(input, preResult, resolutionMap);
    const activeSession = this.projectRoot
      ? await readActiveImplementationSession(this.projectRoot)
      : null;
    const resumed = applyActiveImplementationSession(
      requestText,
      initialClassification,
      activeSession,
      resolutionMap,
    );
    const baseClassification = resumed.classification;
    const enrichedConfidence = computeClassificationConfidence(resolutionMap);
    const adjustments = await new PostClassifier(this.projectRoot).adjust(
      baseClassification,
      preResult,
      resolutionMap,
    );

    // Complementary analytics gate (issue #241), resolved cheapest-first: the flag check is
    // one config read, and OFF short-circuits BEFORE any detection — so with analytics off
    // (the default) this adds no field and does no filesystem scan.
    const analyticsTag = this.resolveAnalyticsTag(baseClassification.workflow);

    return {
      ...baseClassification,
      ...(analyticsTag ? { analytics_tag: analyticsTag } : {}),
      complexity: adjustments.complexity,
      risk: adjustments.risk,
      classification_confidence: enrichedConfidence,
      resolution_map: resolutionMap,
      lane_before_override: adjustments.lane_before_override,
      lane_override_reason: adjustments.lane_override_reason,
      risk_floor: adjustments.risk_floor,
      risk_floor_reason: adjustments.risk_floor_reason,
      complexity_adjustment: adjustments.complexity_adjustment,
      complexity_adjustment_reason: adjustments.complexity_adjustment_reason,
      delta_candidate: preResult.resolved.delta_candidate,
      base_manifest_slug: preResult.resolved.base_manifest_slug,
      prior_requirement_count: preResult.resolved.prior_requirement_count,
      prior_criterion_count: preResult.resolved.prior_criterion_count,
      context_budget_hint: preResult.resolved.context_budget_hint,
      affected_modules_source: preResult.resolved.affected_modules_source,
      scope_graph_depth: preResult.resolved.scope_graph_depth,
      matched_rule_triggers: preResult.resolved.matched_rule_triggers,
      resumed_from_session: baseClassification.resumed_from_session,
      resume_lane: baseClassification.resume_lane,
      workflow_continuity_reason: baseClassification.workflow_continuity_reason,
    };
  }

  /**
   * Resolve the analytics tag (issue #241). Returns undefined (no field, no fs scan) when
   * there is no project root or the `analytics_instrumentation` flag is off — the common
   * case. Only when the flag is on do we run the gate (which then detects a provider).
   * Best-effort: any config/detection failure yields undefined, never a thrown classify.
   */
  private resolveAnalyticsTag(
    workflow: ClassificationWorkflow | null,
  ): AnalyticsGateStatus | undefined {
    if (!this.projectRoot) {
      return undefined;
    }
    try {
      const flagEnabled = resolveFrameworkConfig(this.projectRoot).features
        .analytics_instrumentation;
      if (!flagEnabled) {
        return undefined;
      }
      return resolveAnalyticsGate({
        projectRoot: this.projectRoot,
        flagEnabled: true,
        changeIsFeatureShaped: workflow === 'feature-development',
      }).status;
    } catch {
      return undefined;
    }
  }
}

function buildFromPreResult(
  input: ClassifierInput,
  preResult: Awaited<ReturnType<PreClassifier['classify']>>,
  resolutionMap: ResolutionMap,
): ClassificationResult {
  const requestText = input.request.trim();
  const request = requestText.toLowerCase();
  const workflow = preResult.resolved.workflow ?? input.resolved_workflow?.workflow ?? null;
  const targetCapability = inferTargetCapability(request, workflow);
  const domain = inferDomain(targetCapability, input.profile);
  const stack =
    input.profile !== undefined
      ? getPrimaryStack(input.profile as ProjectProfile)
      : inferStack(targetCapability);
  const databaseImpact = preResult.resolved.database_impact ?? inferDatabaseImpact(request);
  const apiImpact = preResult.resolved.api_impact ?? inferApiImpact(request);
  const uiImpact = preResult.resolved.ui_impact ?? inferUiImpact(request);
  const trivialSingleFile = inferTrivialSingleFile(requestText);
  const complexity = inferComplexity(
    request,
    workflow,
    databaseImpact,
    apiImpact,
    uiImpact,
    trivialSingleFile,
  );
  const risk = inferRisk(workflow, complexity, databaseImpact, apiImpact);
  const scope = preResult.resolved.scope ?? inferScope(workflow, complexity, trivialSingleFile);
  const capabilityGap = inferCapabilityGap(targetCapability, input.profile);

  resolutionMap.complexity ??= 'default';
  resolutionMap.risk ??= 'default';
  resolutionMap.certainty ??= 'default';
  resolutionMap.output_type ??= 'default';

  return {
    request_text: requestText,
    domain,
    stack,
    target_capability: targetCapability,
    capability_gap: capabilityGap,
    workflow,
    custom_workflow_name: input.resolved_workflow?.custom_workflow_name ?? null,
    workflow_source: input.resolved_workflow?.workflow_source ?? 'none',
    workflow_reason: input.resolved_workflow?.workflow_reason ?? null,
    matched_rule: input.resolved_workflow?.matched_rule ?? null,
    complexity,
    risk,
    scope,
    affected_modules:
      preResult.resolved.affected_modules && preResult.resolved.affected_modules.length > 0
        ? preResult.resolved.affected_modules
        : inferModules(requestText, stack),
    process_depth:
      complexity === 'high' || complexity === 'very-high'
        ? 'full lane'
        : complexity === 'medium'
          ? 'graduated lane'
          : 'fast lane',
    certainty: request.includes('?') ? 'partially-defined' : 'well-defined',
    output_type: inferOutputType(workflow),
    database_impact: databaseImpact,
    ui_impact: uiImpact,
    api_impact: apiImpact,
    compliance_sensitivity:
      preResult.resolved.compliance_sensitivity ??
      (request.includes('compliance') || request.includes('gdpr') ? 'high' : 'none'),
    customer_facing_impact:
      preResult.resolved.customer_facing_impact ??
      (request.includes('customer') || uiImpact !== 'none' ? 'customer-visible' : 'internal'),
    reversibility:
      preResult.resolved.reversibility ??
      (databaseImpact === 'data-migration' || apiImpact === 'breaking-change'
        ? 'difficult'
        : 'easily-reversible'),
    data_sensitivity:
      preResult.resolved.data_sensitivity ??
      (request.includes('pii') ? 'pii' : request.includes('payment') ? 'financial' : 'none'),
  };
}

function runReducedScopeClassification(
  input: ClassifierInput,
  preResult: Awaited<ReturnType<PreClassifier['classify']>>,
  resolutionMap: ResolutionMap,
): ClassificationResult {
  const result = buildFromPreResult(input, preResult, resolutionMap);
  for (const dimension of [
    'workflow',
    'affected_modules',
    'scope',
    'database_impact',
    'api_impact',
    'ui_impact',
    'compliance_sensitivity',
    'customer_facing_impact',
    'reversibility',
    'data_sensitivity',
  ]) {
    if (resolutionMap[dimension]?.startsWith('deterministic')) {
      resolutionMap[dimension] = 'llm-confirmed';
    }
  }
  resolutionMap.complexity = 'llm-guessed';
  resolutionMap.risk = 'llm-guessed';
  resolutionMap.certainty = 'llm-guessed';
  resolutionMap.output_type = 'llm-confirmed';
  return result;
}

function inferTargetCapability(
  request: string,
  workflow: ClassificationWorkflow | null,
): TargetCapability {
  if (workflow === 'pentest' || workflow === 'pentest-retest') {
    return 'security';
  }

  if (
    workflow === 'documentation-update' ||
    workflow === 'project-question' ||
    workflow === 'writing' ||
    workflow === 'editing' ||
    workflow === 'planning' ||
    workflow === 'research'
  ) {
    return 'content';
  }

  if (workflow === null) {
    if (request.includes('pentest') || request.includes('security')) {
      return 'security';
    }

    if (
      request.includes('documentation') ||
      request.includes('content') ||
      request.includes('docs')
    ) {
      return 'content';
    }
  }

  return 'coding';
}

function inferDomain(
  targetCapability: TargetCapability,
  profile?: Pick<ProjectProfile, 'active_capabilities' | 'stack_profile' | 'routing'>,
): Domain {
  if (profile !== undefined) {
    const stack = getPrimaryStack(profile as ProjectProfile);
    if (stack !== 'short-video') {
      return 'coding';
    }
  }

  return targetCapability === 'content' ? 'content' : 'coding';
}

function inferStack(targetCapability: TargetCapability): Stack {
  return targetCapability === 'content' ? 'short-video' : 'laravel';
}

function inferOutputType(
  workflow: ClassificationWorkflow | null,
): ClassificationResult['output_type'] {
  if (
    workflow === 'documentation-update' ||
    workflow === 'writing' ||
    workflow === 'editing' ||
    workflow === 'planning'
  ) {
    return 'documentation';
  }

  if (workflow === 'project-question' || workflow === 'research' || workflow === null) {
    return 'analysis';
  }

  if (
    workflow === 'pentest' ||
    workflow === 'pentest-retest' ||
    workflow === 'root-cause-analysis'
  ) {
    return 'report';
  }

  return 'code';
}

function inferCapabilityGap(
  targetCapability: TargetCapability,
  profile?: Pick<ProjectProfile, 'active_capabilities' | 'routing'>,
): boolean {
  const activeCapabilities = new Set(
    profile?.active_capabilities ??
      (profile?.routing?.domain === 'coding' ? ['content', 'coding', 'security'] : ['content']),
  );

  if (targetCapability === 'content') {
    return false;
  }

  if (targetCapability === 'security') {
    return !activeCapabilities.has('security');
  }

  return !activeCapabilities.has('coding');
}

function inferDatabaseImpact(request: string): ClassificationResult['database_impact'] {
  if (request.includes('data migration')) {
    return 'data-migration';
  }

  if (
    request.includes('migration') ||
    request.includes('schema') ||
    request.includes('column') ||
    request.includes('table')
  ) {
    return 'schema-change';
  }

  if (request.includes('query') || request.includes('index')) {
    return 'query-change';
  }

  return 'none';
}

function inferApiImpact(request: string): ClassificationResult['api_impact'] {
  if (request.includes('breaking api') || request.includes('breaking endpoint')) {
    return 'breaking-change';
  }

  if (request.includes('api') || request.includes('endpoint') || request.includes('route')) {
    return request.includes('modify') || request.includes('update')
      ? 'modified-endpoint'
      : 'additive-endpoint';
  }

  return 'none';
}

function inferUiImpact(request: string): ClassificationResult['ui_impact'] {
  if (request.includes('redesign')) {
    return 'redesign';
  }

  if (request.includes('screen') || request.includes('dashboard') || request.includes('page')) {
    return 'new-screen';
  }

  if (request.includes('component') || request.includes('button') || request.includes('form')) {
    return 'new-component';
  }

  return 'none';
}

function inferComplexity(
  request: string,
  workflow: ClassificationWorkflow | null,
  databaseImpact: ClassificationResult['database_impact'],
  apiImpact: ClassificationResult['api_impact'],
  uiImpact: ClassificationResult['ui_impact'],
  trivialSingleFile: boolean,
): ClassificationResult['complexity'] {
  if (trivialSingleFile || isTrivialRequest(request)) {
    return 'trivial';
  }

  if (workflow === 'pentest' || workflow === 'pentest-retest') {
    return 'high';
  }

  if (workflow === 'documentation-update' || workflow === 'root-cause-analysis') {
    return 'medium';
  }

  if (workflow === 'project-question' || workflow === 'research' || workflow === null) {
    return 'low';
  }

  if (
    databaseImpact === 'schema-change' ||
    databaseImpact === 'data-migration' ||
    apiImpact === 'breaking-change' ||
    uiImpact === 'redesign'
  ) {
    return 'high';
  }

  if (apiImpact !== 'none' || uiImpact !== 'none') {
    return 'medium';
  }

  return 'low';
}

function inferRisk(
  workflow: ClassificationWorkflow | null,
  complexity: ClassificationResult['complexity'],
  databaseImpact: ClassificationResult['database_impact'],
  apiImpact: ClassificationResult['api_impact'],
): ClassificationResult['risk'] {
  if (workflow === 'pentest' || workflow === 'pentest-retest') {
    return 'high';
  }

  if (
    complexity === 'high' ||
    complexity === 'very-high' ||
    databaseImpact === 'schema-change' ||
    databaseImpact === 'data-migration' ||
    apiImpact === 'breaking-change'
  ) {
    return 'high';
  }

  return complexity === 'medium' ? 'medium' : 'low';
}

function inferScope(
  workflow: ClassificationWorkflow | null,
  complexity: ClassificationResult['complexity'],
  trivialSingleFile: boolean,
): ClassificationScope {
  if (trivialSingleFile || complexity === 'trivial') {
    return 'single-file';
  }

  if (workflow === 'documentation-update') {
    return 'system-wide';
  }

  if (complexity === 'high' || complexity === 'very-high') {
    return 'system-wide';
  }

  if (complexity === 'medium') {
    return 'multi-module';
  }

  return 'single-module';
}

function inferTrivialSingleFile(request: string): boolean {
  const normalized = request.toLowerCase();
  const explicitPrefixes = extractExplicitModulePrefixes(request);
  const singleExplicitFile =
    explicitPrefixes.length === 1 &&
    /\.(tsx?|jsx?|vue|svelte|astro|php|dart|py|rb|go|rs|java|kt|cs|md)$/i.test(request);

  if (singleExplicitFile && isTrivialRequest(normalized)) {
    return true;
  }

  return (
    isTrivialRequest(normalized) &&
    mentionsAny(normalized, ['file', 'rename', 'cleanup', 'comment', 'typo', 'one-line'])
  );
}

function isTrivialRequest(request: string): boolean {
  return mentionsAny(request, [
    'rename',
    'cleanup',
    'clean up',
    'typo',
    'comment',
    'one-line',
    'one line',
    'small',
    'tiny',
    'minor',
  ]);
}

function inferModules(request: string, stack: Stack): string[] {
  const explicitPrefixes = extractExplicitModulePrefixes(request);
  if (explicitPrefixes.length > 0) {
    return explicitPrefixes;
  }

  return inferStackAwareModulePrefixes(request.toLowerCase(), stack);
}

function extractExplicitModulePrefixes(request: string): string[] {
  const matches =
    request.match(
      /\b(?:src|app|resources|database|routes|lib|tests|docs|packages)\/[A-Za-z0-9_./-]+\b/g,
    ) ?? [];

  return Array.from(
    new Set(
      matches.map((match) =>
        stripTrailingChars(
          match
            .replace(/\\/g, '/')
            .replace(/\.(tsx?|jsx?|vue|svelte|astro|php|dart|py|rb|go|rs|java|kt|cs|md)$/i, ''),
          '/',
        ),
      ),
    ),
  ).slice(0, 3);
}

function inferStackAwareModulePrefixes(request: string, stack: Stack): string[] {
  const prefixes: string[] = [];

  if (mentionsAny(request, ['migration', 'schema', 'table', 'column'])) {
    prefixes.push('database/migrations');
  }

  if (mentionsAny(request, ['api', 'endpoint', 'route', 'controller'])) {
    prefixes.push(...apiModulePrefixesForStack(stack));
  }

  if (mentionsAny(request, ['dashboard', 'page', 'screen', 'view'])) {
    prefixes.push(...screenModulePrefixesForStack(stack));
  }

  if (mentionsAny(request, ['component', 'button', 'form', 'widget'])) {
    prefixes.push(...componentModulePrefixesForStack(stack));
  }

  return Array.from(new Set(prefixes)).slice(0, 3);
}

function mentionsAny(request: string, tokens: string[]): boolean {
  return tokens.some((token) => request.includes(token));
}

function apiModulePrefixesForStack(stack: Stack): string[] {
  switch (stack) {
    case 'laravel':
      return ['app/Http/Controllers', 'routes'];
    case 'django':
    case 'fastapi':
      return ['app/api', 'app/routes'];
    case 'flutter':
      return ['lib/services'];
    default:
      return ['src/api', 'src/server'];
  }
}

function screenModulePrefixesForStack(stack: Stack): string[] {
  switch (stack) {
    case 'laravel':
      return ['resources/views', 'resources/js/pages'];
    case 'flutter':
      return ['lib/screens'];
    default:
      return ['src/pages', 'src/screens'];
  }
}

function componentModulePrefixesForStack(stack: Stack): string[] {
  switch (stack) {
    case 'laravel':
      return ['resources/js/components', 'app/View/Components'];
    case 'flutter':
      return ['lib/widgets'];
    default:
      return ['src/components'];
  }
}
