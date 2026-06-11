import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { basename, dirname as pathDirname } from 'pathe';
import fg from 'fast-glob';

import { PATHS } from '@/core/constants/paths.js';
import { trimEdgeChars } from '@/core/path-utils.js';
import { getRuntimeRoot } from '@/core/runtime-paths.js';
import type {
  HandoffArtifact,
  PipelineAnalysisRole,
  PhaseResult,
  PipelinePhase,
  PipelineResult,
  PipelineRunContext,
} from '@/core/types/pipeline.js';
import { VERSION } from '@/index.js';
import type { ClassificationResult } from '@/core/types/classification.js';
import type { Lane } from '@/core/types/routing.js';
import { readProjectProfile } from '@/core/project-profile.js';
import { Resolver } from '@/resolver/resolver.js';
import type { ResolvedArtifact } from '@/core/types/resolution.js';
import { SkillFrontmatterParser } from '@/skills/frontmatter-parser.js';
import type { RuntimeSkillRegistry } from '@/skills/runtime-registry.js';
import { WorkflowEngine } from '@/workflows/engine.js';
import { StepExecutor, type StepExecutionContext } from '@/workflows/step-executor.js';
import type { WorkflowStep } from '@/workflows/types.js';
import {
  PredictiveCache,
  DEFAULT_PREDICTIVE_CACHE_OPTIONS,
  TransitionLogManager,
  CacheWarmer,
  CacheMetricsTracker,
} from '@/cache/index.js';
import { SkillCacheManager } from '@/skills/cache-manager.js';
import { randomUUID } from 'node:crypto';

import { ClassifyPhase } from './phases/classify.js';
import { AnalysisPhase } from './phases/analysis.js';
import { DocumentationUpdatePhase } from './phases/doc-update.js';
import { ModuleDocumentationPhase } from './phases/module-doc.js';
import { FlowWritingPhase } from './phases/flow-writing.js';
import { ImplementationReviewPhase } from './phases/impl-review.js';
import { ImplementationPhase } from './phases/implementation.js';
import { LoadDocsPhase } from './phases/load-docs.js';
import { PentestPhase } from './phases/pentest.js';
import { PentestRetestPhase } from './phases/pentest-retest.js';
import { ProjectQuestionPhase } from './phases/question-answering.js';
import { RootCauseAnalysisPhase } from './phases/root-cause-analysis.js';
import type { PhaseExecutor } from './phases/phase.interface.js';
import { selectReviewTier as selectImplementationReviewTier } from './phases/impl-review.js';
import {
  selectReviewMode,
  selectReviewTier as selectSpecReviewTier,
  SpecReviewPhase,
} from './phases/spec-review.js';
import { SpecWritingPhase } from './phases/spec-writing.js';
import { StoryPlanningPhase } from './phases/story-planning.js';
import { VerificationPhase } from './phases/verification.js';
import { VerificationLoopPhase } from './phases/verification-loop.js';
import { TraceabilityPhase } from './phases/traceability.js';
import { LANE_PHASES, PipelineRouter } from './router.js';
import { RequestClassifier } from './classifier.js';
import { loadFeatureDevelopmentPolicy } from './feature-development-policy.js';
import { WorkflowRouterService } from './workflow-router.js';
import { loadChangeEvidence } from './change-evidence.js';
import { buildChangeClosureSummary } from './change-closure-summary.js';
import {
  createActiveImplementationSession,
  writeActiveImplementationSession,
} from '@/session/active-implementation.js';
import { appendRunCancelledEvent } from '@/module-decisions/events.js';

const PROJECT_SKILL_ROOTS = ['.codex/skills', '.claude/skills', '.gemini/skills', '.junie/skills'];

export interface LaneRunnerOptions {
  projectRoot?: string;
  phaseOverrides?: Partial<Record<PipelinePhase, PhaseExecutor>>;
  /** Optional registry of runtime-registered skills to merge into the available set. */
  runtimeRegistry?: RuntimeSkillRegistry;
}

/** Per-call options for cancellable pipeline runs (PQD-104). */
export interface LaneRunOptions {
  /**
   * Optional consumer cancellation signal. When it aborts, the run settles at
   * the next phase boundary, resolves with a `PipelineResult` carrying
   * `cancelled: true` and `blocked_at` set to the interrupted phase, writes the
   * handoff artifact with `closure_summary.blocked === true`, and emits a single
   * `run.cancelled` event.
   */
  signal?: AbortSignal;
}

