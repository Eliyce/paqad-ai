import type { TicketProviderKind } from '@/core/types/project-profile.js';

import type { GitWorkflowFile, ResolvedGitWorkflow } from './types.js';

declare const __PKG_VERSION__: string;

export const DEFAULT_BASE_BRANCH = 'main';

export const EXAMPLE_GITHUB_REF = '#' + '123';

export const DEFAULT_TRACKER_PATTERNS: Readonly<Record<TicketProviderKind, string | null>> = {
  jira: '[A-Z][A-Z0-9]+-\\d+',
  linear: '[A-Z][A-Z0-9]+-\\d+',
  servicenow: '(INC|RITM|CHG|PRB|TASK)\\d{7}',
  'github-issues': '#\\d+',
  generic: null,
};

export function defaultGitWorkflow(baseBranch: string = DEFAULT_BASE_BRANCH): ResolvedGitWorkflow {
  return {
    tickets: {
      require_ticket: false,
      sources: {},
      write_back_refined: 'ask',
      intake_decisions: {
        auto_resolve_from_priors: true,
        auto_resolve_from_rules: true,
        confirm_auto_resolutions: 'batched',
        max_options_per_packet: 4,
        fingerprint_scope: ['ticket_type', 'module', 'category'],
      },
    },
    branches: {
      base_branch: baseBranch,
      template: '{prefix}/{ticket}-{title_slug}',
      slug_max_length: 50,
      types: {
        feature: defaultBranchType('feature', 'feat', baseBranch),
        bugfix: defaultBranchType('bugfix', 'fix', baseBranch),
        hotfix: defaultBranchType('hotfix', 'fix', baseBranch),
      },
      default_type: 'feature',
    },
    commits: {
      template: '{ticket}: {summary}',
      sign_off: false,
      ask_when_unspecified: true,
      summary: { style: 'plain', max_length: 72 },
    },
    pull_requests: {
      host: 'github',
      host_server: '',
      title_template: '{ticket}: {summary}',
      body_template: '.paqad/templates/pr-body.md',
      draft: false,
      reviewers: [],
      labels: [],
      link_ticket: true,
      also_open_against: [],
      ci: { gate: 'wait_for_green', timeout_minutes: 30, on_red: 'stop' },
    },
    enforcement: { enabled: true, agents: 'block', people: 'warn' },
  };
}

function defaultBranchType(prefix: string, commitType: string, baseBranch: string) {
  return {
    prefix,
    commit_type: commitType,
    tickets: [],
    ticket_types: [],
    base_branch: baseBranch,
    labels: [],
    template: '{prefix}/{ticket}-{title_slug}',
  };
}

const TICKETS_YAML = `# Where this team's tickets come from and how they move.
#
# paqad matches a ticket key (like PROJ-123 or INC0012345) against each
# source's pattern, top to bottom. The first match wins.
#
# Each source has:
#   tracker:      jira | servicenow | github-issues | linear | generic
#   pattern:      regular expression for this source's ticket keys
#                 (each tracker has a default; generic needs one)
#   server:       MCP server name; "" means the first connected server of that tracker
#   transitions:  the status to move the ticket to, "" means don't move it
#     on_pr_open:   when the PR opens
#     on_ci_green:  when CI passes on the PR
paqad_version: "<version>"

# true means every change needs a ticket, and deliver stops without one.
require_ticket: false

# No sources means this team works without tickets.
sources: {}

# Write refined requirements back to the ticket: never | ask | always.
# Not applied yet.
write_back_refined: ask

# How ticket-intake decisions are settled automatically.
intake_decisions:
  auto_resolve_from_priors: true
  auto_resolve_from_rules: true
  confirm_auto_resolutions: batched   # always | batched | never
  max_options_per_packet: 4
  fingerprint_scope: [ticket_type, module, category]
`;

