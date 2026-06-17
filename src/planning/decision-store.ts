import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { ulid } from '@/core/ids/ulid.js';
import { DecisionPacketCorruptError } from '@/core/errors/engine-errors.js';
import { readProjectProfile } from '@/core/project-profile.js';

import {
  appendDecisionAuditEvent,
  ensureDecisionAuditLog,
  type DecisionAuditEventType,
} from './decision-audit.js';
import {
  decisionCapExceededEvent,
  decisionDiscardedEvent,
  decisionPausedEvent,
  decisionResolvedEvent,
  type DecisionEventSink,
} from './decision-events.js';
import { scoreDecisionOptionOverlap } from './decision-fingerprint.js';
import {
  isDecisionPacket,
  validateDecisionPacket,
  type DecisionHumanResponse,
  type DecisionPacket,
  type DecisionStatus,
} from './decision-packet.js';
import { lintDecisionCopy } from './decision-copy.js';

interface DecisionIndexEntry {
  decision_id: string;
  fingerprint: string;
  category: string;
  chosen_option_key: string | null;
  responded_at: string;
  status: DecisionStatus;
  option_keys: string[];
}

export interface DecisionIndexFile {
  fingerprints: Record<string, string>;
  decisions: Record<string, DecisionIndexEntry>;
}

export interface ResolveDecisionInput {
  decisionId: string;
  humanResponse: DecisionHumanResponse;
  respondedByProvider?: string;
}

export interface ResolveExistingDecisionInput {
  packet: DecisionPacket;
  humanResponse: DecisionHumanResponse;
  event: DecisionAuditEventType;
  respondedByProvider?: string;
}

export interface ReadPendingResult {
  packet: DecisionPacket | null;
  error?: string;
}

export interface DeferUndeclaredDecisionInput {
  packet: DecisionPacket;
  provider?: string;
}

export interface DiscardDecisionInput {
  decisionId: string;
  reason: string;
}

/**
 * Default per-project cap on simultaneously pending decision packets (PQD-101).
 * Overridable via `custom.decisions.max_pending` in `.paqad/project-profile.yaml`.
 */
export const MAX_PENDING_DECISIONS = 20;

/**
 * Thrown by {@link DecisionStore.writePending} when creating a new pending
 * packet would meet or exceed the per-project pending cap. Carries the counts
 * so a caller can emit a `decision-cap-exceeded` event and prompt the user to
 * triage.
 */
export class DecisionCapExceededError extends Error {
  constructor(
    readonly pendingCount: number,
    readonly cap: number,
  ) {
    super(`Pending decision cap reached (${pendingCount}/${cap}).`);
    this.name = 'DecisionCapExceededError';
  }
}

/** Optional hooks supplied when constructing a {@link DecisionStore}. */
export interface DecisionStoreOptions {
  /**
   * PQD-101 — live decision-event sink. When supplied, the store fires a
   * decision-pause event at each persistence boundary (paused on `writePending`,
   * resolved on any resolution, cap-exceeded on refusal, discarded on
   * `discard`). When omitted the store behaves exactly as before.
   */
  onEvent?: DecisionEventSink;
}

export class DecisionStore {
  private readonly onEvent?: DecisionEventSink;

  constructor(
    private readonly projectRoot: string,
    options: DecisionStoreOptions = {},
  ) {
    this.onEvent = options.onEvent;
  }

  initialize(): void {
    for (const relativePath of [
      PATHS.DECISIONS_PENDING_DIR,
      PATHS.DECISIONS_RESOLVED_DIR,
      PATHS.DECISIONS_EXPIRED_DIR,
    ]) {
      const dir = join(this.projectRoot, relativePath);
      mkdirSync(dir, { recursive: true });
      const keepFile = join(dir, '.gitkeep');
      if (!existsSync(keepFile)) {
        writeFileSync(keepFile, '');
      }
    }
    ensureDecisionAuditLog(this.projectRoot);
    if (!existsSync(this.indexPath())) {
      this.writeIndex({ fingerprints: {}, decisions: {} });
    }
  }