const DEFAULT_PHASES: Record<PipelinePhase, PhaseExecutor> = {
  'request-classification': new ClassifyPhase(),
  'docs-first-load': new LoadDocsPhase(),
  analysis: new AnalysisPhase(),
  'question-answering': new ProjectQuestionPhase(),
  'root-cause-analysis': new RootCauseAnalysisPhase(),
  pentest: new PentestPhase(),
  'pentest-retest': new PentestRetestPhase(),
  'sequence-planning': new StoryPlanningPhase(),
  specification: new SpecWritingPhase(),
  'user-flow': new FlowWritingPhase(),
  'spec-review': new SpecReviewPhase(),
  implementation: new ImplementationPhase(),
  'implementation-review': new ImplementationReviewPhase(),
  // Issue #108 — the single verification pass is wrapped in the bounded, quiet
  // build-check-fix loop. Transparent when the work converges (round 1);
  // emits one honest `stop` report at the lane's round cap / futility limit.
  'verification-gates': new VerificationLoopPhase(new VerificationPhase()),
  // Issue #109 — the documentation-update phase (which runs in every lane and is
  // where docs are reconciled with reality) is wrapped so the bidirectional
  // traceability map is rebuilt each run, lane-gated. Transparent on a clean
  // run; surfaces untested-promise / orphan-code findings as a warning.
  'documentation-update': new TraceabilityPhase(new DocumentationUpdatePhase()),
  'module-documentation': new ModuleDocumentationPhase(),
};

export class LaneRunner {
  private readonly router = new PipelineRouter();
  private readonly projectRoot: string;
  private readonly phases: Record<PipelinePhase, PhaseExecutor>;
  private readonly runtimeRegistry?: RuntimeSkillRegistry;
  private readonly skillParser = new SkillFrontmatterParser();

  constructor(options: LaneRunnerOptions = {}) {
    this.projectRoot = options.projectRoot ?? process.cwd();
    this.runtimeRegistry = options.runtimeRegistry;
    this.phases = {
      ...DEFAULT_PHASES,
      ...options.phaseOverrides,
    };
  }

  async runFullLane(
    classification: ClassificationResult,
    options?: LaneRunOptions,
  ): Promise<PipelineResult> {
    return this.runLane(classification, 'full', options);
  }

  async run(
    classification: ClassificationResult,
    options?: LaneRunOptions,
  ): Promise<PipelineResult> {
    return this.runLane(classification, undefined, options);
  }

  async runRequest(request: string, options?: LaneRunOptions): Promise<PipelineResult> {
    const profile = readProjectProfile(this.projectRoot);
    const route = await new WorkflowRouterService({ projectRoot: this.projectRoot }).resolve(
      request,
      profile,
    );
    const classification = await new RequestClassifier({ projectRoot: this.projectRoot }).classify({
      request,
      profile: profile ?? undefined,
      resolved_workflow: route,
    });

    return this.runLane(classification, undefined, options);
  }

  async runGraduatedLane(
    classification: ClassificationResult,
    options?: LaneRunOptions,
  ): Promise<PipelineResult> {
    return this.runLane(classification, 'graduated', options);
  }

  async runFastLane(
    classification: ClassificationResult,
    options?: LaneRunOptions,
  ): Promise<PipelineResult> {
    return this.runLane(classification, 'fast', options);
  }

