import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

export type SkillAuditEventType =
  'skill.load_failed' | 'skill.pack_load_failed' | 'skill.metadata_deprecated';

export interface SkillLoadFailedEvent {
  ts: string;
  type: 'skill.load_failed';
  path: string;
  validation_error_code: string;
  message: string;
  skill_id: null;
  content_hash: string;
}

export interface SkillPackLoadFailedEvent {
  ts: string;
  type: 'skill.pack_load_failed';
  pack_id: string;
  pack_path: string;
  validation_error_code: string;
  issue_count: number;
  content_hash: string;
}

export interface SkillMetadataDeprecatedEvent {
  ts: string;
  type: 'skill.metadata_deprecated';
  path: string;
  skill: string;
  message: string;
}

export type SkillAuditEvent =
  SkillLoadFailedEvent | SkillPackLoadFailedEvent | SkillMetadataDeprecatedEvent;

const AUDIT_EVENT_TYPES: ReadonlySet<string> = new Set<SkillAuditEventType>([
  'skill.load_failed',
  'skill.pack_load_failed',
  'skill.metadata_deprecated',
]);

export const DEFAULT_SKILL_AUDIT_BUFFER_CAPACITY = 50;

export class SkillAuditBuffer {
  private readonly events: SkillAuditEvent[] = [];

  constructor(private readonly capacity: number = DEFAULT_SKILL_AUDIT_BUFFER_CAPACITY) {}

  get size(): number {
    return this.events.length;
  }

  add(event: SkillAuditEvent): void {
    this.events.push(event);
    while (this.events.length > this.capacity) {
      this.events.shift();
    }
  }

  snapshot(): SkillAuditEvent[] {
    return [...this.events];
  }

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

export function getSharedSkillAuditBuffer(): SkillAuditBuffer {
  sharedBuffer ??= new SkillAuditBuffer();
  return sharedBuffer;
}

function eventsPath(projectRoot: string): string {
  return join(projectRoot, PATHS.SKILL_AUDIT_EVENTS_LOG);
}

export function appendSkillAuditEvent(projectRoot: string, event: SkillAuditEvent): void {
  const path = eventsPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(event) + '\n', 'utf8');
}

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
      if (typeof parsed === 'object' && parsed !== null && AUDIT_EVENT_TYPES.has(parsed.type)) {
        out.push(parsed);
      }
    } catch {}
  }
  return out;
}

const shownDeprecations = new Set<string>();

function deprecationKey(event: SkillMetadataDeprecatedEvent): string {
  return `${event.path}\n${event.message}`;
}

export function recordSkillMetadataDeprecation(
  event: SkillMetadataDeprecatedEvent,
  projectRoot: string | undefined,
  warn: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): boolean {
  const key = deprecationKey(event);
  if (shownDeprecations.has(key)) return false;
  shownDeprecations.add(key);
  if (projectRoot !== undefined) {
    const seen = readSkillAuditEvents(projectRoot).some(
      (prior) => prior.type === 'skill.metadata_deprecated' && deprecationKey(prior) === key,
    );
    if (seen) return false;
    try {
      appendSkillAuditEvent(projectRoot, event);
    } catch {}
  }
  warn(`paqad: ${event.message}`);
  return true;
}

export function clearShownSkillMetadataDeprecations(): void {
  shownDeprecations.clear();
}
