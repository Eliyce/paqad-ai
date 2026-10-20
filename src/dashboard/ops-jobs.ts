import { readProjectProfile } from '@/core/project-profile.js';
import { getPrimaryStack } from '@/core/stack-profile.js';
import {
  checkSpecCompliance,
  doctorObligationIndex,
  loadObligationIndex,
} from '@/compliance/index.js';
import {
  DesignTokenService,
  DesignTokensMissingError,
  DesignTokensPlaceholderError,
} from '@/design-tokens/service.js';
import { HealthChecker } from '@/health/index.js';
import { reconcileModuleMap } from '@/module-map/reconciler.js';
import { discoverSourceRoots } from '@/module-map/source-roots.js';
import { refreshProjectRules } from '@/onboarding/rules-refresh.js';
import { RagService } from '@/rag/service.js';
import { createSiteMapGatherer } from '@/site-map/gatherer.js';
import { describeCompletedUnits, readProgress } from '@/site-map/progress-store.js';
import { describeSiteMapInventory, runSiteMapAudit } from '@/site-map/run.js';

import { appendDashboardAudit } from './approvals.js';

export const OPS_ACTIONS = [
  'reconcile',
  'refresh-rules',
  'refresh-context',
  'rag-rebuild',
  'rag-clear',
  'regenerate-docs',
  'compliance-check',
  'doctor',
  'site-map',
] as const;

export type OpsAction = (typeof OPS_ACTIONS)[number];

export function isOpsAction(value: unknown): value is OpsAction {
  return typeof value === 'string' && (OPS_ACTIONS as readonly string[]).includes(value);
}

export interface OpsJob {
  id: string;
  action: OpsAction;
  status: 'running' | 'done' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  progress: string[];
  result: unknown;
  error: string | null;
}

export interface OpsProgressEvent {
  jobId: string;
  action: OpsAction;
  status: OpsJob['status'];
  message: string;
}

export class OpsConflictError extends Error {
  readonly action: OpsAction;

  constructor(action: OpsAction) {
    super(`A '${action}' job is already running. Wait for it to finish before starting another.`);
    this.name = 'OpsConflictError';
    this.action = action;
  }
}

export interface OpsJobHelpers {
  projectRoot: string;
  progress: (message: string) => void;
}

export type OpsExecutor = (job: OpsJob, helpers: OpsJobHelpers) => Promise<unknown>;

export interface OpsJobRunnerOptions {
  projectRoot: string;
  onEvent?: (event: OpsProgressEvent) => void;
  executors?: Partial<Record<OpsAction, OpsExecutor>>;
}

const MAX_FINISHED_JOBS = 50;