  private async runLane(
    classification: ClassificationResult,
    forcedLane?: Lane,
    options?: LaneRunOptions,
  ): Promise<PipelineResult> {
    if (classification.workflow === null) {
      const changeEvidence = await loadChangeEvidence(this.projectRoot);
      await this.writeNullRouteHandoff(classification);
      return {
        lane: null,
        phases: [],
        blocked_at: null,
        handoff_path: join(this.projectRoot, PATHS.HANDOFF),
        analysisRoles: [],
        reviewTier: 'spot-check',
        reviewMode: selectReviewMode(false, 0),
        route_reason: classification.workflow_reason ?? 'No workflow matched the request.',
        closure_summary: buildChangeClosureSummary({
          changed_files: changeEvidence.files,
          phases: [],
        }),
      };
    }

    if (classification.workflow === 'custom') {
      return this.runCustomWorkflow(classification);
    }

    const routed = forcedLane
      ? { lane: forcedLane, phases: [...LANE_PHASES[forcedLane]] }
      : this.router.route(classification);
    const lane = routed.lane ?? selectLaneFromClassification(classification);
    const phases = routed.phases;
    const analysisRoles = resolveAnalysisRoles(lane, classification);
    const reviewTier = selectSpecReviewTier(classification, lane);
    const featurePolicyResult = shouldUseFeatureDevelopmentPolicy(classification.workflow)
      ? loadFeatureDevelopmentPolicy(this.projectRoot, readProjectProfile(this.projectRoot))
      : { policy: null, warnings: [] };
    const context: PipelineRunContext = {
      project_root: this.projectRoot,
      lane,
      classification,
      started_at: new Date().toISOString(),
      phases: [],
      feature_policy: featurePolicyResult.policy,
      policy_warnings: [...featurePolicyResult.warnings],
      signal: options?.signal,
    };
    const runId = randomUUID();

    for (const phaseName of phases) {
      // Cancellation boundary: pre-flight (before the first phase) and between
      // phases. An already-aborted signal returns here without executing any
      // phase (PQD-104).
      if (context.signal?.aborted) {
        return this.cancelLaneRun(phaseName, context, classification, lane, analysisRoles, runId);
      }

      const result = await this.phases[phaseName].execute(context);
      context.phases.push(result);
      await this.writeHandoffArtifact(
        phaseName,
        context.phases,
        classification,
        lane,
        context.policy_warnings,
        context.verification_results,
        context.verification_context,
      );

      // An abort that landed while this phase was running settles the run now.
      if (context.signal?.aborted) {
        return this.cancelLaneRun(phaseName, context, classification, lane, analysisRoles, runId);
      }

      if (result.status === 'fail') {
        return {
          lane,
          phases: context.phases,
          blocked_at: phaseName,
          handoff_path: join(this.projectRoot, PATHS.HANDOFF),
          analysisRoles,
          reviewTier,
          reviewMode: selectReviewMode(false, 0),
          closure_summary: buildChangeClosureSummary({
            changed_files: (await loadChangeEvidence(this.projectRoot)).files,
            phases: context.phases,
            verification_results: context.verification_results,
            verification_context: context.verification_context,
          }),
        };
      }
    }

    const changeEvidence = await loadChangeEvidence(this.projectRoot);
    return {
      lane,
      phases: context.phases,
      blocked_at: null,
      handoff_path: join(this.projectRoot, PATHS.HANDOFF),
      analysisRoles,
      reviewTier: selectImplementationReviewTier(classification, lane),
      reviewMode: selectReviewMode(false, 0),
      route_reason: routed.route_reason ?? null,
      closure_summary: buildChangeClosureSummary({
        changed_files: changeEvidence.files,
        phases: context.phases,
        verification_results: context.verification_results,
        verification_context: context.verification_context,
      }),
    };
  }

