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
    expect(ticketInBranch(config, 'feature/12-fix')).toBe('#12');
    expect(ticketInBranch(config, 'feature/fix')).toBe('');
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
