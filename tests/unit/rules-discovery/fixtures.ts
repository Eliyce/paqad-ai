import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type { DecisionPacket } from '@/planning/decision-packet.js';

export function resolvedPacket(
  partial: Partial<DecisionPacket> & { decision_id: string },
): DecisionPacket {
  return {
    decision_id: partial.decision_id,
    fingerprint: `sha256:${partial.decision_id}`,
    category: 'architecture-path',
    question: 'Where should request bodies be validated?',
    context: 'api work',
    options: [
      {
        option_key: 'boundary',
        label: 'Validate with zod at the route boundary',
        one_line_preview: 'boundary',
        trade_off: 'one more schema per route',
        evidence: {},
      },
      {
        option_key: 'service',
        label: 'Validate inside each service',
        one_line_preview: 'service',
        trade_off: 'checks spread out',
        evidence: {},
      },
    ],
    confidence: 0.8,
    requested_by: 'engine',
    task_session_id: 'task-1',
    created_at: '2026-06-27T00:00:00.000Z',
    status: 'resolved',
    ttl_until: '2027-12-31T00:00:00.000Z',
    invalidation_watch: [],
    human_response: {
      chosen_option_key: 'boundary',
      intent: 'explicit',
      explanation_rounds_used: 0,
      responded_at: '2026-06-27T01:00:00.000Z',
      responded_by: 'human',
      carry_over_scope: 'task',
      note: 'one place to check input',
    },
    ...partial,
  };
}

export class TempProject {
  readonly root: string;

  constructor(prefix = 'paqad-rd-') {
    this.root = mkdtempSync(join(tmpdir(), prefix));
  }

  write(path: string, body: string): string {
    const abs = join(this.root, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body, 'utf8');
    return abs;
  }

  writeResolved(packet: DecisionPacket): string {
    return this.write(
      join(PATHS.DECISIONS_RESOLVED_DIR, `${packet.decision_id}.json`),
      `${JSON.stringify(packet, null, 2)}\n`,
    );
  }

  dispose(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}
