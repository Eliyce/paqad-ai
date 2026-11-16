import { appendEvent, readEvents } from './events.js';
import { readRun } from './run-store.js';
import { STAGE_IDS, type JourneyEvent, type JourneyRun } from './types.js';

export function processSession(env: NodeJS.ProcessEnv = process.env): string {
  return env.SE_SESSION ?? env.CLAUDE_SESSION_ID ?? 'unknown';
}

export function journeySessions(run: JourneyRun, events: readonly JourneyEvent[]): Set<string> {
  const sessions = new Set([run.owner_session]);
  for (const event of events) {
    if (event.kind !== 'handover') continue;
    if (event.session) sessions.add(event.session);
    const from = event.note?.replace(/^from /u, '');
    if (from) sessions.add(from);
  }
  return sessions;
}

export interface NoteDecisionOptions {
  session?: string;
  now?: () => Date;
}

export function noteJourneyDecision(
  projectRoot: string,
  decisionId: string,
  options: NoteDecisionOptions = {},
): boolean {
  try {
    const run = readRun(projectRoot);
    if (run === null || run.status !== 'running') return false;
    const stage = STAGE_IDS.find((id) => run.stages[id].status === 'running');
    if (stage === undefined) return false;
    const session = options.session ?? processSession();
    if (!journeySessions(run, readEvents(projectRoot, run.run_id)).has(session)) return false;
    appendEvent(projectRoot, {
      ts: (options.now ?? (() => new Date()))().toISOString(),
      run_id: run.run_id,
      kind: 'decision_open',
      stage,
      session,
      decision_id: decisionId,
    });
    return true;
  } catch {
    return false;
  }
}

export function openedByJourney(projectRoot: string, run: JourneyRun, decisionId: string): boolean {
  return readEvents(projectRoot, run.run_id).some(
    (event) => event.kind === 'decision_open' && event.decision_id === decisionId,
  );
}
