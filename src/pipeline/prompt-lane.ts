import type { ClassificationResult } from '@/core/types/classification.js';
import type { Lane } from '@/core/types/routing.js';
import { isBundleClosed } from '@/feature-evidence/adoption.js';
import { readChangeConstants } from '@/feature-evidence/feature-record.js';
import { laneRank } from '@/feature-evidence/lane-rank.js';
import { readSessionControl } from '@/feature-evidence/session-control.js';
import { readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { hasOpenUnendedStage, liveStageAgents } from '@/stage-evidence/completion-deferred.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { paqadFrameLead } from '@/core/constants/paqad-voice.js';
import { appendHooksLog } from '@/core/logging/hooks-log.js';
import type { FeatureChangeKind } from '@/feature-evidence/types.js';
import { writePendingKind, writePendingLane } from '@/stage-evidence/pending-lane.js';

import { RequestClassifier } from './classifier.js';
import { STAGE_ORDER } from './feature-development-policy.js';
import { PipelineRouter } from './router.js';
import {
  changeKindForWorkflow,
  isFeatureDevelopmentRoute,
  resolveRoutedWorkflow,
  type RoutedWorkflow,
} from './routed-workflow.js';
import { appendRouteTurn } from './route-turns.js';
import { writeSessionRoute } from './session-route.js';
import {
  readWorkflowState,
  routeWorkflow,
  writeWorkflowState,
  type WorkflowEntry,
  type WorkflowState,
} from './workflow-state.js';

const LANE_REASON: Record<Lane, string> = {
  fast: 'small, low-risk change — quick path, no full spec needed',
  graduated: 'a moderate change — I set up spec-before-build for it',
  full: 'risky or wide-reaching — full path (spec → build → verify)',
};

const ROUTE_REASON: Record<RoutedWorkflow, string> = {
  'feature-development': 'a code change — the full build path',
  'project-question': 'a question about the project — no code change',
  'documentation-update': 'creating or refreshing the project documentation',
  'module-documentation': 'documenting a module',
  pentest: 'a security test of the app',
  'design-test': 'auditing the UI against the design system',
  'codebase-health':
    'a health check-up of the codebase — dead code, risky deps, secrets, stale docs',
  'site-map': "mapping the app's surfaces, navigation, and journeys against the code",
  'rules-analyze': 'analysing which rules can become scripts',
  'root-cause-analysis': 'a post-incident root-cause analysis',
  discovery: 'shaping an uncertain idea into a practical next step — no code yet',
  'no-workflow': 'just chatting — nothing to set up',
};

export const SYSTEM_NOTIFICATION_ELEMENTS: readonly string[] = [
  'task-notification',
  'ci-monitor-event',
  'background-task-notification',
];

export const SYSTEM_NOTIFICATION_BANNER = '[system notification - not user input]';

export const SUBAGENT_HANDBACK_MARKERS = {
  element: 'agent-message',
  label: '[subagent hand-back]',
} as const;

const BARE_LINK_SOURCE = 'https?://\\S+|#\\d+|\\b[A-Z][A-Z0-9]+-\\d+\\b';
const BARE_LINK_RE = new RegExp(BARE_LINK_SOURCE);
const BARE_LINK_STRIP_RE = new RegExp(BARE_LINK_SOURCE, 'g');

export const BARE_TICKET_FILLER: ReadonlySet<string> = new Set([
  'implement',
  'fix',
  'fixes',
  'change',
  'update',
  'refactor',
  'rework',
  'rename',
  'build',
  'make',
  'create',
  'add',
  'wire',
  'do',
  'get',
  'getting',
  'working',
  'work',
  'this',
  'that',
  'it',
  'the',
  'a',
  'an',
  'and',
  'or',
  'please',
  'thanks',
  'thank',
  'ticket',
  'issue',
  'issues',
  'task',
  'item',
  'pr',
  'on',
  'for',
  'to',
  'in',
  'of',
  'see',
  'link',
  'resolve',
  'close',
  'closes',
  'handle',
  'complete',
  'small',
  'commits',
  'commit',
  'watch',
  'green',
  'ci',
  'review',
  'merge',
  'branch',
  'per',
  'with',
  'from',
  'plus',
  'let',
  'lets',
  'can',
  'you',
  'your',
  'my',
  'our',
  'us',
  'we',
  'up',
  'out',
  'now',
  'just',
  'also',
  'then',
  'next',
  'step',
  'steps',
  'follow',
  'following',
  'above',
  'below',
  'here',
  'there',
  'go',
  'ahead',
  'start',
  'finish',
  'done',
  'ok',
  'okay',
]);

export function isBareTicketPrompt(prompt: string): boolean {
  if (!BARE_LINK_RE.test(prompt)) return false;
  const stripped = prompt.replace(BARE_LINK_STRIP_RE, ' ');
  const words = stripped.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return words.every((word) => BARE_TICKET_FILLER.has(word));
}

export function isSystemNotificationPrompt(prompt: string): boolean {
  const head = prompt.trimStart().toLowerCase();
  if (head.startsWith(SYSTEM_NOTIFICATION_BANNER)) {
    return true;
  }
  if (startsWithNotificationElement(head)) {
    return true;
  }
  const lines = head.split(/\r?\n/).map((line) => line.trim());
  if (
    lines.includes(SYSTEM_NOTIFICATION_BANNER) &&
    lines.some((line) => startsWithNotificationElement(line))
  ) {
    return true;
  }
  return isSubagentHandBack(lines);
}

function isSubagentHandBack(lines: readonly string[]): boolean {
  const element = SUBAGENT_HANDBACK_MARKERS.element;
  const opensElement = lines.some(
    (line) => line.startsWith(`<${element} `) || line.startsWith(`<${element}>`),
  );
  return opensElement && lines.some((line) => line.startsWith(SUBAGENT_HANDBACK_MARKERS.label));
}

function startsWithNotificationElement(text: string): boolean {
  return SYSTEM_NOTIFICATION_ELEMENTS.some((element) => text.startsWith(`<${element}>`));
}

export const SLASH_COMMAND_ROUTES: Readonly<Record<string, RoutedWorkflow>> = {
  'paqad-discover': 'discovery',
  'paqad-ask': 'project-question',
};

const SLASH_COMMAND_RE = /^\/([A-Za-z0-9:_-]+)(\s|$)/;

export function slashCommandName(prompt: string): string | null {
  const match = SLASH_COMMAND_RE.exec(prompt.trimStart());
  if (!match) {
    return null;
  }
  const full = match[1]!;
  const lastColon = full.lastIndexOf(':');
  return lastColon === -1 ? full : full.slice(lastColon + 1);
}

export interface PromptRouteDeps {
  classify?: (input: { request: string }) => Promise<ClassificationResult>;
  route?: (classification: ClassificationResult) => { lane: Lane | null };
  now?: () => Date;
}

export interface PromptRouteResult {
  routed: RoutedWorkflow;
  lane: Lane | null;
  reason: string;
  kind?: FeatureChangeKind;
}

export async function resolvePromptRoute(
  projectRoot: string,
  request: string,
  deps: PromptRouteDeps = {},
): Promise<PromptRouteResult> {
  const classify =
    deps.classify ?? ((input) => new RequestClassifier({ projectRoot }).classify(input));
  const route = deps.route ?? ((classification) => new PipelineRouter().route(classification));

  const classification = await classify({ request });
  const routed = resolveRoutedWorkflow(classification.workflow);
  if (isBareTicketPrompt(request)) {
    return {
      routed: 'feature-development',
      ...(isFeatureDevelopmentRoute(routed)
        ? { kind: changeKindForWorkflow(classification.workflow) }
        : {}),
      lane: null,
      reason: 'reading the ticket before I set the depth — no lane guessed from a bare link',
    };
  }
  if (!isFeatureDevelopmentRoute(routed)) {
    return { routed, lane: null, reason: ROUTE_REASON[routed] };
  }
  const kind = changeKindForWorkflow(classification.workflow);
  const { lane } = route(classification);
  return {
    routed,
    kind,
    lane,
    reason: lane === null ? ROUTE_REASON['feature-development'] : LANE_REASON[lane],
  };
}

export interface PromptRouteSeamInput {
  projectRoot: string;
  request: string;
  sessionId: string | null;
  adapter: string;
}

export interface PromptRouteSeamResult {
  routed: RoutedWorkflow;
  lane: Lane | null;
  resumed: WorkflowEntry | null;
  narration: string | null;
  notification?: true;
}

function narrateRoute(
  routed: RoutedWorkflow,
  lane: Lane | null,
  reason: string,
  resumed: WorkflowEntry | null,
): string | null {
  if (routed === 'no-workflow') {
    return null;
  }
  const verb = resumed ? 'resumed' : 'routed to';
  if (routed === 'feature-development' && lane !== null) {
    return paqadFrameLead(`${verb} feature-development, ${lane} lane (${reason})`);
  }
  return paqadFrameLead(`${verb} ${routed} (${reason})`);
}

const OPEN_CHANGE_STAGE_REASON = 'a step of the change already open in this session';

const STAGE_NAME_OVERRIDABLE_ROUTES: ReadonlySet<RoutedWorkflow> = new Set<RoutedWorkflow>([
  'documentation-update',
  'project-question',
  'no-workflow',
]);

const STAGE_NAME_RE = new RegExp(
  `\\b(?:${STAGE_ORDER.map((stage) => stage.replace(/_/g, '[_ ]')).join('|')})\\b`,
  'i',
);

function namesStageOfOpenChange(
  projectRoot: string,
  sessionId: string,
  prior: WorkflowState,
  request: string,
): boolean {
  if (!STAGE_NAME_RE.test(request)) {
    return false;
  }
  if (prior.active !== null && isFeatureDevelopmentRoute(prior.active.workflow)) {
    return true;
  }
  const open = readSessionControl(projectRoot, sessionId).active;
  return open !== null && !isBundleClosed(projectRoot, open);
}

const RUNNING_CHANGE_REASON = 'the change open in this session is still running';
const RECORDED_LANE_REASON = 'the lane recorded on this change';

function openChangeOf(projectRoot: string, sessionId: string): string | null {
  const open = readSessionControl(projectRoot, sessionId).active;
  return open !== null && !isBundleClosed(projectRoot, open) ? open : null;
}

function changeIsRunning(projectRoot: string, dirName: string | null): boolean {
  if (dirName === null) return false;
  const rows = readFeatureStageUnit(projectRoot, dirName);
  return hasOpenUnendedStage(rows) || liveStageAgents(rows).length > 0;
}

export async function runPromptRouteSeam(
  input: PromptRouteSeamInput,
  deps: PromptRouteDeps = {},
): Promise<PromptRouteSeamResult> {
  if (isSystemNotificationPrompt(input.request)) {
    return {
      routed: 'no-workflow',
      lane: null,
      resumed: null,
      narration: null,
      notification: true,
    };
  }

  const slashName = slashCommandName(input.request);
  let routed: RoutedWorkflow;
  let lane: Lane | null;
  let reason: string;
  let kind: FeatureChangeKind | undefined;
  if (slashName !== null) {
    const slashRoute = SLASH_COMMAND_ROUTES[slashName];
    if (slashRoute === undefined) {
      return {
        routed: 'no-workflow',
        lane: null,
        resumed: null,
        narration: null,
        notification: true,
      };
    }
    routed = slashRoute;
    lane = null;
    reason = ROUTE_REASON[slashRoute];
  } else {
    ({ routed, lane, reason, kind } = await resolvePromptRoute(
      input.projectRoot,
      input.request,
      deps,
    ));
  }
  const sessionId = resolveSessionId(input.projectRoot, input.sessionId);

  const prior = readWorkflowState(input.projectRoot, sessionId);
  if (
    slashName === null &&
    STAGE_NAME_OVERRIDABLE_ROUTES.has(routed) &&
    namesStageOfOpenChange(input.projectRoot, sessionId, prior, input.request)
  ) {
    routed = 'feature-development';
    lane = null;
    kind = undefined;
    reason = OPEN_CHANGE_STAGE_REASON;
  }
  const openChange = openChangeOf(input.projectRoot, sessionId);
  if (
    slashName === null &&
    STAGE_NAME_OVERRIDABLE_ROUTES.has(routed) &&
    changeIsRunning(input.projectRoot, openChange)
  ) {
    routed = 'feature-development';
    lane = null;
    kind = undefined;
    reason = RUNNING_CHANGE_REASON;
  }
  const recordedLane =
    isFeatureDevelopmentRoute(routed) && openChange !== null
      ? readChangeConstants(input.projectRoot, openChange).lane
      : null;
  if (recordedLane !== null && laneRank(recordedLane) >= laneRank(lane)) {
    lane = recordedLane;
    reason = RECORDED_LANE_REASON;
  }
  const anchors = lane === null ? { reason } : { lane, reason };
  const transition = routeWorkflow(prior, routed, anchors);
  const turnStartedAt = (deps.now ?? (() => new Date()))().toISOString();
  writeWorkflowState(input.projectRoot, sessionId, {
    ...transition.state,
    turn_started_at: turnStartedAt,
  });
  try {
    appendRouteTurn(input.projectRoot, sessionId, { at: turnStartedAt, workflow: routed });
  } catch (error) {
    appendHooksLog(
      input.projectRoot,
      `route-turns: append failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (isFeatureDevelopmentRoute(routed) && lane !== null && recordedLane === null) {
    writePendingLane(input.projectRoot, sessionId, lane);
  }
  if (isFeatureDevelopmentRoute(routed) && kind !== undefined) {
    writePendingKind(input.projectRoot, sessionId, kind);
  }

  writeSessionRoute(
    input.projectRoot,
    { workflow: routed, query: input.request, adapter: input.adapter },
    sessionId,
  );

  return {
    routed,
    lane,
    resumed: transition.resumed,
    narration: narrateRoute(routed, lane, reason, transition.resumed),
  };
}
