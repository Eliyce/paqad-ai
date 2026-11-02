import { defaultGitWorkflow } from '@/git-workflow/defaults.js';
import {
  checkSummaryStyle,
  isIgnoredSubject,
  summaryPart,
  summaryStyleMessage,
  summaryStyleReasons,
} from '@/git-workflow/summary-style.js';

describe('the plain-language summary rule', () => {
  it.each([
    ['show the `seasons` list to everyone', 'it contains code formatting'],
    ['show seasons from src/season/list', 'it names a file'],
    ['show seasons listed in seasons.json', 'it names a file'],
    ['show seasons through Season::all now', 'it uses code symbols'],
    ['show seasons when list() is empty', 'it uses code symbols'],
    ['show seasons through loadSeasons for all', 'it names a function or variable'],
    ['show seasons through load_seasons for all', 'it names a function or variable'],
    [
      'show seasons for every customer who has ever bought a ticket in the last year',
      "it's longer than 72 characters",
    ],
    ['Minor changes.', "it doesn't say what changed"],
    ['seasons list', "it's too short to say what changed"],
    ['Showing all seasons at once', 'start with what it does, like "Show", not "Showing"'],
  ])('%s → %s', (summary, reason) => {
    expect(summaryStyleReasons(summary, 72)).toContain(reason);
  });

  it('accepts a plain summary', () => {
    expect(summaryStyleReasons('show all seasons when both blocks are active', 72)).toEqual([]);
  });

  it('checks only the summary part of the subject and ignores ticket keys', () => {
    const config = defaultGitWorkflow();
    config.tickets.sources.proj = {
      tracker: 'jira',
      pattern: 'PROJ_\\d+',
      server: '',
      transitions: { on_pr_open: '', on_ci_green: '' },
    };
    expect(summaryPart('PROJ_12: show all seasons', '{ticket}: {summary}', config)).toBe(
      'show all seasons',
    );
    expect(summaryPart('feat(cart): show all seasons', '{type}({scope}): {summary}', config)).toBe(
      'show all seasons',
    );
    expect(
      checkSummaryStyle('PROJ_12: show all seasons now', '{ticket}: {summary}', config),
    ).toEqual([]);
  });

  it('skips merge, revert, fixup and squash subjects, and free style', () => {
    expect(isIgnoredSubject('Merge branch x')).toBe(true);
    expect(isIgnoredSubject('Revert "x"')).toBe(true);
    expect(isIgnoredSubject('fixup! x')).toBe(true);
    expect(isIgnoredSubject('squash! x')).toBe(true);
    const config = defaultGitWorkflow();
    config.commits.summary.style = 'free';
    expect(checkSummaryStyle('wip', '{summary}', config)).toEqual([]);
  });

  it('builds the finding message', () => {
    expect(summaryStyleMessage('wip', "it doesn't say what changed")).toBe(
      'commit "wip" reads like code, not plain language: it doesn\'t say what changed.',
    );
  });
});