  /**
   * Mint a fresh decision id. Issue #184: ids are now `D-<ULID>` rather than a
   * monotonic `D-{N}`. ULIDs are timestamp-sortable and collision-free across
   * machines, so two developers on parallel branches never allocate the same
   * id (the old `max + 1` walk produced identical ids and hard merge conflicts
   * on real, non-regenerable decision packets). Allocation no longer reads the
   * filesystem, so the per-machine decision lock is gone — it only ever
   * serialised the now-removed directory walk.
   */
  nextDecisionId(): string {
    return `D-${ulid()}`;
  }

  writePending(packet: DecisionPacket): string {
    this.initialize();
    const existingTaskPending = this.findPendingDecisionForTask(packet.task_session_id);
    if (existingTaskPending && existingTaskPending !== packet.decision_id) {
      throw new Error(
        `Task ${packet.task_session_id} already has a pending decision (${existingTaskPending}).`,
      );
    }
    this.enforcePendingCap(packet.decision_id);
    this.assertWritablePacket(packet);
    const path = this.packetPath(PATHS.DECISIONS_PENDING_DIR, packet.decision_id);
    atomicWriteJson(path, packet);
    this.appendAudit('decision-pending-written', packet);
    this.emit(decisionPausedEvent(packet, this.relativePendingPath(packet.decision_id)));
    return path;
  }

  /**
   * Refuse a *new* pending packet once the project's pending cap is reached.
   * Re-writing an already-pending packet (same `decisionId`) never trips the
   * cap, since it is excluded from the count. Emits `decision-cap-exceeded`
   * before throwing so a consumer learns of the refusal even though the throw
   * is caught upstream.
   */
  private enforcePendingCap(decisionId: string): void {
    const cap = this.maxPendingDecisions();
    const pendingCount = this.listPendingDecisionIds().filter((id) => id !== decisionId).length;
    if (pendingCount >= cap) {
      this.emit(decisionCapExceededEvent(pendingCount, cap));
      throw new DecisionCapExceededError(pendingCount, cap);
    }
  }

  private maxPendingDecisions(): number {
    const configured = readProjectProfile(this.projectRoot)?.custom?.decisions?.max_pending;
    return typeof configured === 'number' && configured > 0 ? configured : MAX_PENDING_DECISIONS;
  }

  /**
   * Discard a pending packet with a reason (PQD-101): remove the pending file
   * (never copying it to the resolved directory), record a `decision-discarded`
   * audit entry, emit a `decision-discarded` event, and return the removed
   * packet so a caller has the full context. Throws when no valid pending
   * packet exists for the id.
   */
  discard(input: DiscardDecisionInput): DecisionPacket {
    this.initialize();
    const result = this.readPendingResult(input.decisionId);
    if (!result.packet) {
      throw new Error(
        `Cannot discard decision ${input.decisionId}: no valid pending packet${
          result.error ? ` (${result.error})` : ''
        }.`,
      );
    }
    const packet = result.packet;
    this.deletePending(input.decisionId);
    this.appendAudit('decision-discarded', packet);
    this.emit(decisionDiscardedEvent(packet.decision_id, input.reason));
    return packet;
  }

  private emit(event: Parameters<DecisionEventSink>[0]): void {
    this.onEvent?.(event);
  }

  private relativePendingPath(decisionId: string): string {
    return `${PATHS.DECISIONS_PENDING_DIR}/${decisionId}.json`;
  }

  resolve(input: ResolveDecisionInput): string {
    const pending = this.readPending(input.decisionId);
    if (!pending) {
      throw new Error(`Pending decision ${input.decisionId} not found.`);
    }

    const resolved = this.writeResolvedPacket({
      packet: pending,
      humanResponse: input.humanResponse,
      event:
        input.humanResponse.intent === 'delegated'
          ? 'decision-delegated'
          : 'decision-resolved-by-human',
      respondedByProvider: input.respondedByProvider,
    });
    unlinkSync(this.packetPath(PATHS.DECISIONS_PENDING_DIR, input.decisionId));

    return this.packetPath(PATHS.DECISIONS_RESOLVED_DIR, resolved.decision_id);
  }

