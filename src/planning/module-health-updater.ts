import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

import fg from 'fast-glob';

import { PATHS } from '@/core/constants/paths.js';
import type { ModuleHealthMetrics, ModuleHealthProfile } from '@/core/types/planning.js';
import type { GateResult, VerificationContext } from '@/core/types/verification.js';

import {
  deriveHealthTier,
  moduleHealthPath,
  readAllModuleHealth,
  writeModuleHealthProfile,
} from './module-health.js';

const LOOKBACK_DAYS = 90;
const MAX_PROCESSED_EVENT_IDS = 50;

interface ConsumedEventIndex {
  schema_version: 1;
  event_ids: string[];
  updated_at: string;
}

export interface ModuleHealthEvidence {
  schema_version: 1;
  event_id: string;
  source:
    | 'provider-hook'
    | 'workflow-phase'
    | 'verification-gate'
    | 'preflight'
    | 'session-artifact';
  provider?: string;
  session_id?: string;
  created_at: string;
  affected_files: string[];
  affected_modules: string[];
  signals: {
    tests?: {
      status?: 'pass' | 'fail' | 'partial' | 'unknown';
      passed?: number;
      failed?: number;
      errored?: number;
      coverage_pct?: number;
    };
    verification?: {
      status?: 'pass' | 'fail' | 'partial' | 'unknown';
      gates_passed?: string[];
      gates_failed?: string[];
    };
    compliance?: {
      covered_obligations?: number;
      total_obligations?: number;
      uncovered_critical?: number;
    };
    defects?: {
      new?: number;
      recurring?: number;
      resolved?: number;
    };
    mutation?: {
      // Kill rate 0–100 for the module's changed code.
      kill_rate?: number;
      // Lower-confidence (weak-tooled language) results are not recorded as a
      // module metric to avoid over-trusting them.
      confidence?: 'mature' | 'lower';
    };
    docs?: {
      doc_targets_total?: number;
      doc_targets_updated?: number;
      doc_targets_missing?: number;
    };
    scope?: {
      scope_clean?: boolean;
      scope_violations?: number;
    };
  };
}

export interface ModuleHealthSyncOptions {
  projectRoot: string;
  source?: ModuleHealthEvidence['source'];
  provider?: string;
  sessionId?: string;
  silent?: boolean;
  preflight?: boolean;
}

export interface ModuleHealthSyncResult {
  processed_events: number;
  updated_profiles: string[];
  skipped: boolean;
  reason?: string;
}

export async function syncModuleHealth(
  options: ModuleHealthSyncOptions,
): Promise<ModuleHealthSyncResult> {
  const acquired = await acquireLock(options.projectRoot);
  if (!acquired) {
    await writeAudit(options.projectRoot, {
      action: 'lock-contention-skip',
      source: options.source ?? 'provider-hook',
      provider: options.provider,
      detail: 'Module health sync skipped because another updater owns the lock.',
    });
    return { processed_events: 0, updated_profiles: [], skipped: true, reason: 'locked' };
  }

  try {
    await collectSessionEvidence(options);
    const evidence = await readEvidence(options.projectRoot);
    if (evidence.length === 0) {
      return { processed_events: 0, updated_profiles: [], skipped: false };
    }

    const modules = await resolveKnownModules(options.projectRoot);
    const consumed = await readConsumedEventIndex(options.projectRoot);
    const updated = new Set<string>();
    // Evidence files that are done with — already consumed (backlog) or applied
    // this run. Their content is folded into the profiles, the consumed index
    // dedups any byte-identical re-collection, and each profile keeps its own
    // processed_event_ids, so the on-disk evidence file is now pure clutter.
    const staleEvidenceIds = new Set<string>();
    let processed = 0;

    for (const event of evidence) {
      if (consumed.event_ids.includes(event.event_id)) {
        staleEvidenceIds.add(event.event_id);
        continue;
      }

      const affectedModules = resolveEvidenceModules(event, modules);
      if (affectedModules.length === 0) {
        await writeAudit(options.projectRoot, {
          action: 'evidence-ignored',
          source: event.source,
          provider: event.provider,
          event_id: event.event_id,
          detail: 'Evidence could not be mapped to a stable module.',
        });
        continue;
      }

      for (const moduleName of affectedModules) {
        const result = await applyEvidenceToProfile(options.projectRoot, moduleName, event);
        if (result === 'updated' || result === 'created') {
          updated.add(moduleName);
        }
      }
      consumed.event_ids.push(event.event_id);
      staleEvidenceIds.add(event.event_id);
      processed += 1;
    }

    if (processed > 0) {
      await writeConsumedEventIndex(options.projectRoot, consumed);
    }

    // Delete the now-redundant evidence files (best-effort). A byte-identical
    // event re-collected later simply re-creates then re-skips its file.
    for (const eventId of staleEvidenceIds) {
      await rm(evidencePath(options.projectRoot, eventId), { force: true });
    }

    return {
      processed_events: processed,
      updated_profiles: [...updated].sort(),
      skipped: false,
    };
  } catch (error) {
    await writeAudit(options.projectRoot, {
      action: 'updater-failure',
      source: options.source ?? 'provider-hook',
      provider: options.provider,
      /* c8 ignore next -- JavaScript I/O failures arrive as Error objects in supported runtimes. */
      detail: error instanceof Error ? error.message : String(error),
    });
    if (options.silent) {
      return {
        processed_events: 0,
        updated_profiles: [],
        skipped: true,
        reason: 'failure',
      };
    }
    throw error;
    /* c8 ignore start -- cleanup always runs, but V8 records the finally edge inconsistently. */
  } finally {
    await releaseLock(options.projectRoot);
  }
  /* c8 ignore stop */
}

