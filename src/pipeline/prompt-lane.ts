// Prompt-seam routing (issues #324, #336).
//
// Wires the EXISTING deterministic classify→route engine into the live session: it
// runs `RequestClassifier` on the prompt text, folds the fine-grained workflow into
// one of the 9 routing outcomes (`resolveRoutedWorkflow`), and — only for the
// `feature-development` outcome — asks `PipelineRouter` for the lane. No new
// classifier, no LLM call.
//
// The seam (`runPromptRouteSeam`) is what the UserPromptSubmit hook calls each
// message: it resolves the outcome, records it in the per-session workflow-state
// (pausing/resuming per #336), stashes the lane for the next change-open (feature-
// development only), and returns a lean `▸ paqad`-style line naming the outcome.
// `no-workflow` (small talk) stashes nothing and narrates nothing.
//
// A host-injected system/background event (a `Monitor` firing, a task completing) reaches
// this seam exactly like a typed prompt, so it is filtered out FIRST (issue #540): it is
// not classified, records no state, and leaves the route the last human prompt set alone.

import type { ClassificationResult } from '@/core/types/classification.js';
import type { Lane } from '@/core/types/routing.js';
import { isBundleClosed } from '@/feature-evidence/adoption.js';
import { readSessionControl } from '@/feature-evidence/session-control.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { paqadFrameLead } from '@/core/constants/paqad-voice.js';
import { writePendingLane } from '@/stage-evidence/pending-lane.js';

import { RequestClassifier } from './classifier.js';
import { STAGE_ORDER } from './feature-development-policy.js';
import { PipelineRouter } from './router.js';
import {
  isFeatureDevelopmentRoute,
  resolveRoutedWorkflow,
  type RoutedWorkflow,
} from './routed-workflow.js';
import { writeSessionRoute } from './session-route.js';
import {
  readWorkflowState,
  routeWorkflow,
  writeWorkflowState,
  type WorkflowEntry,
  type WorkflowState,
} from './workflow-state.js';

/** Plain-language, lane-specific reason (paqad voice — no internal jargon). */
const LANE_REASON: Record<Lane, string> = {
  fast: 'small, low-risk change — quick path, no full spec needed',
  graduated: 'a moderate change — I set up spec-before-build for it',
  full: 'risky or wide-reaching — full path (spec → build → verify)',
};

/** Plain-language reason per routing outcome (paqad voice). */
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

/**
 * Host wrapper elements that mark a turn as a SYSTEM/BACKGROUND event rather than
 * something the developer said (issue #540). One exported constant so a new wrapper is a
 * data change, not an edit to the matcher.
 *
 * These arrive on `UserPromptSubmit` exactly like a typed prompt — a `Monitor` firing on a
 * CI run, a background task finishing — because the host injects them as user turns. The
 * observed payload opens with the element and carries no human request:
 * `<task-notification><task-id>…</task-id><summary>Monitor event: "CI checks on PR #539
 * until all complete"</summary>…</task-notification>`.
 */
export const SYSTEM_NOTIFICATION_ELEMENTS: readonly string[] = [
  'task-notification',
  'ci-monitor-event',
  'background-task-notification',
];

/**
 * The banner the Desktop app prepends to a background-task event (issue #615, Part 2). A
 * finished background agent arrives on `UserPromptSubmit` as a prompt that opens with this
 * line and only then carries a `<task-notification>` element, so the start-anchored element
 * match alone misses it. Compared case-insensitively against the trimmed prompt head.
 */
export const SYSTEM_NOTIFICATION_BANNER = '[system notification - not user input]';

/**
 * The two markers of a foreground subagent hand-back (issue #623). It reaches
 * `UserPromptSubmit` with neither the banner nor `<task-notification>`: a system-reminder
 * wraps an `<agent-message from="…">` element whose first line is the hand-back label, then
 * the subagent's report. Both are compared lower-case against trimmed line starts.
 */
