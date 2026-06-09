import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  DEFAULT_SKILL_AUDIT_BUFFER_CAPACITY,
  SkillAuditBuffer,
  appendSkillAuditEvent,
  emitSkillAuditEvent,
  getSharedSkillAuditBuffer,
  readSkillAuditEvents,
  type SkillLoadFailedEvent,
} from '@/skills/audit-events.js';

function loadFailedEvent(path: string): SkillLoadFailedEvent {
  return {
    ts: '2026-06-09T00:00:00.000Z',
    type: 'skill.load_failed',
    path,
    validation_error_code: 'SKILL_BOUNDARY_MISSING',
    message: `broken: ${path}`,
    skill_id: null,
    content_hash: 'a'.repeat(64),
  };
}

describe('skill audit events', () => {
  it('round-trips appended events to disk', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-audit-'));
    appendSkillAuditEvent(projectRoot, loadFailedEvent('/skills/one.SKILL.md'));
    appendSkillAuditEvent(projectRoot, {
      ts: '2026-06-09T00:00:01.000Z',
      type: 'skill.pack_load_failed',
      pack_id: 'broken-pack',
      pack_path: '/packs/broken-pack',
      validation_error_code: 'PACK_MANIFEST_MISSING',
      issue_count: 1,
      content_hash: 'b'.repeat(64),
    });

    const events = readSkillAuditEvents(projectRoot);
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe('skill.load_failed');
    expect(events[1]?.type).toBe('skill.pack_load_failed');
  });

  it('returns an empty array when the log does not exist', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-audit-'));
    expect(readSkillAuditEvents(projectRoot)).toEqual([]);
  });

  it('drops the oldest event when the buffer is over capacity', () => {
    const buffer = new SkillAuditBuffer(3);
    for (let index = 0; index < 5; index += 1) {
      buffer.add(loadFailedEvent(`/skills/${index}.SKILL.md`));
    }

    const snapshot = buffer.snapshot() as SkillLoadFailedEvent[];
    expect(snapshot).toHaveLength(3);
    expect(snapshot.map((event) => event.path)).toEqual([
      '/skills/2.SKILL.md',
      '/skills/3.SKILL.md',
      '/skills/4.SKILL.md',
    ]);
  });

  it('flushes all buffered events to disk in order, then clears the buffer', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-audit-'));
    const buffer = new SkillAuditBuffer();
    buffer.add(loadFailedEvent('/skills/first.SKILL.md'));
    buffer.add(loadFailedEvent('/skills/second.SKILL.md'));

    buffer.flush(projectRoot);

    expect(buffer.size).toBe(0);
    const events = readSkillAuditEvents(projectRoot) as SkillLoadFailedEvent[];
    expect(events.map((event) => event.path)).toEqual([
      '/skills/first.SKILL.md',
      '/skills/second.SKILL.md',
    ]);
  });

  it('buffers when no projectRoot is available and does not write to disk', () => {
    const buffer = new SkillAuditBuffer();
    emitSkillAuditEvent(loadFailedEvent('/skills/buffered.SKILL.md'), undefined, buffer);
    expect(buffer.size).toBe(1);
  });

  it('delivers previously buffered events first when a projectRoot reconnects', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-audit-'));
    const buffer = new SkillAuditBuffer();

    // Sink unavailable: events accumulate in emission order.
    emitSkillAuditEvent(loadFailedEvent('/skills/early-1.SKILL.md'), undefined, buffer);
    emitSkillAuditEvent(loadFailedEvent('/skills/early-2.SKILL.md'), undefined, buffer);
    expect(buffer.size).toBe(2);

    // Sink reconnects: the new event and the backlog flush together, in order.
    emitSkillAuditEvent(loadFailedEvent('/skills/live.SKILL.md'), projectRoot, buffer);

    expect(buffer.size).toBe(0);
    const events = readSkillAuditEvents(projectRoot) as SkillLoadFailedEvent[];
    expect(events.map((event) => event.path)).toEqual([
      '/skills/early-1.SKILL.md',
      '/skills/early-2.SKILL.md',
      '/skills/live.SKILL.md',
    ]);
  });

  it('exposes a process-wide shared buffer and a documented default capacity', () => {
    expect(DEFAULT_SKILL_AUDIT_BUFFER_CAPACITY).toBe(50);
    expect(getSharedSkillAuditBuffer()).toBe(getSharedSkillAuditBuffer());
  });

  it('does not create the log file merely by reading', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-audit-'));
    readSkillAuditEvents(projectRoot);
    expect(existsSync(join(projectRoot, PATHS.SKILL_AUDIT_EVENTS_LOG))).toBe(false);
  });
});