const DEFAULT_EXECUTORS: Record<OpsAction, OpsExecutor> = {
  reconcile: async (_job, { projectRoot, progress }) => {
    const discovered = discoverSourceRoots(projectRoot);
    progress(
      discovered.source_roots === null
        ? 'No stack pack declares module_health.source_roots — the reconciler reports blocked.'
        : `Reconciling module-map.yml against: ${discovered.source_roots.join(', ')}.`,
    );
    const report = await reconcileModuleMap({
      projectRoot,
      sourceRoots: discovered.source_roots,
    });
    return { blocked: report.blocked, findings: report.findings.length, counts: report.counts };
  },

  'refresh-rules': async (_job, { projectRoot, progress }) => {
    const profile = readProjectProfile(projectRoot);
    if (profile === null) {
      throw new Error('No project profile found. Run `paqad-ai onboard` before refreshing rules.');
    }
    progress('Regenerating docs/instructions/rules from the framework rule packs.');
    const report = await refreshProjectRules(projectRoot, profile, { force: true });
    return {
      deleted: report.deleted.length,
      written: report.written.length,
      preserved: report.preserved,
    };
  },

  'refresh-context': async (_job, { projectRoot, progress }) => {
    progress('Syncing chunk and vector context indexes.');
    const sync = await new RagService(projectRoot).refreshContext();
    return {
      changed_files: sync.changed_files.length,
      added_files: sync.added_files.length,
      deleted_files: sync.deleted_files.length,
      updated: sync.updated,
    };
  },

  'rag-rebuild': async (_job, { projectRoot, progress }) => {
    const service = new RagService(projectRoot);
    await service.rebuild({ onProgress: (update) => progress(update.message) });
    return await service.getStatus();
  },

  'rag-clear': async (_job, { projectRoot, progress }) => {
    progress('Clearing the vector index and disabling RAG.');
    await new RagService(projectRoot).clear();
    return { cleared: true };
  },

  'regenerate-docs': async (_job, { projectRoot, progress }) => {
    const service = new DesignTokenService();
    try {
      progress('Regenerating design-system docs from design-tokens.json.');
      const docs = await service.writeDocs(projectRoot);
      const stack = getPrimaryStack(readProjectProfile(projectRoot) ?? undefined);
      const theme = await service.writeThemeExports(projectRoot, stack);
      return { docs, theme };
    } catch (error) {
      if (
        error instanceof DesignTokensMissingError ||
        error instanceof DesignTokensPlaceholderError
      ) {
        progress(error.message);
        return { skipped: true, note: error.message };
      }
      throw error;
    }
  },

  'compliance-check': async (_job, { projectRoot, progress }) => {
    const index = await loadObligationIndex({ project_root: projectRoot });
    if (index === null) {
      progress('No obligation index found — nothing to check.');
      return { checked: false, note: 'No specs to check. Extract an obligation index first.' };
    }
    const doctor = doctorObligationIndex(index);
    if (!doctor.ok) {
      throw new Error(
        `Obligation index is unusable: ${doctor.issues.map((issue) => issue.message).join('; ')}`,
      );
    }
    progress(`Checking ${index.obligations.length} obligation(s) against the test suite.`);
    const report = await checkSpecCompliance({ project_root: projectRoot, index });
    return { checked: true, summary: report.summary, uncovered: report.uncovered_obligations };
  },

  doctor: async (_job, { projectRoot, progress }) => {
    progress('Running framework health checks.');
    const report = await new HealthChecker().run(projectRoot);
    progress(`Overall status: ${report.overall_status}.`);
    return report.checks;
  },

  'site-map': async (_job, { projectRoot, progress }) => {
    const result = await runSiteMapAudit({
      projectRoot,
      gatherer: createSiteMapGatherer(projectRoot),
      onInventory: (inventory) => progress(describeSiteMapInventory(inventory)),
    });
    const progressFile = await readProgress(projectRoot);
    if (progressFile !== null) {
      for (const line of describeCompletedUnits(progressFile)) progress(line);
    }
    progress(`Mapped the app: ${result.finding_count} finding(s) worth a look.`);
    return {
      report_id: result.report_id,
      findings: result.finding_count,
      blocked_checks: result.blocked_checks.length,
      baseline_created: result.baseline_created,
    };
  },
};

export class OpsJobRunner {
  private jobs: OpsJob[] = [];
  private counter = 0;

  constructor(private readonly options: OpsJobRunnerOptions) {}

  start(action: OpsAction): OpsJob {
    const running = this.jobs.find((job) => job.action === action && job.status === 'running');
    if (running !== undefined) {
      throw new OpsConflictError(action);
    }

    this.counter += 1;
    const job: OpsJob = {
      id: `op-${action}-${this.counter}`,
      action,
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      progress: [],
      result: null,
      error: null,
    };
    this.jobs.push(job);
    void this.execute(job);
    return job;
  }

  get(jobId: string): OpsJob | null {
    return this.jobs.find((job) => job.id === jobId) ?? null;
  }

  list(): OpsJob[] {
    return [...this.jobs].reverse();
  }

  private emit(job: OpsJob, message: string): void {
    job.progress.push(message);
    this.options.onEvent?.({ jobId: job.id, action: job.action, status: job.status, message });
  }

  private async execute(job: OpsJob): Promise<void> {
    const executor = this.options.executors?.[job.action] ?? DEFAULT_EXECUTORS[job.action];
    const helpers: OpsJobHelpers = {
      projectRoot: this.options.projectRoot,
      progress: (message) => this.emit(job, message),
    };

    try {
      job.result = await executor(job, helpers);
      job.status = 'done';
      job.finishedAt = new Date().toISOString();
      this.emit(job, `Finished ${job.action}.`);
    } catch (error) {
      job.status = 'failed';
      job.finishedAt = new Date().toISOString();
      job.error =
        error instanceof Error
          ? (error.message.split('\n')[0] ?? 'The operation failed.')
          : 'The operation failed.';
      this.emit(job, `Failed ${job.action}: ${job.error}`);
    }

    appendDashboardAudit(this.options.projectRoot, `dashboard.ops.${job.action}`, {
      job: job.id,
      status: job.status,
    });
    this.pruneFinished();
  }

  private pruneFinished(): void {
    const finished = this.jobs.filter((job) => job.status !== 'running');
    const excess = finished.length - MAX_FINISHED_JOBS;
    if (excess <= 0) {
      return;
    }
    const drop = new Set(finished.slice(0, excess).map((job) => job.id));
    this.jobs = this.jobs.filter((job) => !drop.has(job.id));
  }
}
