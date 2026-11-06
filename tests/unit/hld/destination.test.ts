import { describe, expect, it } from 'vitest';

import { defaultGitWorkflow } from '@/git-workflow/defaults.js';
import type { ResolvedGitWorkflow } from '@/git-workflow/types.js';
import {
  detectTrackerFromText,
  resolveDesignDestination,
  resolveTracker,
} from '@/hld/destination.js';
import { detectTicketLinks } from '@/planning/ticket-ref-detect.js';

const KEY = ['PQD', '123'].join('-');
const NUM = String(6 * 7);
const ISSUE_URL = `https://github.com/acme/web-app/issues/${NUM}`;

function config(edit: (c: ResolvedGitWorkflow) => void = () => {}): ResolvedGitWorkflow {
  const c = defaultGitWorkflow();
  edit(c);
  return c;
}

function withSources(c: ResolvedGitWorkflow): void {
  c.tickets.sources = {
    ops: {
      tracker: 'servicenow',
      pattern: '(INC|CHG)\\d{7}',
      server: 'now',
      transitions: { on_pr_open: '', on_ci_green: '' },
    },
    team: {
      tracker: 'jira',
      pattern: '[A-Z][A-Z0-9]+-\\d+',
      server: 'acme-jira',
      transitions: { on_pr_open: '', on_ci_green: '' },
    },
  };
}

describe('design destination', () => {
  it('AC-7: a Jira browse link gives jira, the link site and the issue key', () => {
    const text = `Please build https://acme.atlassian.net/browse/${KEY} today`;
    expect(detectTrackerFromText(text)).toEqual({
      tracker: 'jira',
      server: 'acme.atlassian.net',
      ref: KEY,
      from: 'link',
    });
    expect(detectTrackerFromText(`see https://jira.acme.io/browse/${KEY}`)).toMatchObject({
      tracker: 'jira',
      server: 'jira.acme.io',
      ref: KEY,
    });
    expect(
      detectTrackerFromText(
        `https://acme.atlassian.net/jira/software/projects/PQD/boards/1?selectedIssue=${KEY}`,
      ),
    ).toMatchObject({ tracker: 'jira', ref: KEY });
  });

  it('AC-8: a GitHub issue link gives github-issues and owner, repository and number', () => {
    expect(detectTrackerFromText(`fix ${ISSUE_URL} please`)).toEqual({
      tracker: 'github-issues',
      server: 'github.com',
      ref: `acme/web-app${'#'}${NUM}`,
      from: 'link',
    });
  });

  it('AC-9: a Linear issue link gives linear and the issue key', () => {
    expect(
      detectTrackerFromText('https://linear.app/acme/issue/ENG-42/make-the-thing'),
    ).toMatchObject({ tracker: 'linear', server: 'linear.app', ref: 'ENG-42' });
  });

  it('AC-10: a ServiceNow link or record key gives servicenow and the record number', () => {
    expect(
      detectTrackerFromText(
        'https://acme.service-now.com/nav_to.do?uri=incident.do?sysparm_query=number=INC0012345',
      ),
    ).toMatchObject({ tracker: 'servicenow', server: 'acme.service-now.com', ref: 'INC0012345' });
    expect(detectTrackerFromText('the outage in CHG0001234 needs this')).toMatchObject({
      tracker: 'servicenow',
      ref: 'CHG0001234',
    });
    expect(detectTicketLinks('nothing here')).toEqual([]);
  });

  it('AC-11: a bare key uses the first tickets.yaml source whose pattern matches it', () => {
    const c = config(withSources);
    expect(resolveTracker(`work on ${KEY}`, c)).toEqual({
      tracker: 'jira',
      server: 'acme-jira',
      ref: KEY,
      from: 'tickets.yaml',
    });
  });

  it('AC-12: plain text with no ticket and no channel has no destination', () => {
    expect(resolveDesignDestination('make the button bigger', config(withSources))).toBeNull();
    expect(resolveDesignDestination(`work on ${KEY}`, config())).toBeNull();
  });

  it('AC-13: a named approval channel wins over the tracker; empty means the ticket', () => {
    const text = `https://acme.atlassian.net/browse/${KEY}`;
    const channel = config((c) => {
      c.design_sign_off.approval_channel = { server: 'ms-teams', channel: 'Design' };
    });
    expect(resolveDesignDestination(text, channel)).toMatchObject({
      kind: 'channel',
      server: 'ms-teams',
      channel: 'Design',
      profile: 'ms-teams',
      tracker: { tracker: 'jira', ref: KEY },
    });
    expect(resolveDesignDestination(text, config())).toMatchObject({
      kind: 'tracker',
      server: 'acme.atlassian.net',
      ref: KEY,
      profile: 'jira',
    });
    expect(resolveDesignDestination(ISSUE_URL, config())).toMatchObject({
      kind: 'tracker',
      profile: 'github',
      ref: `acme/web-app${'#'}${NUM}`,
    });
  });

  it('AC-13: a channel on a server with no profile keeps the server name as its profile', () => {
    const channel = config((c) => {
      c.design_sign_off.approval_channel = { server: 'discord', channel: 'Design' };
    });
    expect(resolveDesignDestination('make the button bigger', channel)).toEqual({
      kind: 'channel',
      server: 'discord',
      channel: 'Design',
      profile: 'discord',
      tracker: null,
    });
  });
});