  private async runCustomWorkflow(classification: ClassificationResult): Promise<PipelineResult> {
    if (classification.workflow !== 'custom') {
      throw new Error('runCustomWorkflow requires a custom workflow classification');
    }

    const lane = selectLaneFromClassification(classification);
    const profile = readProjectProfile(this.projectRoot);
    const runtimeRoot = getRuntimeRoot();
    const resolver = new Resolver({ runtimeRoot });
    const resolved = await resolver.resolve({
      domain: profile?.active_capabilities?.includes('coding') ? 'coding' : 'content',
      active_capabilities: profile?.active_capabilities,
      stack_profile: profile?.stack_profile,
      stack: profile ? (profile.stack_profile?.frameworks[0] ?? 'short-video') : 'short-video',
      capabilities: (profile?.stack_profile?.traits ?? []) as string[],
    });
    if (!classification.custom_workflow_name) {
      throw new Error('Custom workflow routing requires custom_workflow_name');
    }

    let progress;
    try {
      const availableSkillNames = await this.collectAvailableSkillNames(resolved.skills);
      const engine = new WorkflowEngine({
        projectRoot: this.projectRoot,
        availableSkills: availableSkillNames,
        createStepExecutor: (context) =>
          this.createCustomWorkflowStepExecutor(classification.custom_workflow_name!, context),
      });

      progress = await engine.run(classification.custom_workflow_name, {
        classification: {
          complexity: classification.complexity,
          risk: classification.risk,
          workflow: 'custom',
        },
      });
    } catch (error) {
      await this.writeHandoffArtifact('request-classification', [], classification, lane, []);
      await this.writeErrorLog(error, classification.custom_workflow_name ?? 'unknown');
      return {
        lane,
        phases: [],
        blocked_at: 'request-classification',
        handoff_path: join(this.projectRoot, PATHS.HANDOFF),
        analysisRoles: resolveAnalysisRoles(lane, classification),
        reviewTier: selectImplementationReviewTier(classification, lane),
        reviewMode: selectReviewMode(false, 0),
        route_reason: error instanceof Error ? error.message : 'Custom workflow execution failed.',
        closure_summary: buildChangeClosureSummary({
          changed_files: (await loadChangeEvidence(this.projectRoot)).files,
          phases: [],
        }),
      };
    }
    await this.writeHandoffArtifact('request-classification', [], classification, lane, []);

    if (progress.status === 'failed' || progress.status === 'aborted') {
      return {
        lane,
        phases: [],
        blocked_at: 'request-classification',
        handoff_path: join(this.projectRoot, PATHS.HANDOFF),
        analysisRoles: resolveAnalysisRoles(lane, classification),
        reviewTier: selectImplementationReviewTier(classification, lane),
        reviewMode: selectReviewMode(false, 0),
        route_reason: `Custom workflow "${classification.custom_workflow_name}" ${progress.status}.`,
        closure_summary: buildChangeClosureSummary({
          changed_files: (await loadChangeEvidence(this.projectRoot)).files,
          phases: [],
        }),
      };
    }

    const changeEvidence = await loadChangeEvidence(this.projectRoot);
    return {
      lane,
      phases: [],
      blocked_at: null,
      handoff_path: join(this.projectRoot, PATHS.HANDOFF),
      analysisRoles: resolveAnalysisRoles(lane, classification),
      reviewTier: selectImplementationReviewTier(classification, lane),
      reviewMode: selectReviewMode(false, 0),
      route_reason: classification.workflow_reason ?? null,
      closure_summary: buildChangeClosureSummary({
        changed_files: changeEvidence.files,
        phases: [],
      }),
    };
  }

  private async collectAvailableSkillNames(
    resolvedSkills: ResolvedArtifact[],
  ): Promise<Set<string>> {
    const names = new Set<string>();
    const projectSkillArtifacts: ResolvedArtifact[] = [];

    for (const root of PROJECT_SKILL_ROOTS) {
      const absoluteRoot = join(this.projectRoot, root);
      if (!existsSync(absoluteRoot)) {
        continue;
      }

      const files = await fg('**/SKILL.md', {
        cwd: absoluteRoot,
        absolute: true,
      });

      for (const file of files) {
        projectSkillArtifacts.push({
          path: file,
          level: 6,
          source: file,
        });
      }
    }

    for (const artifact of resolvedSkills) {
      if (basename(artifact.path) !== 'SKILL.md') {
        continue;
      }

      names.add(basename(pathDirname(artifact.path)));
    }

    for (const artifact of projectSkillArtifacts) {
      if (basename(artifact.path) !== 'SKILL.md') {
        continue;
      }

      const content = await readFile(artifact.path, 'utf8');
      const parsed = this.skillParser.parse(content);
      names.add(parsed.frontmatter.name);
    }

    // Capture the runtime-skill snapshot once so a concurrent register()/remove()
    // does not change the set mid-collection (AC3 — snapshot isolation).
    for (const entry of this.runtimeRegistry?.snapshot() ?? []) {
      names.add(entry.name);
    }

    return names;
  }

