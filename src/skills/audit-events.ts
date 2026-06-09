// .paqad/skills/events.jsonl writer/reader + bounded in-process buffer for
// skill- and pack-load failures (PQD-194).
//
// When the skill loader or pack loader hits a file it cannot register (malformed
// SKILL.md frontmatter, a missing/invalid pack.yaml), it emits a machine-readable
// audit event rather than silently swallowing the failure, so the desktop can
// badge "this skill/pack failed to load" and operators can investigate. The log
// mirrors the append-only JSONL pattern of `appendModuleMapEvent`, but lives in
// its own file so skill concerns never pollute the module-map event stream.
//
// Each event carries a SHA-256 `content_hash` of the offending bytes so the
// consumer can de-duplicate repeated emissions of the same unchanged failure
// (de-dup is a consumer responsibility per the spec; the engine only stamps the
// hash). A successful reload of a previously failing file simply produces no new
// failure event, which lets the consumer clear the badge.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

export type SkillAuditEventType = 'skill.load_failed' | 'skill.pack_load_failed';

/** Emitted when a single SKILL.md fails frontmatter validation and is excluded. */
export interface SkillLoadFailedEvent {
  ts: string;
  type: 'skill.load_failed';
  /** Absolute path to the malformed SKILL.md file. */
  path: string;
  /** Stable sub-code identifying which validation rule fired. */
  validation_error_code: string;
  /** Human-readable summary (the ValidationError message). */
  message: string;
  /** Always null — a malformed file never enters the registry under an id. */
  skill_id: null;
  /** SHA-256 hex of the file bytes, for consumer-side de-duplication. */
  content_hash: string;
}

/** Emitted when a pack is quarantined (missing or invalid pack.yaml). */
export interface SkillPackLoadFailedEvent {
  ts: string;
  type: 'skill.pack_load_failed';
  /** Manifest name, or the last path segment when the id is unrecoverable. */
  pack_id: string;
  /** Absolute path to the pack root directory. */
  pack_path: string;
  /** Stable code identifying the failure class. */
  validation_error_code: string;
  /** Count of error-level validation issues that caused the quarantine. */
  issue_count: number;
  /**
   * SHA-256 hex of the pack.yaml bytes, or of the pack-root path string when the
   * manifest is absent (nothing to hash), for consumer-side de-duplication.
   */
  content_hash: string;
}

export type SkillAuditEvent = SkillLoadFailedEvent | SkillPackLoadFailedEvent;

/**
 * Default capacity of the bounded in-process buffer. No canonical "spec 10
 * event-bus contract" document was found in the engine repo (PQD-194 §8 Q1), so
 * the rule is established locally and documented here: hold at most this many
 * undelivered events, dropping the oldest when full.
 */
export const DEFAULT_SKILL_AUDIT_BUFFER_CAPACITY = 50;

/**
 * Bounded, in-process buffer for audit events that could not be written to disk
 * (no `projectRoot` available, or a disk write failed). Oldest events are
 * dropped when capacity is exceeded; a later {@link flush} delivers the survivors
 * in emission order. A module-level singleton (see
 * {@link getSharedSkillAuditBuffer}) is used by both loaders so buffered events
 * survive across the short-lived loader instances callers create per load pass.
 */
export class SkillAuditBuffer {
  private readonly events: SkillAuditEvent[] = [];

  constructor(private readonly capacity: number = DEFAULT_SKILL_AUDIT_BUFFER_CAPACITY) {}

  /** Number of events currently buffered (undelivered). */
  get size(): number {
    return this.events.length;
  }

  /** Add an event, dropping the oldest if at capacity. */
  add(event: SkillAuditEvent): void {
    this.events.push(event);
    while (this.events.length > this.capacity) {
      this.events.shift();
    }
  }

  /** A copy of the currently buffered events, oldest first. */
  snapshot(): SkillAuditEvent[] {
    return [...this.events];
  }

  /**
   * Deliver every buffered event to disk in emission order, then clear them. An
   * event whose write throws is re-buffered (and may again drop the oldest) so a
   * transient disk fault never loses more than capacity allows.
   */
  flush(projectRoot: string): void {
    const pending = this.events.splice(0, this.events.length);
    for (const event of pending) {
      try {
        appendSkillAuditEvent(projectRoot, event);
      } catch {
        this.add(event);
      }
    }
  }
}

let sharedBuffer: SkillAuditBuffer | null = null;

/** The process-wide buffer shared by the skill and pack loaders. */
export function getSharedSkillAuditBuffer(): SkillAuditBuffer {
  sharedBuffer ??= new SkillAuditBuffer();
  return sharedBuffer;
}

function eventsPath(projectRoot: string): string {
  return join(projectRoot, PATHS.SKILL_AUDIT_EVENTS_LOG);
}

/** Synchronously append one audit event as a JSONL line. */
export function appendSkillAuditEvent(projectRoot: string, event: SkillAuditEvent): void {
  const path = eventsPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(event) + '\n', 'utf8');
}

/**
 * Emit an audit event: when a `projectRoot` is known, flush the buffer (so any
 * previously buffered events are delivered first, preserving order) and persist
 * this one; otherwise hold it in the buffer for a later flush. A disk fault
 * leaves the event safely buffered.
 */
export function emitSkillAuditEvent(
  event: SkillAuditEvent,
  projectRoot: string | undefined,
  buffer: SkillAuditBuffer = getSharedSkillAuditBuffer(),
): void {
  buffer.add(event);
  if (projectRoot !== undefined) {
    buffer.flush(projectRoot);
  }
}

/** Read all audit events from disk; malformed lines are skipped. */
export function readSkillAuditEvents(projectRoot: string): SkillAuditEvent[] {
  const path = eventsPath(projectRoot);
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8');
  const out: SkillAuditEvent[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed = JSON.parse(trimmed) as SkillAuditEvent;
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        (parsed.type === 'skill.load_failed' || parsed.type === 'skill.pack_load_failed')
      ) {
        out.push(parsed);
      }
    } catch {
      // Skip partial/corrupt lines; the log is append-only but a mid-crash write
      // shouldn't poison the whole reader (mirrors readModuleMapEvents).
    }
  }
  return out;
}
