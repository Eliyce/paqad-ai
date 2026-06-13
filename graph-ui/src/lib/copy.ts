import type { DashboardArea } from './dashboard-types';

/**
 * Microcopy for the comprehension layer (issue #146). One sentence per
 * area page, verbatim from the spec, plus the why-drawer copy keyed by
 * inventory item key. Voice rules: sentence case, benefit-led, no em
 * dashes, no exclamation marks, no jargon without a why.
 */

export const PAGE_WHY: Record<DashboardArea, string> = {
  pulse: 'Everything important about your project, in one glance.',
  approvals:
    'Nothing risky moves forward without you. This is where you stay in control without reading logs.',
  trust: 'Proof you can show anyone: what was checked, who wrote it, who vouched.',
  build: 'Your codebase, mapped, measured, and honest.',
  graph: 'Your codebase as a living map: modules, files, and how they connect.',
  automation: 'Decide once how work flows. Paqad follows your rules every time.',
  knowledge:
    'Everything your agents know about this project. Edit it here, every agent learns it instantly.',
  setup: "Your project's foundation. Set it once, change it any time.",
};

/**
 * Plain-language health states (issue #163). The graph and its detail panels
 * speak these words to owners; the raw tier names and engineering metrics
 * (risk_floor, complexity_correction, defect_density, ast type) never reach a
 * user-facing surface.
 */
export const HEALTH_STATE: Record<string, string> = {
  green: 'Healthy',
  amber: 'Needs attention',
  red: 'At risk',
  unknown: 'Not yet measured',
};

export function healthLabel(tier: string | null | undefined): string {
  return HEALTH_STATE[tier ?? 'unknown'] ?? 'Not yet measured';
}

export interface WhyDrawerCopy {
  problem: string;
  benefit: string;
  without: string;
  docsHref?: string;
}

export const WHY_DRAWER: Record<string, WhyDrawerCopy> = {
  instructions: {
    problem: 'Every agent starts from zero unless you tell it the rules.',
    benefit: 'Your standards, applied to every change without repeating yourself.',
    without: 'Each session reinvents your conventions, and some get them wrong.',
  },
  workflows: {
    problem: 'Multi-step work drifts when every step is improvised.',
    benefit: 'Named procedures the agent follows the same way every time.',
    without: 'The same request produces a different process every run.',
  },
  'delivery-policy': {
    problem: 'How work ships is a decision, not a default.',
    benefit: 'Branches, tickets and merges follow rules you set once.',
    without: 'Every delivery negotiates process from scratch.',
  },
  'module-map': {
    problem: 'Nobody can hold a whole codebase in their head.',
    benefit: 'A living map of what exists, what it does and how it connects.',
    without: 'Changes land in the wrong place and the architecture quietly erodes.',
  },
  'decision-contract': {
    problem: 'Agents guess when they should ask.',
    benefit: 'Risky calls pause and wait for you, the rest keep moving.',
    without: 'You find out about big decisions after they are made.',
  },
  profile: {
    problem: 'Advice that ignores what your project is becomes noise.',
    benefit: 'Paqad tunes its checks to the shape of your project.',
    without: 'Generic rules fire on things that do not apply to you.',
  },
  capabilities: {
    problem: 'What the agent may do should be explicit, not assumed.',
    benefit: 'A clear record of what is switched on and what stays off.',
    without: 'Capability creep happens silently.',
  },
  packs: {
    problem: 'Good practices exist, wiring them in is the hard part.',
    benefit: 'Drop-in rule packs for your stack, ready to enforce.',
    without: 'You curate every rule by hand.',
  },
  providers: {
    problem: 'Tickets and repos live in different tools for every team.',
    benefit: 'Paqad talks to your tracker and host through one configuration.',
    without: 'Status lives in your head instead of your tools.',
  },
  rag: {
    problem: 'Agents answer better when they can look things up.',
    benefit: 'Your code and docs, indexed so agents cite the real thing.',
    without: 'Answers come from memory and guesswork.',
  },
  'design-tokens': {
    problem: 'Visual consistency dies one hardcoded value at a time.',
    benefit: 'One palette every screen draws from.',
    without: 'Each new screen invents its own colors and spacing.',
  },
  patterns: {
    problem: 'The same problem gets solved five different ways.',
    benefit: 'Approved solutions the agent reaches for first.',
    without: 'Every implementation is a fresh opinion.',
  },
  approvals: {
    problem: 'Staying in control should not require reading logs.',
    benefit: 'Everything waiting on you, in one inbox with one-click answers.',
    without: 'Decisions stall in transcripts you never open.',
  },
  'evidence-ledger': {
    problem: 'Claims about checks are cheap.',
    benefit: 'An append-only record of every gate that ran and what it found.',
    without: 'History can be rewritten by whoever edits last.',
  },
  receipts: {
    problem: 'Anyone can claim the checks ran. Few can prove it.',
    benefit: 'Who wrote it, who vouched for it, sealed.',
    without: 'Reviews rest on trust in memory and screenshots.',
  },
  'ai-bom': {
    problem: 'You will be asked which AI touched your code. Most teams cannot answer.',
    benefit: 'A standard, exportable list of every model that contributed.',
    without: 'Compliance questions turn into archaeology.',
  },
  'audit-log': {
    problem: 'When something goes wrong, you need the timeline.',
    benefit: 'Every meaningful action, recorded as it happened.',
    without: 'Incident reviews start with guesswork.',
  },
  'quality-baseline': {
    problem: 'Quality drifts in small steps nobody notices.',
    benefit: 'A recorded floor your project is measured against.',
    without: 'Slow decline looks normal until it is not.',
  },
  pentest: {
    problem: 'Vulnerabilities are cheapest to fix the day they are written.',
    benefit: 'Security findings surfaced while the code is still fresh.',
    without: 'Issues wait for an annual audit, or an attacker.',
  },
  'rule-compliance': {
    problem: 'Rules that are not checked are suggestions.',
    benefit: 'A score that shows which rules hold and where they slip.',
    without: 'You assume compliance until a review proves otherwise.',
  },
};