export const SUBAGENT_HANDBACK_MARKERS = {
  element: 'agent-message',
  label: '[subagent hand-back]',
} as const;

// Bare ticket/URL detection (issue #602, FR-5). A URL, or a tracker ref like `#123` or
// `PROJ-123`. Non-global for `.test()` (no lastIndex state); a global twin for stripping.
const BARE_LINK_SOURCE = 'https?://\\S+|#\\d+|\\b[A-Z][A-Z0-9]+-\\d+\\b';
const BARE_LINK_RE = new RegExp(BARE_LINK_SOURCE);
const BARE_LINK_STRIP_RE = new RegExp(BARE_LINK_SOURCE, 'g');

/**
 * Process, delivery, and filler words that carry no description of the WORK. A prompt whose only
 * content beyond a link is words from this set (issue #602) is "essentially just a ticket" — the
 * WHAT lives entirely behind the link. Deliberately holds no domain words, so "add dark mode
 * #500" ("dark", "mode" survive) is never mistaken for bare.
 */
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

/**
 * Whether `prompt` is essentially just a ticket reference or a URL (issue #602, FR-5). True only
 * when the prompt CONTAINS a link/ticket ref AND, once that link and all process/filler words are
 * removed, nothing describing the work remains. Such a prompt hides a potentially large feature
 * behind one line, so its surface text must not drive the safety lane — the lane is left
 * unresolved-pending-read (surfaced later by the isolation check, not guessed here).
 */
export function isBareTicketPrompt(prompt: string): boolean {
  if (!BARE_LINK_RE.test(prompt)) return false;
  const stripped = prompt.replace(BARE_LINK_STRIP_RE, ' ');
  const words = stripped.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return words.every((word) => BARE_TICKET_FILLER.has(word));
}

/**
 * Whether `prompt` is a host-injected system/background event rather than a developer
 * request (issue #540). Nothing about a monitor event is an ask to build software, so the
 * seam must not route one.
 *
 * Anchored at the START of the payload, so a prompt that merely MENTIONS a wrapper —
 * "why did the `<task-notification>` open a change?", the prompt that filed this very
 * issue — still routes normally. The host emits the element as the whole payload, so the
 * anchor costs nothing and keeps a real question routable.
 *
 * On the Desktop app a background-task event opens with the `[SYSTEM NOTIFICATION - NOT
 * USER INPUT]` banner before the element (issue #615, Part 2), so the banner is a second
 * start anchor. Both are start-anchored, so a human question that only mentions either one
 * still routes.
 *
 * A subagent hand-back can arrive with the subagent's report FIRST and the banner and element
 * after it (issue #623, FR-8), so the start anchors miss it. Such a prompt also counts when the
 * banner is a line of its own AND some line opens with a wrapper element. A human prompt that
 * quotes only one of them, or quotes either one inline, still routes.
 */
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

/**
 * A foreground subagent hand-back (issue #623): no banner and no `<task-notification>`, but a
 * line that opens the `<agent-message …>` element AND a line that opens with the hand-back
 * label. Both must be whole-line openers, so a human prompt that quotes either one inline, or
 * only one of them, still routes. `lines` are trimmed and lower-cased.
 */
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

/**
 * Slash commands that map to a workflow route (issue #615, Part 5). Since Claude Code 2.1.299 the
 * UserPromptSubmit hook sees a slash command as the raw typed line BEFORE it expands, so without
 * this map the classifier would read it as prose. One exported constant so adding a command is a
 * data change; the key is the command NAME (the part after the last `:`, so a plugin-scoped
 * `paqad-product-discovery:paqad-discover` resolves to `paqad-discover`). A command not in this
 * map leaves the stored route unchanged (see runPromptRouteSeam), so `/code-review` or `/compact`
 * never pauses an in-flight change.
 */
export const SLASH_COMMAND_ROUTES: Readonly<Record<string, RoutedWorkflow>> = {
  'paqad-discover': 'discovery',
  'paqad-ask': 'project-question',
};

