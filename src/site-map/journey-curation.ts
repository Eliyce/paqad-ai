// Journey curation — the human sign-off that turns a `proposed` journey into a `confirmed` one,
// or removes it. Pure transition logic: the CLI verb a human runs is the audited surface (it
// records a curation row on the session ledger), and this code never self-confirms — it only
// transitions a journey a human explicitly acted on, and only from `proposed`.

import type { Journey } from '@/core/types/site-map.js';

import { recordJourneyCuration } from './ledger.js';
import { readJourney, removeJourney, writeJourney } from './store.js';

export type JourneyCurationAction = 'confirm' | 'reject';

export interface JourneyCurationOk {
  ok: true;
  /** The updated journey to persist (confirm), or null when the journey is removed (reject). */
  journey: Journey | null;
  /** True when the journey file should be deleted (reject). */
  removed: boolean;
}

export interface JourneyCurationErr {
  ok: false;
  reason: string;
}

export type JourneyCurationResult = JourneyCurationOk | JourneyCurationErr;

/**
 * Confirm a `proposed` journey: it becomes `confirmed` and human-derived. A journey that is
 * already `confirmed` or `locked` is refused — confirmation is a one-way, proposed-only step.
 */
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

/**
 * Reject a `proposed` journey: it is removed from the map. A `confirmed` or `locked` journey is
 * refused — rejection only un-proposes an AI-proposed journey a human declined, never destroys a
 * curated one.
 */
export function rejectJourney(journey: Journey): JourneyCurationResult {
  if (journey.status !== 'proposed') {
    return {
      ok: false,
      reason: `journey "${journey.id}" is ${journey.status}, not proposed — a confirmed or locked journey is not rejectable`,
    };
  }
  return { ok: true, journey: null, removed: true };
}

/** Apply a curation action to a journey. The single entry the CLI drives. */
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

/**
 * Read a journey, apply the human curation, persist it (write on confirm, delete on reject), and
 * record the audit row. The verb a human runs is the audited surface; the code never confirms a
 * journey the human did not act on.
 */
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