  resolveExisting(input: ResolveExistingDecisionInput): string {
    const resolved = this.writeResolvedPacket(input);
    return this.packetPath(PATHS.DECISIONS_RESOLVED_DIR, resolved.decision_id);
  }

  deferUndeclaredDecision(input: DeferUndeclaredDecisionInput): string {
    const path = this.writePending(input.packet);
    this.appendAudit('undeclared-decision-flagged', input.packet, input.provider);
    return path;
  }

  findReusableDecision(
    packet: Pick<DecisionPacket, 'fingerprint' | 'category' | 'options'>,
  ): string | null {
    const index = this.readIndex();
    const exactDecisionId = index.fingerprints[packet.fingerprint];
    if (exactDecisionId) {
      const exactMatch = this.readReusableDecision(exactDecisionId);
      if (exactMatch) {
        this.appendAudit('decision-reused', exactMatch);
        return exactDecisionId;
      }
      delete index.fingerprints[packet.fingerprint];
      this.writeIndex(index);
    }

    const packetOptionKeys = packet.options.map((option) => option.option_key);
    let bestMatch: { id: string; score: number } | null = null;
    for (const entry of Object.values(index.decisions)) {
      if (entry.category !== packet.category || entry.chosen_option_key === null) {
        continue;
      }
      if (!packetOptionKeys.includes(entry.chosen_option_key)) {
        continue;
      }
      const resolved = this.readReusableDecision(entry.decision_id);
      if (!resolved) {
        continue;
      }
      const score = scoreDecisionOptionOverlap(packetOptionKeys, entry.option_keys);
      if (score >= 0.8 && (bestMatch === null || score > bestMatch.score)) {
        bestMatch = { id: entry.decision_id, score };
      }
    }

    if (bestMatch) {
      const resolved = this.readResolved(bestMatch.id);
      if (resolved) {
        this.appendAudit('decision-reused', resolved);
      }
    }
    return bestMatch?.id ?? null;
  }

  readPending(decisionId: string): DecisionPacket | null {
    return this.readPacket(this.packetPath(PATHS.DECISIONS_PENDING_DIR, decisionId));
  }

  readPendingResult(decisionId: string): ReadPendingResult {
    const path = this.packetPath(PATHS.DECISIONS_PENDING_DIR, decisionId);
    if (!existsSync(path)) {
      return { packet: null };
    }
    try {
      return { packet: this.readPacket(path) };
    } catch (error) {
      return {
        packet: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  readResolved(decisionId: string): DecisionPacket | null {
    return this.readPacket(this.packetPath(PATHS.DECISIONS_RESOLVED_DIR, decisionId));
  }

  deletePending(decisionId: string): void {
    const path = this.packetPath(PATHS.DECISIONS_PENDING_DIR, decisionId);
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }

  listPendingDecisionIds(): string[] {
    return this.listDirectoryIds(PATHS.DECISIONS_PENDING_DIR).sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }),
    );
  }

  findPendingDecisionForTask(taskSessionId: string): string | null {
    const ids = this.listPendingDecisionIds();
    let malformedFallback: string | null = null;
    for (const decisionId of ids) {
      const result = this.readPendingResult(decisionId);
      if (result.packet?.task_session_id === taskSessionId) {
        return decisionId;
      }
      if (!result.packet && result.error && ids.length === 1) {
        malformedFallback = decisionId;
      }
    }
    return malformedFallback;
  }