  private createCustomWorkflowStepExecutor(
    workflowName: string,
    context: StepExecutionContext,
  ): StepExecutor {
    const projectRoot = this.projectRoot;
    const profile = readProjectProfile(projectRoot);
    const predictiveCacheEnabled = profile?.efficiency?.predictive_cache ?? true;
    const cacheDir = join(projectRoot, '.paqad', 'cache', 'skills');
    const cacheManager = new SkillCacheManager(cacheDir);
    const transitionLog = new TransitionLogManager(projectRoot);
    const warmer = new CacheWarmer(cacheManager);
    const metrics = new CacheMetricsTracker(projectRoot);
    const predictiveCache = new PredictiveCache(transitionLog, warmer, metrics, {
      ...DEFAULT_PREDICTIVE_CACHE_OPTIONS,
      enabled: predictiveCacheEnabled,
    });
    const sessionId = randomUUID();
    const stackKey = profile?.stack_profile?.frameworks[0] ?? 'default';

    const skillCachingEnabled = profile?.efficiency?.skill_caching ?? false;
    const skillCacheDir = join(projectRoot, PATHS.SKILL_CACHE_DIR);
    const skillCacheManager = skillCachingEnabled
      ? new SkillCacheManager(skillCacheDir)
      : undefined;

    return new (class extends StepExecutor {
      constructor() {
        super(context, { sessionId, stackKey, predictiveCache, skillCacheManager });
      }

      protected override async runStep(step: WorkflowStep): Promise<void> {
        const targetDir = join(projectRoot, PATHS.WORKFLOW_RUNS_DIR, workflowName, 'executions');
        const timestamp = new Date().toISOString();
        const safeSkill = trimEdgeChars(step.skill.replace(/[^a-z0-9]+/gi, '-'), '-') || 'step';
        // ISO timestamps contain ':' which is illegal in Windows filenames.
        const safeTimestamp = timestamp.replace(/[:.]/g, '-');
        const target = join(targetDir, `${safeTimestamp}-${safeSkill}.json`);

        await mkdir(targetDir, { recursive: true });
        await writeFile(
          target,
          JSON.stringify(
            {
              skill: step.skill,
              executed_at: timestamp,
              classification: context.classification,
            },
            null,
            2,
          ),
          'utf8',
        );
      }
    })();
  }

  /**
   * Settle a consumer-cancelled pipeline run (PQD-104): write the handoff
   * artifact with a forced-blocked closure summary, emit exactly one
   * `run.cancelled` event, and resolve with a `cancelled: true` result so the
   * consumer never has to catch a thrown error.
   */
  private async cancelLaneRun(
    phaseName: PipelinePhase,
    context: PipelineRunContext,
    classification: ClassificationResult,
    lane: Lane,
    analysisRoles: PipelineAnalysisRole[],
    runId: string,
  ): Promise<PipelineResult> {
    const reason = `Run cancelled by consumer during phase "${phaseName}".`;
    await this.writeHandoffArtifact(
      phaseName,
      context.phases,
      classification,
      lane,
      context.policy_warnings,
      context.verification_results,
      context.verification_context,
      reason,
    );
    appendRunCancelledEvent(this.projectRoot, runId, {
      blocked_at: phaseName,
      lane,
      workflow: classification.workflow,
    });
    const changeEvidence = await loadChangeEvidence(this.projectRoot);
    return {
      lane,
      phases: context.phases,
      blocked_at: phaseName,
      handoff_path: join(this.projectRoot, PATHS.HANDOFF),
      analysisRoles,
      reviewTier: selectImplementationReviewTier(classification, lane),
      reviewMode: selectReviewMode(false, 0),
      route_reason: reason,
      cancelled: true,
      closure_summary: buildChangeClosureSummary({
        changed_files: changeEvidence.files,
        phases: context.phases,
        verification_results: context.verification_results,
        verification_context: context.verification_context,
        forced_blocking_reason: reason,
      }),
    };
  }

  private async writeHandoffArtifact(
    currentPhase: PipelinePhase,
    phases: PhaseResult[],
    classification: ClassificationResult,
    lane: Lane,
    policyWarnings: string[],
    verificationResults?: PipelineRunContext['verification_results'],
    verificationContext?: PipelineRunContext['verification_context'],
    cancellationReason?: string,
  ): Promise<void> {
    const changeEvidence = await loadChangeEvidence(this.projectRoot);
    const artifact: HandoffArtifact = {
      framework_version: VERSION,
      workflow: classification.workflow,
      current_phase: currentPhase,
      current_story: null,
      completed_stories: [],
      key_decisions: [
        `lane:${lane}`,
        `workflow:${classification.workflow}`,
        `domain:${classification.domain}`,
        `stack:${classification.stack}`,
      ],
      verification_results: verificationResults ?? [],
      changed_files: changeEvidence.files,
      context_hit_rate: 0,
      warnings: [
        ...phases.filter((phase) => phase.status === 'warning').map((phase) => phase.summary),
        ...policyWarnings,
      ],
      unresolved_items: phases
        .filter((phase) => phase.status === 'fail')
        .map((phase) => phase.summary),
      closure_summary: buildChangeClosureSummary({
        changed_files: changeEvidence.files,
        phases,
        verification_results: verificationResults,
        verification_context: verificationContext,
        forced_blocking_reason: cancellationReason,
      }),
      references: {
        spec: 'docs/spec.md',
        flow: 'docs/user-flow.md',
        review_report: 'docs/reviews/latest.md',
      },
    };

    const target = join(this.projectRoot, PATHS.HANDOFF);
    await mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    await writeFile(tmp, JSON.stringify(artifact, null, 2));
    await rename(tmp, target);
    await writeActiveImplementationSession(
      this.projectRoot,
      createActiveImplementationSession(classification, lane, currentPhase, phases, changeEvidence),
    );
  }