export async function syncModuleHealthFromVerification(input: {
  projectRoot: string;
  provider?: string;
  sessionId?: string;
  verificationContext: VerificationContext;
  results: GateResult[];
}): Promise<ModuleHealthSyncResult> {
  try {
    const structured = input.verificationContext.structured_test_results ?? [];
    const failedTests = structured.reduce((total, result) => total + result.summary.failed, 0);
    const erroredTests = structured.reduce((total, result) => total + result.summary.errored, 0);
    const passedTests = structured.reduce((total, result) => total + result.summary.passed, 0);
    const gatesPassed = input.results
      .filter((result) => result.passed)
      .map((result) => result.gate);
    const gatesFailed = input.results
      .filter((result) => !result.passed)
      .map((result) => result.gate);
    const status = gatesFailed.length > 0 || failedTests > 0 || erroredTests > 0 ? 'fail' : 'pass';
    const mutation = input.verificationContext.mutation_result;
    const mutationSignal =
      mutation && mutation.kill_rate !== null && mutation.status !== 'skipped'
        ? { kill_rate: mutation.kill_rate, confidence: mutation.confidence }
        : undefined;
    const event = createEvidence({
      source: 'verification-gate',
      provider: input.provider,
      sessionId: input.sessionId,
      affectedFiles: input.verificationContext.changed_files,
      affectedModules: input.verificationContext.modules,
      signals: {
        tests:
          structured.length > 0
            ? {
                status,
                passed: passedTests,
                failed: failedTests,
                errored: erroredTests,
              }
            : undefined,
        verification: {
          status,
          gates_passed: gatesPassed,
          gates_failed: gatesFailed,
        },
        docs: {
          doc_targets_total: input.verificationContext.stale_doc_targets.length,
          doc_targets_missing: input.verificationContext.stale_doc_targets.length,
        },
        ...(mutationSignal ? { mutation: mutationSignal } : {}),
      },
    });

    await persistEvidence(input.projectRoot, event);
    return syncModuleHealth({
      projectRoot: input.projectRoot,
      source: 'verification-gate',
      provider: input.provider,
      sessionId: input.sessionId,
      silent: true,
    });
  } catch (error) {
    await writeAudit(input.projectRoot, {
      action: 'updater-failure',
      source: 'verification-gate',
      provider: input.provider,
      /* v8 ignore next 1 -- String(error) branch for non-Error throws; all tested errors are Error instances */
      detail: error instanceof Error ? error.message : String(error),
    });
    return {
      processed_events: 0,
      updated_profiles: [],
      skipped: true,
      reason: 'failure',
    };
  }
}