const BRANCHES_YAML = `# How branches are named and where changes start.
#
# base_branch: the branch a change starts from and its PR goes back to.
#   A glob like "release/*" means the newest matching branch on the remote.
# template: how a branch name is built. Placeholders:
#   {prefix}      the branch type's prefix, like feature
#   {ticket}      the ticket key, like PROJ-123 (a leading # is dropped)
#   {title_slug}  the change title in lower-case words joined by -
#
# types: the kinds of change this team makes. Each type can set:
#   prefix:        branch prefix (default: the type's name)
#   commit_type:   value of {type} in commit and PR templates (default: the type's name)
#   tickets:       which ticket sources this type uses (default: any)
#   ticket_types:  tracker issue types that mean this type, like Bug (default: none)
#   base_branch:   overrides the base_branch above for this type
#   labels:        PR labels added for this type
#   template:      overrides the template above for this type
paqad_version: "<version>"

base_branch: <base>
template: "{prefix}/{ticket}-{title_slug}"
slug_max_length: 50

types:
  feature:
    prefix: feature
    commit_type: feat
  bugfix:
    prefix: bugfix
    commit_type: fix
  hotfix:
    prefix: hotfix
    commit_type: fix

# The type used when nothing else decides it.
default_type: feature
`;

const COMMITS_YAML = `# How commit messages are written.
#
# template placeholders: {ticket} {summary} {type} {scope} {title}
# summary.style:
#   plain  the summary is written for a person who doesn't read code
#   free   no style check
paqad_version: "<version>"

template: "{ticket}: {summary}"

# true adds a Signed-off-by line (git commit -s).
sign_off: false

# When the developer didn't say whether to commit, ask once at the end of
# the change and record the answer.
ask_when_unspecified: true

summary:
  style: plain
  max_length: 72
`;

const PULL_REQUESTS_YAML = `# How pull requests are opened.
#
# title_template placeholders: {ticket} {summary} {type} {scope} {title}
# body_template: the team's PR template. If it has placeholders like
#   {summary} paqad fills them. If it has none, the agent fills it in and
#   passes it with --body-file.
# labels: added to every PR. Branch type labels are added on top.
# also_open_against: extra branches to open the same change against,
#   like a qa branch. Each gets its own PR.
paqad_version: "<version>"

host: github          # only github for now
host_server: ""

title_template: "{ticket}: {summary}"
body_template: .paqad/templates/pr-body.md
draft: false
reviewers: []
labels: []

# Add the ticket to the PR body: "Closes ${EXAMPLE_GITHUB_REF}" for GitHub issues,
# "Ticket: PROJ-123" for anything else.
link_ticket: true

also_open_against: []

ci:
  gate: wait_for_green   # wait_for_green | warn_only | off
  timeout_minutes: 30
  on_red: stop           # stop | comment_and_stop
`;

const ENFORCEMENT_YAML = `# How strictly paqad holds everyone to these rules.
#
# enabled: false turns off paqad's delivery help and checks completely.
#
# agents: work done through a coding agent
#   block  a turn, commit or PR that doesn't match is refused until the agent fixes it
#   warn   paqad points it out and the agent should fix it
#
# people: commits and pushes made by people, checked by git hooks
#   block  the commit or push is refused (git commit --no-verify still skips it)
#   warn   the hook prints what doesn't match and lets it through
#   off    no git hooks for people
paqad_version: "<version>"

enabled: true
agents: block
people: warn
`;

const FILE_TEMPLATES: Readonly<Record<GitWorkflowFile, string>> = {
  'tickets.yaml': TICKETS_YAML,
  'branches.yaml': BRANCHES_YAML,
  'commits.yaml': COMMITS_YAML,
  'pull-requests.yaml': PULL_REQUESTS_YAML,
  'enforcement.yaml': ENFORCEMENT_YAML,
};

export interface RenderDefaultsOptions {
  version?: string;
  baseBranch?: string;
}

export function renderDefaultGitWorkflowFile(
  file: GitWorkflowFile,
  options: RenderDefaultsOptions = {},
): string {
  const version = options.version ?? __PKG_VERSION__;
  const base = options.baseBranch ?? DEFAULT_BASE_BRANCH;
  return FILE_TEMPLATES[file].replace('<version>', version).replace('<base>', yamlScalar(base));
}

function yamlScalar(value: string): string {
  return /^[A-Za-z0-9._/-]+$/.test(value) && !value.includes('*') ? value : JSON.stringify(value);
}