  private async writeErrorLog(error: unknown, context: string): Promise<void> {
    try {
      const logPath = join(this.projectRoot, '.paqad', 'error-log.json');
      await mkdir(dirname(logPath), { recursive: true });
      const entry = {
        timestamp: new Date().toISOString(),
        context,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      };
      await writeFile(logPath, JSON.stringify(entry, null, 2));
    } catch {
      // non-critical
    }
  }

  private async writeNullRouteHandoff(classification: ClassificationResult): Promise<void> {
    const changeEvidence = await loadChangeEvidence(this.projectRoot);
    const closureSummary = buildChangeClosureSummary({
      changed_files: changeEvidence.files,
      phases: [],
    });
    const artifact: HandoffArtifact = {
      framework_version: VERSION,
      workflow: classification.workflow,
      current_phase: 'request-classification',
      current_story: null,
      completed_stories: [],
      key_decisions: [
        'lane:none',
        'workflow:none',
        `domain:${classification.domain}`,
        `stack:${classification.stack}`,
      ],
      verification_results: [],
      changed_files: changeEvidence.files,
      context_hit_rate: 0,
      warnings: classification.workflow_reason ? [classification.workflow_reason] : [],
      unresolved_items: [],
      closure_summary: closureSummary,
      references: {
        spec: 'docs/spec.md',
        flow: 'docs/user-flow.md',
        review_report: 'docs/reviews/latest.md',
      },
    };

    const target = join(this.projectRoot, PATHS.HANDOFF);
    await mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    await writeFile(tmp, JSON.stringify(artifact, null, 2));
    await rename(tmp, target);
    await writeActiveImplementationSession(
      this.projectRoot,
      createActiveImplementationSession(
        classification,
        null,
        'request-classification',
        [],
        changeEvidence,
      ),
    );
  }
}

function shouldUseFeatureDevelopmentPolicy(
  workflow: ClassificationResult['workflow'],
): workflow is 'feature-development' {
  return workflow === 'feature-development';
}

function resolveAnalysisRoles(
  lane: Lane,
  classification: ClassificationResult,
): PipelineAnalysisRole[] {
  if (lane === 'fast') {
    return [];
  }

  if (lane === 'graduated') {
    const roles: PipelineAnalysisRole[] = [
      { name: 'context-curator' },
      { name: 'solution-architect' },
    ];

    if (classification.database_impact !== 'none') {
      roles.push({ name: 'database-expert' });
    }

    return roles;
  }

  return [
    { name: 'context-curator' },
    { name: 'solution-architect' },
    { name: 'database-expert' },
    { name: 'ux-ui-analyst' },
    { name: 'product-owner' },
    { name: 'market-researcher' },
  ];
}

function selectLaneFromClassification(classification: ClassificationResult): Lane {
  if (
    classification.workflow === 'project-question' ||
    classification.workflow === 'writing' ||
    classification.workflow === 'editing' ||
    classification.workflow === 'planning' ||
    classification.workflow === 'research' ||
    classification.workflow === 'investigation'
  ) {
    return 'fast';
  }

  if (classification.workflow === 'pentest' || classification.workflow === 'pentest-retest') {
    return 'graduated';
  }

  if (classification.workflow === 'migration') {
    return 'full';
  }

  if (classification.workflow === 'feature-development') {
    return classification.risk === 'high' ? 'full' : 'graduated';
  }

  if (classification.workflow === 'bug-fix') {
    return classification.complexity === 'low' && classification.risk === 'low'
      ? 'fast'
      : 'graduated';
  }

  if (classification.complexity === 'trivial') {
    return 'fast';
  }

  if (classification.complexity === 'low' && classification.risk === 'low') {
    return 'fast';
  }

  if (classification.complexity === 'medium' && classification.risk !== 'high') {
    return 'graduated';
  }

  return 'full';
}
