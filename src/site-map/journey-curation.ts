import type { Journey } from '@/core/types/site-map.js';

import { recordJourneyCuration } from './ledger.js';
import { readJourney, removeJourney, writeJourney } from './store.js';

export type JourneyCurationAction = 'confirm' | 'reject';

export interface JourneyCurationOk {
  ok: true;
  journey: Journey | null;
  removed: boolean;
}

export interface JourneyCurationErr {
  ok: false;
  reason: string;
}

export type JourneyCurationResult = JourneyCurationOk | JourneyCurationErr;

export function confirmJourney(journey: Journey): JourneyCurationResult {
  if (journey.status !== 'proposed') {
    return {
      ok: false,
      reason: `journey "${journey.id}" is ${journey.status}, not proposed — only a proposed journey can be confirmed`,
    };
  }
  return {
    ok: true,
    journey: { ...journey, status: 'confirmed', derivation: 'human' },
    removed: false,
  };
}

export function rejectJourney(journey: Journey): JourneyCurationResult {
  if (journey.status !== 'proposed') {
    return {
      ok: false,
      reason: `journey "${journey.id}" is ${journey.status}, not proposed — a confirmed or locked journey is not rejectable`,
    };
  }
  return { ok: true, journey: null, removed: true };
}

export function curateJourney(
  journey: Journey,
  action: JourneyCurationAction,
): JourneyCurationResult {
  return action === 'confirm' ? confirmJourney(journey) : rejectJourney(journey);
}

export interface RunJourneyCurationOptions {
  projectRoot: string;
  id: string;
  action: JourneyCurationAction;
  sessionId?: string | null;
  now?: () => Date;
}

export type RunJourneyCurationResult =
  | { ok: true; id: string; action: JourneyCurationAction; status: 'confirmed' | 'removed' }
  | { ok: false; reason: string };

export function runJourneyCuration(options: RunJourneyCurationOptions): RunJourneyCurationResult {
  const { projectRoot, id, action } = options;
  const journey = readJourney(projectRoot, id);
  if (!journey) {
    return {
      ok: false,
      reason: `no journey "${id}" found under docs/site-map/journeys/`,
    };
  }

  const result = curateJourney(journey, action);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  const status: 'confirmed' | 'removed' = result.removed ? 'removed' : 'confirmed';
  if (result.removed) {
    removeJourney(projectRoot, id);
  } else {
    writeJourney(projectRoot, result.journey!);
  }
  recordJourneyCuration(
    projectRoot,
    { journey_id: id, action, status },
    { sessionId: options.sessionId, now: options.now },
  );

  return { ok: true, id, action, status };
}
