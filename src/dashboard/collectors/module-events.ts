import { readModuleMapEvents } from '@/module-decisions/events.js';
import type { ModuleMapEvent, ModuleMapEventType } from '@/module-decisions/events.js';

import type { AttentionItem, SectionData } from '../types.js';

const HELPER = {
  what: 'Append-only audit log of every accepted module decision, reconciliation, and health rollup. Written to .paqad/module-map/events.jsonl by `paqad-ai module-decisions`, `paqad-ai module-map reconcile`, and `paqad-ai module-health rollup`.',
  goodLooksLike:
    'Recent entries from each of: module.declared, module.reconciled, module.health.rolled-up. Investigate quiet streams (no rollups in the last week could mean the checks stage stopped firing).',
} as const;

const RECENT_LIMIT = 10;

export interface ModuleEventsResult {
  section: SectionData;
  attention: AttentionItem[];
}

function groupByType(events: ModuleMapEvent[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of events) {
    out[e.type] = (out[e.type] ?? 0) + 1;
  }
  return out;
}

function lastEventByType(events: ModuleMapEvent[]): Partial<Record<ModuleMapEventType, string>> {
  const out: Partial<Record<ModuleMapEventType, string>> = {};
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e === undefined) continue;
    if (out[e.type] === undefined) out[e.type] = e.ts;
  }
  return out;
}

export function collectModuleEvents(projectRoot: string): ModuleEventsResult {
  const events = readModuleMapEvents(projectRoot);

  if (events.length === 0) {
    return {
      section: {
        id: 'module-events',
        title: 'Module events',
        band: 'unknown',
        score: null,
        summary: 'No module events recorded yet.',
        metrics: [],
        helper: HELPER,
      },
      attention: [],
    };
  }

  const counts = groupByType(events);
  const lastByType = lastEventByType(events);
  const recent = events.slice(-RECENT_LIMIT).reverse();

  const summary = `${events.length} event(s) · ${Object.keys(counts).length} type(s)`;
  const topTypes = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return {
    section: {
      id: 'module-events',
      title: 'Module events',
      band: 'green',
      score: 100,
      summary,
      metrics: topTypes.map(([type, count]) => ({
        label: type,
        value: String(count),
      })),
      helper: HELPER,
      details: {
        total: events.length,
        counts,
        last_by_type: lastByType,
        recent,
      },
    },
    attention: [],
  };
}
