import { defaultGitWorkflow } from '@/git-workflow/defaults.js';
import { firstLine, templateToRegExp, ticketOptional } from '@/git-workflow/patterns.js';

function config() {
  const c = defaultGitWorkflow();
  c.tickets.sources = {
    proj: {
      tracker: 'jira',
      pattern: 'PROJ-\\d+',
      server: '',
      transitions: { on_pr_open: '', on_ci_green: '' },
    },
    gh: {
      tracker: 'github-issues',
      pattern: '#\\d+',
      server: '',
      transitions: { on_pr_open: '', on_ci_green: '' },
    },
  };
  return c;
}

describe('templateToRegExp', () => {
  it('matches a ticket-first branch and rejects one that ignores the template', () => {
    const c = config();
    c.tickets.require_ticket = true;
    const matcher = templateToRegExp('{ticket}-{title_slug}', c, {
      optional: ticketOptional(c),
      branch: true,
    });
    expect(matcher.test('PROJ-12-add-login')).toBe(true);
    expect(matcher.test('misc')).toBe(false);
  });

  it('builds a second pattern with an optional placeholder emptied', () => {
    const c = config();
    const matcher = templateToRegExp('{prefix}/{ticket}-{title_slug}', c, {
      optional: ['ticket'],
      branch: true,
    });
    expect(matcher.patterns).toHaveLength(2);
    expect(matcher.test('feature/PROJ-1-add-login')).toBe(true);
    expect(matcher.test('bugfix/12-fix-crash')).toBe(true);
    expect(matcher.test('feature/add-login')).toBe(true);
    expect(matcher.test('chore/add-login')).toBe(false);
    expect(matcher.test('feature/Add_Login')).toBe(false);
  });

  it('expands {type} to any commit_type and {scope} to a scope without parentheses', () => {
    const matcher = templateToRegExp('{type}({scope}): {summary} [{ticket}]', config(), {
      optional: ['ticket', 'scope'],
    });
    expect(matcher.test('feat(cart): show all seasons [PROJ-3]')).toBe(true);
    expect(matcher.test('fix: show all seasons')).toBe(true);
    expect(matcher.test('feat(cart): show all seasons')).toBe(true);
    expect(matcher.test('docs: show all seasons')).toBe(false);
  });

  it('{ticket} is required when require_ticket is true', () => {
    const c = config();
    c.tickets.require_ticket = true;
    const matcher = templateToRegExp('{ticket}: {summary}', c, { optional: ticketOptional(c) });
    expect(matcher.test('PROJ-9: do it')).toBe(true);
    expect(matcher.test('do it')).toBe(false);
  });

  it('checks commit subjects against the first line of the template only', () => {
    const template = '{type}({scope}): {summary}\n\nRefs: {ticket}';
    const matcher = templateToRegExp(firstLine(template), config(), { optional: ['scope'] });
    expect(matcher.test('feat: add it')).toBe(true);
  });
});