/** `^/<name>` at the start of the (trimmed) prompt, so a `/path/like/this` mid-sentence is ignored. */
const SLASH_COMMAND_RE = /^\/([A-Za-z0-9:_-]+)(\s|$)/;

/**
 * The command name of a slash-command prompt, or `null` when the prompt is not a slash command
 * (issue #615, Part 5). The name is the segment after the last `:`, so a plugin-scoped command
 * resolves to its bare name.
 */
export function slashCommandName(prompt: string): string | null {
  const match = SLASH_COMMAND_RE.exec(prompt.trimStart());
  if (!match) {
    return null;
  }
  const full = match[1]!;
  const lastColon = full.lastIndexOf(':');
  return lastColon === -1 ? full : full.slice(lastColon + 1);
}

/** Injectable classify/route seam, so the outcome→lane branches are all testable. */
export interface PromptRouteDeps {
  classify?: (input: { request: string }) => Promise<ClassificationResult>;
  route?: (classification: ClassificationResult) => { lane: Lane | null };
  /** Clock seam for the per-turn stamp (issue #582). */
  now?: () => Date;
}

export interface PromptRouteResult {
  /** The chosen routing outcome (one of the 9). */
  routed: RoutedWorkflow;
  /** The lane — non-null ONLY for the feature-development outcome. */
  lane: Lane | null;
  /** Plain-language reason for the pick. */
  reason: string;
}

/**
 * Resolve the routing outcome for a prompt using the deterministic classifier, and
 * (only for feature-development) the lane from the router. Non-feature-development
 * outcomes get `lane: null` — no lane is chosen for them (#336). Never throws: this
 * is called from a best-effort hook seam.
 */
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
  if (!isFeatureDevelopmentRoute(routed)) {
    return { routed, lane: null, reason: ROUTE_REASON[routed] };
  }
  // Issue #602 (FR-5) — a prompt that is essentially just a ticket/URL hides the real work behind
  // a link, so a first-glance guess off its surface text must not set the safety lane. Leave the
  // lane unresolved-pending-read; the isolation check surfaces the unresolved lane later (FR-4)
  // rather than a confident-but-wrong "fast".
  if (isBareTicketPrompt(request)) {
    return {
      routed,
      lane: null,
      reason: 'reading the ticket before I set the depth — no lane guessed from a bare link',
    };
  }
  const { lane } = route(classification);
  return {
    routed,
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
  /** The paused entry that was resumed on this message, or null. */
  resumed: WorkflowEntry | null;
  /** The `▸ paqad` line to surface, or null when there is nothing to say. */
  narration: string | null;
  /** True when the prompt was a background notification, not a request (issue #582): the
   *  prompt gate treats it as "no route" and keeps the full context block. */
  notification?: true;
}

/** Build the narration line for a routed outcome (null for silent no-workflow). */
function narrateRoute(
  routed: RoutedWorkflow,
  lane: Lane | null,
  reason: string,
  resumed: WorkflowEntry | null,
): string | null {
  if (routed === 'no-workflow') {
    return null;
  }
  // Issue #639, Part 5 — the route line leads with the same `**▸ paqad** ·` frame as every
  // other paqad line (it was the one `[paqad]` holdout).
  const verb = resumed ? 'resumed' : 'routed to';
  if (routed === 'feature-development' && lane !== null) {
    return paqadFrameLead(`${verb} feature-development, ${lane} lane (${reason})`);
  }
  return paqadFrameLead(`${verb} ${routed} (${reason})`);
}

/** The route reason when a prompt names a stage of the session's open change (issue #669). */
const OPEN_CHANGE_STAGE_REASON = 'a step of the change already open in this session';

/**
 * A feature-development stage name as a whole word, in its underscore form
 * (`documentation_sync`) or with a space (`documentation sync`), from {@link STAGE_ORDER}.
 */