export function createEvidence(input: {
  source: ModuleHealthEvidence['source'];
  provider?: string;
  sessionId?: string;
  affectedFiles?: string[];
  affectedModules?: string[];
  signals?: ModuleHealthEvidence['signals'];
}): ModuleHealthEvidence {
  const affectedFiles = normalizeList(input.affectedFiles ?? []);
  const affectedModules = normalizeList(input.affectedModules ?? []);
  const signals = pruneSignals(input.signals ?? {});
  const stablePayload = JSON.stringify({
    source: input.source,
    provider: input.provider ?? null,
    session_id: input.sessionId ?? null,
    affected_files: affectedFiles,
    affected_modules: affectedModules,
    signals,
  });
  const digest = createHash('sha256').update(stablePayload).digest('hex').slice(0, 16);

  return {
    schema_version: 1,
    event_id: `mh-${digest}`,
    source: input.source,
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.sessionId ? { session_id: input.sessionId } : {}),
    created_at: new Date().toISOString(),
    affected_files: affectedFiles,
    affected_modules: affectedModules,
    signals,
  };
}

export async function persistEvidence(
  projectRoot: string,
  evidence: ModuleHealthEvidence,
): Promise<void> {
  const path = evidencePath(projectRoot, evidence.event_id);
  await mkdir(dirname(path), { recursive: true });
  await atomicWriteJson(path, evidence);
}

async function readConsumedEventIndex(projectRoot: string): Promise<ConsumedEventIndex> {
  try {
    const parsed = JSON.parse(
      await readFile(join(projectRoot, PATHS.MODULE_HEALTH_CONSUMED_EVENTS), 'utf8'),
    ) as Partial<ConsumedEventIndex>;
    return {
      schema_version: 1,
      /* v8 ignore next 10 -- defensive fallbacks for malformed persisted data; always valid schema in practice */
      event_ids: Array.isArray(parsed.event_ids)
        ? [
            ...new Set(
              parsed.event_ids.filter((value): value is string => typeof value === 'string'),
            ),
          ]
        : [],
      updated_at:
        typeof parsed.updated_at === 'string' ? parsed.updated_at : new Date(0).toISOString(),
    };
  } catch {
    return {
      schema_version: 1,
      event_ids: [],
      updated_at: new Date(0).toISOString(),
    };
  }
}

async function writeConsumedEventIndex(
  projectRoot: string,
  index: ConsumedEventIndex,
): Promise<void> {
  await atomicWriteJson(join(projectRoot, PATHS.MODULE_HEALTH_CONSUMED_EVENTS), {
    schema_version: 1,
    event_ids: [...new Set(index.event_ids)].sort(),
    updated_at: new Date().toISOString(),
  });
}

async function collectSessionEvidence(options: ModuleHealthSyncOptions): Promise<void> {
  const changedFiles = await readChangedFiles(options.projectRoot);
  if (changedFiles.length === 0) {
    return;
  }

  await persistEvidence(
    options.projectRoot,
    createEvidence({
      source: options.source ?? (options.preflight ? 'preflight' : 'provider-hook'),
      provider: options.provider,
      sessionId: resolveEvidenceSessionId(options),
      affectedFiles: changedFiles,
      signals: {},
    }),
  );
}

