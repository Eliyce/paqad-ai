import { renderBranchName } from '@/delivery/templates.js';
import {
  branchFinding,
  expectedBase,
  followsBranchShape,
  invalidFinding,
  prFindings,
  ticketInBranch,
} from '@/delivery/workflow-findings.js';
import { defaultGitWorkflow } from '@/git-workflow/defaults.js';

const source = (pattern: string) => ({
  tracker: 'jira' as const,
  pattern,
  server: '',
  transitions: { on_pr_open: '', on_ci_green: '' },
});

describe('workflow findings: edge inputs', () => {
  it('says unknown error when the invalid config has no error listed', () => {
    expect(invalidFinding([]).message).toBe(
      '.paqad/configs/git-workflow/ has errors, so nothing was checked: unknown error',
    );
  });

  it('accepts any branch when the team has no branch types', () => {
    const config = defaultGitWorkflow();
    config.branches.types = {};
    expect(branchFinding(config, 'anything')).toBeNull();
  });

  it('checks a type with its own prefix-free template, with the scope optional', () => {
    const config = defaultGitWorkflow();
    config.branches.types = {
      feature: { ...config.branches.types.feature, template: '{ticket}-{title_slug}' },
    };
    config.tickets.sources = { proj: source('PROJ-\\d+') };
    expect(followsBranchShape(config, 'PROJ-1-add-login')).toBe(true);
    expect(followsBranchShape(config, 'add-login')).toBe(false);
  });

  it('skips a ticket pattern that does not compile and keeps the hash of a GitHub key', () => {
    const config = defaultGitWorkflow();
    config.tickets.sources = { bad: source('('), gh: source('#\\d+') };
    const key = 12;
    expect(ticketInBranch(config, `feature/${key}-fix`)).toBe(`#${key}`);
    expect(ticketInBranch(config, 'feature/fix')).toBe('');
  });

  describe('a number is a GitHub ticket only in the slot the branch template gives it', () => {
    const github = (template: string) => {
      const config = defaultGitWorkflow();
      config.tickets.sources = { gh: source('#\\d+') };
      config.branches.template = template;
      for (const type of Object.values(config.branches.types)) type.template = '';
      return config;
    };
    const pr = { number: null, base: 'main', title: null, labels: [], body: '' };

    it('finds no ticket when the template has no ticket slot', () => {
      const config = github('{prefix}/{title_slug}');
      expect(ticketInBranch(config, 'feature/round-5')).toBe('');
      expect(ticketInBranch(config, 'bugfix/12-fix')).toBe('');
    });

    it('raises no link finding for a slug number when the template has no ticket slot', () => {
      const config = github('{prefix}/{title_slug}');
      expect(prFindings(config, 'feature/plugin-directory-round-5', pr)).toEqual([]);
    });

    it('finds the ticket in the default template slot and still asks the PR to link it', () => {
      const config = github('{prefix}/{ticket}-{title_slug}');
      const key = 12;
      expect(ticketInBranch(config, `feature/${key}-fix`)).toBe(`#${key}`);
      expect(prFindings(config, `feature/${key}-fix`, pr)).toEqual([
        { code: 'pr-ticket-link', message: `PR #? doesn't link #${key}.` },
      ]);
    });

    it('finds the ticket when the title gave no slug, as paqad renders that branch', () => {
      const config = defaultGitWorkflow();
      config.tickets.sources = { gh: source('#\\d+') };
      const key = 12;
      for (const title of ['', '!!!', '日本語']) {
        const branch = renderBranchName(config, 'feature', {
          ticket: `#${key}`,
          title,
          summary: '',
        });
        expect(branch).toBe(`feature/${key}`);
        expect(ticketInBranch(config, branch)).toBe(`#${key}`);
      }
    });

    it('finds no ticket for a slug number when the default slot is empty', () => {
      const config = github('{prefix}/{ticket}-{title_slug}');
      expect(ticketInBranch(config, 'feature/fix-round-5')).toBe('');
      expect(prFindings(config, 'feature/fix-round-5', pr)).toEqual([]);
    });

    it('reads a slot wherever the template puts it, and a type template wins', () => {
      expect(ticketInBranch(github('{prefix}/{title_slug}-{ticket}'), 'feature/round-5-7')).toBe(
        '#7',
      );
      const config = github('{prefix}/{title_slug}');
      config.branches.types.bugfix.template = '{ticket}-{title_slug}';
      expect(ticketInBranch(config, '7-fix')).toBe('#7');
      expect(ticketInBranch(config, 'bugfix/7-fix')).toBe('');
    });

    it('uses the team template with any prefix when no branch types are set', () => {
      const config = github('{prefix}/{ticket}-{title_slug}');
      config.branches.types = {};
      expect(ticketInBranch(config, 'any/7-fix')).toBe('#7');
      expect(ticketInBranch(config, 'any/fix-7')).toBe('');
    });

    it('still resolves a key from a pattern without a leading hash, in any position', () => {
      const config = github('{prefix}/{title_slug}');
      config.tickets.sources = { jira: source('PROJ-\\d+'), snow: source('INC\\d+') };
      expect(ticketInBranch(config, 'feature/fix-PROJ-9-login')).toBe('PROJ-9');
      expect(ticketInBranch(config, 'INC0012345')).toBe('INC0012345');
    });
  });

  it('accepts a PR to a glob base, a second target or a parent branch, and flags others', () => {
    const config = defaultGitWorkflow();
    config.branches.types.feature.base_branch = 'release/*';
    config.pull_requests.also_open_against = ['qa'];
    const pr = { number: null, title: null, labels: [], body: '' };
    expect(prFindings(config, 'feature/x', { ...pr, base: 'release/1.2' })).toEqual([]);
    expect(prFindings(config, 'feature/x', { ...pr, base: 'qa' })).toEqual([]);
    expect(prFindings(config, 'feature/x', { ...pr, base: 'feature/parent' })).toEqual([]);
    expect(prFindings(config, 'feature/x', { ...pr, base: 'develop' })).toEqual([
      {
        code: 'pr-base',
        message: 'PR #? targets develop, but this team sends feature changes to release/*.',
      },
    ]);
  });

  it('falls back to the team base for a type that is not configured', () => {
    const config = defaultGitWorkflow();
    config.branches.default_type = 'gone';
    expect(expectedBase(config, 'misc')).toBe('main');
    expect(
      prFindings(config, 'misc', { number: 3, base: 'main', title: null, labels: [], body: '' }),
    ).toEqual([]);
  });
});
