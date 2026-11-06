import type { TicketProviderKind } from '@/core/types/project-profile.js';
import { matchTicketSource } from '@/delivery/runner.js';
import type { ResolvedGitWorkflow } from '@/git-workflow/types.js';
import { detectTicketLinks, detectTicketRefs } from '@/planning/ticket-ref-detect.js';

export interface TrackerRef {
  tracker: TicketProviderKind;
  server: string;
  ref: string;
  from: 'link' | 'key' | 'tickets.yaml';
}

export type DesignDestination =
  | {
      kind: 'channel';
      server: string;
      channel: string;
      profile: string;
      tracker: TrackerRef | null;
    }
  | { kind: 'tracker'; server: string; ref: string; profile: string; tracker: TrackerRef };

const TRACKER_PROFILES: Readonly<Partial<Record<TicketProviderKind, string>>> = {
  jira: 'jira',
  'github-issues': 'github',
};

export const DESTINATION_PROFILES = ['jira', 'ms-teams', 'slack', 'github'] as const;

export function detectTrackerFromText(text: string): TrackerRef | null {
  const link = detectTicketLinks(text)[0];
  if (!link) return null;
  return { ...link, from: link.server === '' ? 'key' : 'link' };
}

export function resolveTracker(text: string, config: ResolvedGitWorkflow): TrackerRef | null {
  const detected = detectTrackerFromText(text);
  if (detected) return detected;
  for (const ref of detectTicketRefs(text, 'generic')) {
    const matched = matchTicketSource(config, ref);
    if (matched.ok && matched.value) {
      return {
        tracker: matched.value.source.tracker,
        server: matched.value.source.server,
        ref,
        from: 'tickets.yaml',
      };
    }
  }
  return null;
}

export function profileFor(name: string): string | null {
  const known = TRACKER_PROFILES[name as TicketProviderKind] ?? name;
  return (DESTINATION_PROFILES as readonly string[]).includes(known) ? known : null;
}

export function resolveDesignDestination(
  text: string,
  config: ResolvedGitWorkflow,
): DesignDestination | null {
  const tracker = resolveTracker(text, config);
  const channel = config.design_sign_off.approval_channel;
  if (channel.server !== '' && channel.channel !== '') {
    return {
      kind: 'channel',
      server: channel.server,
      channel: channel.channel,
      profile: profileFor(channel.server) ?? channel.server,
      tracker,
    };
  }
  if (!tracker) return null;
  return {
    kind: 'tracker',
    server: tracker.server,
    ref: tracker.ref,
    profile: profileFor(tracker.tracker) ?? tracker.tracker,
    tracker,
  };
}
