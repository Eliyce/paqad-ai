import { EXAMPLE_GITHUB_REF, defaultGitWorkflow } from '@/git-workflow/defaults.js';
import {
  renderBranchName,
  renderDelivery,
  renderTemplate,
  resolveBranchTypeName,
  slugify,
} from '@/delivery/templates.js';

const CONFIG = defaultGitWorkflow();
CONFIG.branches.types.bugfix.ticket_types = ['Bug'];

const S = 'show all seasons';

function vars(over: Record<string, string>): Record<string, string> {
  return {
    prefix: '',
    type: '',
    ticket: '',
    title: '',
    title_slug: '',
    summary: S,
    scope: '',
    tech_debt: '',
    ...over,
  };
}

describe('delivery templates', () => {
  it('slugifies titles and respects the max length', () => {
    expect(slugify('Add CSV export for invoices', 50)).toBe('add-csv-export-for-invoices');
    expect(slugify('Very Long Title!!! With odd--separators', 20)).toBe('very-long-title-with');
    expect(slugify('PAQ-42 — Fix ticket', 50)).toBe('paq-42-fix-ticket');
  });

  it('picks the branch type whose ticket_types holds the ticket type, else default_type', () => {
    expect(resolveBranchTypeName(CONFIG, 'Bug')).toBe('bugfix');
    expect(resolveBranchTypeName(CONFIG, 'Unknown')).toBe('feature');
    expect(resolveBranchTypeName(CONFIG, undefined)).toBe('feature');
  });

  it('leaves unknown placeholders intact for caller-side detection', () => {
    expect(renderTemplate('{a}-{b}-{c}', { a: '1', b: '2' })).toBe('1-2-{c}');
  });

  describe('the render table', () => {
    const branch = (
      prefix: string,
      ticket: string,
      title: string,
      template = '{prefix}/{ticket}-{title_slug}',
    ) => {
      const config = defaultGitWorkflow();
      config.branches.types.feature = { ...config.branches.types.feature, prefix, template };
      return renderBranchName(config, 'feature', { ticket, title, summary: '' });
    };

    it.each([
      ['feature', 'PROJ-12', 'Add login', 'feature/PROJ-12-add-login'],
      ['feature', '', 'Add login', 'feature/add-login'],
      ['bugfix', EXAMPLE_GITHUB_REF, 'Fix crash', 'bugfix/123-fix-crash'],
    ])('{prefix}/{ticket}-{title_slug} with %s, %s, %s → %s', (prefix, ticket, title, out) => {
      expect(branch(prefix, ticket, title)).toBe(out);
    });

    it('{ticket}-{title_slug} with PROJ-12 and "Add login"', () => {
      expect(branch('feature', 'PROJ-12', 'Add login', '{ticket}-{title_slug}')).toBe(
        'PROJ-12-add-login',
      );
    });

    it.each([
      ['{ticket}: {summary}', { ticket: 'INC0012345' }, 'INC0012345: show all seasons'],
      ['{ticket}: {summary}', {}, 'show all seasons'],
      ['{type}({scope}): {summary}', { type: 'fix' }, `fix: ${S}`],
      [
        '{type}({scope}): {summary} [{ticket}]',
        { type: 'feat', scope: 'cart' },
        `feat(cart): ${S}`,
      ],
      ['{type}({scope}): {summary}\n\nRefs: {ticket}', { type: 'feat' }, `feat: ${S}`],
    ])('%s renders exactly', (template, values, out) => {
      expect(renderTemplate(template, vars(values))).toBe(out);
    });

    it('drops the run of separators before an empty placeholder at the end of a line', () => {
      expect(renderTemplate('{summary} - {ticket}', vars({}))).toBe(S);
    });
  });

  it('renders the full delivery surface; {type} is the branch type commit_type', () => {
    const config = defaultGitWorkflow();
    config.commits.template = '{type}({scope}): {summary}\n\nRefs: {ticket}';
    const rendered = renderDelivery(
      config,
      { ticket: 'PAQ-42', title: 'Add CSV export', summary: 'export invoices as a file' },
      '## Summary\n{summary}\n\n## Ticket\n{ticket}\n',
    );
    expect(rendered.branch).toBe('feature/PAQ-42-add-csv-export');
    expect(rendered.commit).toBe('feat: export invoices as a file\n\nRefs: PAQ-42');
    expect(rendered.pr_title).toBe('PAQ-42: export invoices as a file');
    expect(rendered.pr_body).toBe('## Summary\nexport invoices as a file\n\n## Ticket\nPAQ-42\n');
  });

  it('never falls back to the type for an empty scope', () => {
    const config = defaultGitWorkflow();
    config.commits.template = '{type}({scope}): {summary}';
    expect(renderDelivery(config, { ticket: '', title: 'T', summary: 'S' }, '').commit).toBe(
      'feat: S',
    );
  });

  const inputs = { ticket: 'PAQ-1', title: 'T', summary: 'S' };
  const section = '## Tech debt found in this change\n\n- TD-A (bug, low): A. path';

  it('fills the tech_debt placeholder when the template has one', () => {
    const rendered = renderDelivery(
      CONFIG,
      { ...inputs, tech_debt: section },
      '{summary}\n\n{tech_debt}\n\nEnd',
    );
    expect(rendered.pr_body).toBe(`S\n\n${section}\n\nEnd`);
  });

  it('appends the section after the template body when there is no placeholder', () => {
    expect(renderDelivery(CONFIG, { ...inputs, tech_debt: section }, '{summary}\n\n').pr_body).toBe(
      `S\n\n${section}\n`,
    );
    expect(renderDelivery(CONFIG, { ...inputs, tech_debt: section }, '').pr_body).toBe(
      `${section}\n`,
    );
  });

  it('adds nothing when no items were raised', () => {
    expect(renderDelivery(CONFIG, inputs, '{summary}\n').pr_body).toBe('S\n');
    expect(renderDelivery(CONFIG, inputs, '{summary}\n{tech_debt}').pr_body).toBe('S');
  });
});