const STAGE_NAME_RE = new RegExp(
  `\\b(?:${STAGE_ORDER.map((stage) => stage.replace(/_/g, '[_ ]')).join('|')})\\b`,
  'i',
);

/**
 * Whether the prompt names a feature-development stage while this session has a change open:
 * its active route is feature-development, or its own session control points at an unclosed
 * bundle (read only, so the prompt seam never adopts a bundle).
 */
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

/**
 * The prompt-seam entry point (called from the UserPromptSubmit hook every message).
 * Resolves the outcome, records it in the per-session workflow-state (pause/resume),
 * stashes the lane for the next change-open (feature-development only), and returns a
 * lean narration line. `no-workflow` records the state but narrates nothing.
 */
export async function runPromptRouteSeam(
  input: PromptRouteSeamInput,
  deps: PromptRouteDeps = {},
): Promise<PromptRouteSeamResult> {
  // Issue #540 — a background notification is not a request. Classify nothing, write no
  // state, narrate nothing: the route the last HUMAN prompt set stays exactly as it is.
  // Recording `no-workflow` here would be worse than doing nothing, because it would pause
  // an in-flight feature-development route and make `routeIsAffirmativelyNonFeature` true,
  // silently suppressing stage recording for the rest of the change.
  if (isSystemNotificationPrompt(input.request)) {
    return {
      routed: 'no-workflow',
      lane: null,
      resumed: null,
      narration: null,
      notification: true,
    };
  }

  // Issue #615 (Part 5) — a slash command reaches this seam as the raw typed line. Route a known
  // one by NAME (never by classifying it as prose, which could arm the edit gates), and leave an
  // unknown one's stored route untouched — the same shape as a notification, so `/compact` or
  // `/loop` never pauses an in-flight feature-development change.
  const slashName = slashCommandName(input.request);
  let routed: RoutedWorkflow;
  let lane: Lane | null;
  let reason: string;
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
    ({ routed, lane, reason } = await resolvePromptRoute(input.projectRoot, input.request, deps));
  }
  const sessionId = resolveSessionId(input.projectRoot, input.sessionId);

  // Record the outcome as evidence and preserve pause/resume across messages (#336).
  const prior = readWorkflowState(input.projectRoot, sessionId);
  // Issue #669 (cause 2b) — "run documentation_sync" during an open change is a step of that
  // change, not a detour to another workflow. The classifier stays stateless; the rule lives
  // here, where the session's own state is known.
  if (
    slashName === null &&
    !isFeatureDevelopmentRoute(routed) &&
    namesStageOfOpenChange(input.projectRoot, sessionId, prior, input.request)
  ) {
    routed = 'feature-development';
    lane = null; // the open change keeps its own lane
    reason = OPEN_CHANGE_STAGE_REASON;
  }
  // Issue #639, Part 7 — the reason is saved with the route, so the HUD can say why.
  const anchors = lane === null ? { reason } : { lane, reason };
  const transition = routeWorkflow(prior, routed, anchors);
  // Issue #582 — stamp when this turn began, so the completion check can tell a stage row
  // written during THIS turn from one left over from an earlier turn. A background
  // notification returned above, so a monitor event can never reset the turn window.
  const turnStartedAt = (deps.now ?? (() => new Date()))().toISOString();
  writeWorkflowState(input.projectRoot, sessionId, {
    ...transition.state,
    turn_started_at: turnStartedAt,
  });

  // The lane is stashed for the change-open ONLY on the feature-development route.
  if (isFeatureDevelopmentRoute(routed) && lane !== null) {
    writePendingLane(input.projectRoot, sessionId, lane);
  }

  // Hand the routed workflow + prompt to the detached context worker (#336) so it
  // loads rules only for feature-development, seeds retrieval with the prompt, and
  // retrieves nothing for no-workflow.
  // Issue #582 — also under this session's own pointer, so another session's route can
  // never steer the worker started for this prompt.
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