  expireResolvedDecision(decisionId: string): string {
    const source = this.packetPath(PATHS.DECISIONS_RESOLVED_DIR, decisionId);
    const target = this.packetPath(PATHS.DECISIONS_EXPIRED_DIR, decisionId);
    const packet = this.readResolved(decisionId);
    if (!packet) {
      throw new Error(`Resolved decision ${decisionId} not found.`);
    }
    const expired: DecisionPacket = { ...packet, status: 'expired' };
    atomicWriteJson(target, expired);
    unlinkSync(source);
    const index = this.readIndex();
    if (index.fingerprints[packet.fingerprint] === decisionId) {
      delete index.fingerprints[packet.fingerprint];
    }
    if (index.decisions[decisionId]) {
      index.decisions[decisionId] = { ...index.decisions[decisionId], status: 'expired' };
    }
    this.writeIndex(index);
    this.appendAudit('decision-expired', expired);
    return target;
  }

  hasInvalidation(packet: DecisionPacket): boolean {
    if (!packet.human_response?.responded_at) {
      return false;
    }
    const respondedAt = new Date(packet.human_response.responded_at).getTime();
    return packet.invalidation_watch.some((path) => {
      const absolute = join(this.projectRoot, path);
      return existsSync(absolute) && statSync(absolute).mtimeMs > respondedAt;
    });
  }

