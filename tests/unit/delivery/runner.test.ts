import {
  compareVersions,
  highestVersionBranch,
  linkTicket,
  missingHeadings,
  resolveBase,
  type DeliveryShell,
} from '@/delivery/runner.js';

describe('delivery runner helpers', () => {
  it('compares versions part by part as numbers', () => {
    expect(compareVersions('1.10', '1.9')).toBeGreaterThan(0);
    expect(compareVersions('1.10.1', '1.10')).toBeGreaterThan(0);
    expect(highestVersionBranch(['release/1.9', 'release/1.10', 'release/1.10.1'])).toBe(
      'release/1.10.1',
    );
    expect(highestVersionBranch([])).toBe(null);
  });

  it('passes a plain base through without asking git', async () => {
    const shell: DeliveryShell = {
      async run() {
        throw new Error('no git expected');
      },
    };
    expect(await resolveBase(shell, 'develop')).toEqual({ ok: true, value: 'develop' });
  });

  it('lists the template headings a filled body dropped', () => {
    expect(missingHeadings('## What\n\n## Why\n### Notes\n', '## What\nx\n### Notes\n')).toEqual([
      '## Why',
    ]);
  });

  it('adds the ticket link once and only when it is not in the body already', () => {
    const source = {
      name: 'proj',
      source: {
        tracker: 'jira' as const,
        pattern: 'PROJ-\\d+',
        server: '',
        transitions: { on_pr_open: '', on_ci_green: '' },
      },
    };
    expect(linkTicket('Body', 'PROJ-1', source, true)).toBe('Body\n\nTicket: PROJ-1\n');
    expect(linkTicket('Body PROJ-1', 'PROJ-1', source, true)).toBe('Body PROJ-1');
    expect(linkTicket('Body', 'PROJ-1', source, false)).toBe('Body');
    expect(linkTicket('Body', '', source, true)).toBe('Body');
  });
});