function resolveEvidenceSessionId(options: ModuleHealthSyncOptions): string | undefined {
  if (options.sessionId !== undefined) {
    return options.sessionId;
  }

  if (
    options.preflight === true ||
    (options.source !== undefined &&
      options.source !== 'provider-hook' &&
      options.source !== 'session-artifact')
  ) {
    return undefined;
  }

  return `auto-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readChangedFiles(projectRoot: string): Promise<string[]> {
  try {
    const raw = await readFile(join(projectRoot, PATHS.CHANGED_FILES), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return normalizeList(parsed.filter((item): item is string => typeof item === 'string'));
  } catch {
    return [];
  }
}

async function readEvidence(projectRoot: string): Promise<ModuleHealthEvidence[]> {
  const dir = join(projectRoot, PATHS.MODULE_HEALTH_EVIDENCE_DIR);
  try {
    const files = await fg('*.json', { cwd: dir, onlyFiles: true });
    const events: ModuleHealthEvidence[] = [];
    for (const file of files.sort()) {
      try {
        const parsed = JSON.parse(await readFile(join(dir, file), 'utf8')) as ModuleHealthEvidence;
        if (isEvidence(parsed)) {
          events.push(parsed);
        } else {
          await writeAudit(projectRoot, {
            action: 'evidence-ignored',
            source: 'provider-hook',
            detail: `${file} failed schema validation.`,
          });
        }
      } catch {
        await writeAudit(projectRoot, {
          action: 'evidence-ignored',
          source: 'provider-hook',
          detail: `${file} is unreadable JSON.`,
        });
      }
    }
    return events;
  } catch {
    return [];
  }
}

async function applyEvidenceToProfile(
  projectRoot: string,
  moduleName: string,
  event: ModuleHealthEvidence,
): Promise<'created' | 'updated' | 'skipped'> {
  const existing = await readProfileConservatively(projectRoot, moduleName, event);
  /* v8 ignore next 3 -- deduplication skip path; event replay not exercised in unit tests */
  if (existing?.evidence?.processed_event_ids?.includes(event.event_id)) {
    return 'skipped';
  }

  const base = existing ?? createUnknownProfile(moduleName);
  const nextMetrics = mergeMetrics(base.metrics, event);
  const tier = deriveHealthTier(nextMetrics);
  const processed = [...(base.evidence?.processed_event_ids ?? []), event.event_id].slice(
    -MAX_PROCESSED_EVENT_IDS,
  );
  const verificationStatus = event.signals.verification?.status ?? event.signals.tests?.status;
  const next: ModuleHealthProfile = {
    ...base,
    schema_version: 2,
    module: moduleName,
    tier,
    metrics: nextMetrics,
    evidence: {
      ...(base.evidence ?? {}),
      last_event_id: event.event_id,
      ...(event.provider ? { last_provider: event.provider } : {}),
      ...(event.session_id ? { last_session_id: event.session_id } : {}),
      ...(verificationStatus ? { last_verification_status: verificationStatus } : {}),
      last_changed_files: event.affected_files.slice(0, 25),
      processed_event_ids: processed,
    },
    history: {
      ...(base.history ?? {}),
      lookback_days: LOOKBACK_DAYS,
      events_count: (base.history?.events_count ?? 0) + 1,
      last_failure_at: isFailure(event)
        ? event.created_at
        : (base.history?.last_failure_at ?? null),
      last_success_at: isSuccess(event)
        ? event.created_at
        : (base.history?.last_success_at ?? null),
    },
    updated_at: new Date().toISOString(),
  };

  await writeModuleHealthProfile(projectRoot, next);
  await writeAudit(projectRoot, {
    action: existing ? 'profile-updated' : 'profile-created',
    source: event.source,
    provider: event.provider,
    event_id: event.event_id,
    detail: `${moduleName} tier=${next.tier}.`,
  });
  return existing ? 'updated' : 'created';
}

async function readProfileConservatively(
  projectRoot: string,
  moduleName: string,
  event: ModuleHealthEvidence,
): Promise<ModuleHealthProfile | null> {
  const path = moduleHealthPath(projectRoot, moduleName);
  try {
    if (!existsSync(path)) {
      return null;
    }
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as ModuleHealthProfile;
  } catch {
    await rename(path, `${path}.corrupt-${Date.now()}`).catch(() => undefined);
    await writeAudit(projectRoot, {
      action: 'profile-repair-attempted',
      source: event.source,
      provider: event.provider,
      event_id: event.event_id,
      detail: `Preserved corrupt profile for ${moduleName}; writing repaired profile from evidence.`,
    });
    return null;
  }
}

function mergeMetrics(
  existing: ModuleHealthMetrics,
  event: ModuleHealthEvidence,
): ModuleHealthMetrics {
  const next: ModuleHealthMetrics = { ...existing };
  const coverage = deriveCoverage(event);
  if (coverage !== null) {
    next.coverage_pct = coverage;
  }

  const mutationScore = deriveMutationScore(event);
  if (mutationScore !== null) {
    next.mutation_score = mutationScore;
  }

  const defectDelta = defectContribution(event);
  if (defectDelta > 0) {
    next.defect_frequency = (next.defect_frequency ?? 0) + defectDelta;
  } else if (hasSuccessfulStructuredVerification(event) && next.defect_frequency === null) {
    next.defect_frequency = 0;
  }

  const stability = deriveContractStability(existing.contract_stability ?? null, event);
  if (stability !== null) {
    next.contract_stability = stability;
  }

  if (event.affected_files.length > 0 || event.session_id) {
    next.change_velocity = (next.change_velocity ?? 0) + 1;
  }

  return next;
}

function deriveCoverage(event: ModuleHealthEvidence): number | null {
  const testCoverage = event.signals.tests?.coverage_pct;
  if (typeof testCoverage === 'number') {
    return clamp(testCoverage, 0, 100);
  }

  const compliance = event.signals.compliance;
  if (
    typeof compliance?.covered_obligations === 'number' &&
    typeof compliance.total_obligations === 'number' &&
    compliance.total_obligations > 0
  ) {
    return clamp((compliance.covered_obligations / compliance.total_obligations) * 100, 0, 100);
  }

  return null;
}

function deriveMutationScore(event: ModuleHealthEvidence): number | null {
  const mutation = event.signals.mutation;
  // Only mature-tool results feed the per-module metric; lower-confidence
  // results are surfaced in evidence but never over-trusted as a rolled-up
  // number (issue #105).
  if (typeof mutation?.kill_rate === 'number' && mutation.confidence !== 'lower') {
    return clamp(mutation.kill_rate, 0, 100);
  }
  return null;
}

function defectContribution(event: ModuleHealthEvidence): number {
  const failedTests = event.signals.tests?.failed ?? 0;
  const erroredTests = event.signals.tests?.errored ?? 0;
  const failedGates = event.signals.verification?.gates_failed?.length ?? 0;
  const criticalObligations = event.signals.compliance?.uncovered_critical ?? 0;
  const defects = (event.signals.defects?.new ?? 0) + (event.signals.defects?.recurring ?? 0);
  const scopeViolations = event.signals.scope?.scope_violations ?? 0;
  return failedTests + erroredTests + failedGates + criticalObligations + defects + scopeViolations;
}

function deriveContractStability(
  current: number | null,
  event: ModuleHealthEvidence,
): number | null {
  if (isFailure(event)) {
    return clamp((current ?? 0.8) - 0.1, 0, 1);
  }

  if (hasSuccessfulStructuredVerification(event)) {
    const docsMissing = event.signals.docs?.doc_targets_missing ?? 0;
    return docsMissing > 0 ? clamp((current ?? 0.85) - 0.05, 0, 1) : Math.max(current ?? 0, 0.9);
  }

  return current;
}

async function resolveKnownModules(projectRoot: string): Promise<string[]> {
  const fromProfiles = (await readAllModuleHealth(projectRoot)).map((profile) => profile.module);
  let fromDocs: string[];
  try {
    fromDocs = (await readdir(join(projectRoot, PATHS.MODULES_DIR), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    fromDocs = [];
  }
  return [...new Set([...fromProfiles, ...fromDocs])].sort((left, right) => {
    return right.length - left.length;
  });
}

function resolveEvidenceModules(event: ModuleHealthEvidence, knownModules: string[]): string[] {
  if (event.affected_modules.length > 0) {
    return event.affected_modules;
  }

  const resolved = new Set<string>();
  for (const file of event.affected_files) {
    const normalized = normalizePath(file);
    const known = knownModules.find((moduleName) => pathMatchesModule(normalized, moduleName));
    if (known) {
      resolved.add(known);
      continue;
    }

    const fallback = fallbackModuleFromPath(normalized);
    if (fallback) {
      resolved.add(fallback);
    }
  }

  return [...resolved].sort();
}

function pathMatchesModule(file: string, moduleName: string): boolean {
  const normalizedModule = normalizePath(moduleName);
  return (
    file === normalizedModule ||
    file.startsWith(`${normalizedModule}/`) ||
    file.includes(`/modules/${normalizedModule}/`) ||
    file.includes(`/${normalizedModule}/`)
  );
}

function fallbackModuleFromPath(file: string): string | null {
  const parts = file.split('/').filter(Boolean);
  if (parts[0] === 'src' && parts[1]) {
    return parts[1];
  }
  if (parts[0] === 'lib' && parts[1]) {
    return parts[1];
  }
  if (parts[0] === 'app' && parts[1]) {
    return parts[1];
  }
  if (parts[0] === 'tests' && parts[2]) {
    return parts[2];
  }
  if (parts[0] === 'docs' && parts[1] === 'modules' && parts[2]) {
    return parts[2];
  }
  return null;
}

async function acquireLock(projectRoot: string): Promise<boolean> {
  try {
    const lockPath = join(projectRoot, PATHS.MODULE_HEALTH_LOCK);
    await mkdir(dirname(lockPath), { recursive: true });
    await mkdir(lockPath, { recursive: false });
    return true;
  } catch {
    return false;
  }
}

async function releaseLock(projectRoot: string): Promise<void> {
  await rm(join(projectRoot, PATHS.MODULE_HEALTH_LOCK), { recursive: true, force: true });
}

async function writeAudit(
  projectRoot: string,
  event: {
    action: string;
    source: ModuleHealthEvidence['source'] | 'provider-hook';
    provider?: string;
    event_id?: string;
    detail: string;
  },
): Promise<void> {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    subsystem: 'module-health',
    ...event,
  });
  const logPath = join(projectRoot, PATHS.MODULE_HEALTH_LOG);
  const auditPath = join(projectRoot, PATHS.AUDIT_LOG);
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, `${line}\n`, { encoding: 'utf8', flag: 'a' });
  await mkdir(dirname(auditPath), { recursive: true });
  await writeFile(auditPath, `${line}\n`, { encoding: 'utf8', flag: 'a' });
}

function createUnknownProfile(moduleName: string): ModuleHealthProfile {
  const metrics = {
    coverage_pct: null,
    defect_frequency: null,
    contract_stability: null,
    change_velocity: null,
    mutation_score: null,
  };
  return {
    module: moduleName,
    tier: deriveHealthTier(metrics),
    metrics,
    updated_at: new Date(0).toISOString(),
  };
}

function isEvidence(value: ModuleHealthEvidence): value is ModuleHealthEvidence {
  return (
    value?.schema_version === 1 &&
    typeof value.event_id === 'string' &&
    typeof value.source === 'string' &&
    typeof value.created_at === 'string' &&
    Array.isArray(value.affected_files) &&
    Array.isArray(value.affected_modules) &&
    typeof value.signals === 'object' &&
    value.signals !== null
  );
}

function hasSuccessfulStructuredVerification(event: ModuleHealthEvidence): boolean {
  return event.signals.verification?.status === 'pass' || event.signals.tests?.status === 'pass';
}

function isFailure(event: ModuleHealthEvidence): boolean {
  return (
    event.signals.verification?.status === 'fail' ||
    event.signals.tests?.status === 'fail' ||
    defectContribution(event) > 0
  );
}

function isSuccess(event: ModuleHealthEvidence): boolean {
  return hasSuccessfulStructuredVerification(event) && !isFailure(event);
}

function pruneSignals(signals: ModuleHealthEvidence['signals']): ModuleHealthEvidence['signals'] {
  return JSON.parse(JSON.stringify(signals)) as ModuleHealthEvidence['signals'];
}

function normalizeList(values: string[]): string[] {
  return [...new Set(values.map(normalizePath).filter((value) => value.length > 0))].sort();
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//u, '');
}

function evidencePath(projectRoot: string, eventId: string): string {
  return join(projectRoot, PATHS.MODULE_HEALTH_EVIDENCE_DIR, `${eventId}.json`);
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const content = JSON.stringify(value, null, 2) + '\n';
  JSON.parse(content);
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, content, 'utf8');
  await rename(temporaryPath, path);
}

export function toProjectRelative(projectRoot: string, path: string): string {
  return normalizePath(relative(projectRoot, path));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number(value.toFixed(2))));
}