  private readPacket(path: string): DecisionPacket | null {
    if (!existsSync(path)) {
      return null;
    }
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!isDecisionPacket(parsed)) {
      const reasons = validateDecisionPacket(parsed).join('; ');
      // PQD-107: surface the stable taxonomy code so a consumer can route the
      // corrupt-packet failure mode without parsing the message. Message text
      // is preserved for existing callers/assertions.
      const decisionId =
        typeof (parsed as { decision_id?: unknown })?.decision_id === 'string'
          ? (parsed as { decision_id: string }).decision_id
          : basename(path).replace(/\.json$/, '');
      throw new DecisionPacketCorruptError(`Decision packet at ${path} is invalid. ${reasons}`, {
        decision_id: decisionId,
        reason: reasons,
        packet_path: relative(this.projectRoot, path),
      });
    }
    return parsed;
  }

  private readReusableDecision(decisionId: string): DecisionPacket | null {
    const packet = this.readResolved(decisionId);
    if (!packet) {
      return null;
    }
    if (packet.status !== 'resolved' && packet.status !== 'delegated') {
      return null;
    }
    if (packet.human_response?.chosen_option_key === null) {
      return null;
    }
    if (isExpired(packet)) {
      this.expireResolvedDecision(decisionId);
      return null;
    }
    if (this.hasInvalidation(packet)) {
      this.expireResolvedDecision(decisionId);
      return null;
    }
    return packet;
  }

  private assertWritablePacket(packet: DecisionPacket): void {
    const validationErrors = validateDecisionPacket(packet);
    if (validationErrors.length > 0) {
      throw new Error(
        `Decision packet ${packet.decision_id} is invalid: ${validationErrors.join('; ')}`,
      );
    }
    const copyIssues = lintDecisionCopy(packet);
    if (copyIssues.length > 0) {
      throw new Error(
        `Decision packet ${packet.decision_id} failed copy lint: ${copyIssues
          .map((issue) => `${issue.field} ${issue.message}`)
          .join('; ')}`,
      );
    }
  }

  private appendAudit(
    event: DecisionAuditEventType,
    packet: DecisionPacket,
    provider = packet.requested_by,
  ): void {
    appendDecisionAuditEvent(this.projectRoot, {
      event,
      decision_id: packet.decision_id,
      fingerprint: packet.fingerprint,
      task_session_id: packet.task_session_id,
      provider,
      timestamp: new Date().toISOString(),
      category: packet.category,
      responded_by: packet.human_response?.responded_by,
      chosen_option_key: packet.human_response?.chosen_option_key ?? null,
      intent: packet.human_response?.intent,
    });
  }

  private readIndex(): DecisionIndexFile {
    this.initialize();
    return JSON.parse(readFileSync(this.indexPath(), 'utf8')) as DecisionIndexFile;
  }

  private writeIndex(index: DecisionIndexFile): void {
    atomicWriteJson(this.indexPath(), index);
  }

  private indexPath(): string {
    return join(this.projectRoot, PATHS.DECISIONS_INDEX);
  }

  private packetPath(root: string, decisionId: string): string {
    return join(this.projectRoot, root, `${decisionId}.json`);
  }

  private listDirectoryIds(relativeDir: string): string[] {
    const absoluteDir = join(this.projectRoot, relativeDir);
    if (!existsSync(absoluteDir)) {
      return [];
    }
    // Accept both legacy numeric ids (`D-7.json`) and new ULID ids
    // (`D-01J9Z3K7QW8X….json`) so a directory holding a mix of both lists
    // without dropping either (issue #184, B3).
    return readdirSync(absoluteDir)
      .filter((file) => /^D-(?:\d+|[0-9A-HJKMNP-TV-Z]{26})\.json$/.test(file))
      .map((file) => file.replace(/\.json$/, ''));
  }

  private writeResolvedPacket(input: ResolveExistingDecisionInput): DecisionPacket {
    const resolved: DecisionPacket = {
      ...input.packet,
      status: input.humanResponse.intent === 'delegated' ? 'delegated' : 'resolved',
      human_response: input.humanResponse,
    };
    const resolvedPath = this.packetPath(PATHS.DECISIONS_RESOLVED_DIR, resolved.decision_id);
    this.supersedeConflictingDecision(resolved);
    atomicWriteJson(resolvedPath, resolved);

    const index = this.readIndex();
    index.fingerprints[resolved.fingerprint] = resolved.decision_id;
    index.decisions[resolved.decision_id] = {
      decision_id: resolved.decision_id,
      fingerprint: resolved.fingerprint,
      category: resolved.category,
      chosen_option_key: resolved.human_response?.chosen_option_key ?? null,
      responded_at: resolved.human_response?.responded_at ?? resolved.created_at,
      status: resolved.status,
      option_keys: resolved.options.map((option) => option.option_key).sort(),
    };
    this.writeIndex(index);
    this.appendAudit(input.event, resolved, input.respondedByProvider);
    this.emit(decisionResolvedEvent(resolved, resolverFromAuditEvent(input.event)));
    return resolved;
  }

  private supersedeConflictingDecision(packet: DecisionPacket): void {
    const index = this.readIndex();
    const existingDecisionId = index.fingerprints[packet.fingerprint];
    if (!existingDecisionId || existingDecisionId === packet.decision_id) {
      return;
    }

    const existing = this.readResolved(existingDecisionId);
    if (!existing) {
      return;
    }

    if (existing.human_response?.chosen_option_key === packet.human_response?.chosen_option_key) {
      return;
    }

    const superseded: DecisionPacket = { ...existing, status: 'superseded' };
    atomicWriteJson(this.packetPath(PATHS.DECISIONS_RESOLVED_DIR, existingDecisionId), superseded);
    index.decisions[existingDecisionId] = {
      ...index.decisions[existingDecisionId],
      status: 'superseded',
    };
    this.writeIndex(index);
    this.appendAudit('decision-superseded', superseded);
  }
}

function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2) + '\n');
  renameSync(tempPath, path);
}

function isExpired(packet: DecisionPacket): boolean {
  return Date.parse(packet.ttl_until) <= Date.now();
}

/** Map the audit event recorded on resolution to a short `resolver` token. */
function resolverFromAuditEvent(event: DecisionAuditEventType): string {
  switch (event) {
    case 'decision-resolved-by-human':
    case 'decision-delegated':
      return 'human';
    case 'decision-resolved-by-rule':
      return 'rule';
    case 'decision-resolved-by-rag-confident':
      return 'rag-confident';
    case 'decision-resolved-by-memoization':
      return 'memoization';
    default:
      return event;
  }
}
