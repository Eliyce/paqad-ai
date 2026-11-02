import { defaultGitWorkflow } from '@/git-workflow/defaults.js';
import {
  renderDelivery,
  renderTemplate,
  resolveBranchTypeName,
  slugify,
} from '@/delivery/templates.js';

const DEFAULT_PROCESS = defaultGitWorkflow();
DEFAULT_PROCESS.branches.types.bugfix.ticket_types = ['Bug'];

describe('delivery templates', () => {
  it('slugifies titles and respects the max length', () => {
    expect(slugify('Add CSV export for invoices', 50)).toBe('add-csv-export-for-invoices');
    expect(slugify('Very Long Title!!! With odd--separators', 20)).toBe('very-long-title-with');
    expect(slugify('PAQ-42 — Fix ticket', 50)).toBe('paq-42-fix-ticket');
  });

  it('picks the branch type whose ticket_types holds the ticket type, else default_type', () => {
    expect(resolveBranchTypeName(DEFAULT_PROCESS, 'Bug')).toBe('bugfix');
    expect(resolveBranchTypeName(DEFAULT_PROCESS, 'Unknown')).toBe('feature');
    expect(resolveBranchTypeName(DEFAULT_PROCESS, undefined)).toBe('feature');
  });

  it('leaves unknown placeholders intact for caller-side detection', () => {
    expect(renderTemplate('{a}-{b}-{c}', { a: '1', b: '2' })).toBe('1-2-{c}');
  });

  it('renders the full delivery surface from conventions + inputs', () => {
    const rendered = renderDelivery(
      DEFAULT_PROCESS,
      {
        ticket: 'PAQ-42',
        ticket_type: 'Story',
        title: 'Add CSV export for invoices',
        summary: 'Add CSV export endpoint and downloadable file for invoices.',
        scope: 'invoices',
      },
      '## Summary\n{summary}\n\n## Ticket\n{ticket}',
    );

    expect(rendered.branch).toBe('feature/PAQ-42-add-csv-export-for-invoices');
    expect(rendered.commit).toBe(
      'PAQ-42: Add CSV export endpoint and downloadable file for invoices.',
    );
    expect(rendered.pr_title).toBe(
      'PAQ-42: Add CSV export endpoint and downloadable file for invoices.',
    );
    expect(rendered.pr_body).toContain('## Summary');
    expect(rendered.pr_body).toContain('PAQ-42');
  });

  const inputs = { ticket: 'PAQ-1', title: 'T', summary: 'S' };
  const section = '## Tech debt found in this change\n\n- TD-A (bug, low): A. path';

  it('fills the tech_debt placeholder when the template has one', () => {
    const rendered = renderDelivery(
      DEFAULT_PROCESS,
      { ...inputs, tech_debt: section },
      '{summary}\n\n{tech_debt}\n\nEnd',
    );
    expect(rendered.pr_body).toBe(`S\n\n${section}\n\nEnd`);
  });

  it('appends the section after the template body when there is no placeholder', () => {
    expect(
      renderDelivery(DEFAULT_PROCESS, { ...inputs, tech_debt: section }, '{summary}\n\n').pr_body,
    ).toBe(`S\n\n${section}\n`);
    expect(renderDelivery(DEFAULT_PROCESS, { ...inputs, tech_debt: section }, '').pr_body).toBe(
      `${section}\n`,
    );
  });

  it('adds nothing when no items were raised', () => {
    expect(renderDelivery(DEFAULT_PROCESS, inputs, '{summary}\n').pr_body).toBe('S\n');
    expect(renderDelivery(DEFAULT_PROCESS, inputs, '{summary}\n{tech_debt}').pr_body).toBe('S\n');
  });
});
