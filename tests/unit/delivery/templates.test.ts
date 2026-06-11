import { defaultDeliveryProcess } from '@/pipeline/delivery-policy.js';
import {
  renderDelivery,
  renderTemplate,
  resolveConventionalType,
  slugify,
} from '@/delivery/templates.js';

const DEFAULT_PROCESS = defaultDeliveryProcess();

describe('delivery templates', () => {
  it('slugifies titles and respects the max length', () => {
    expect(slugify('Add CSV export for invoices', 50)).toBe('add-csv-export-for-invoices');
    expect(slugify('Very Long Title!!! With odd--separators', 20)).toBe('very-long-title-with');
    expect(slugify('PAQ-42 — Fix ticket', 50)).toBe('paq-42-fix-ticket');
  });

  it('resolves the conventional commit type via the type_map with a default fallback', () => {
    expect(resolveConventionalType('Bug', { Story: 'feat', Bug: 'fix', default: 'chore' })).toBe(
      'fix',
    );
    expect(resolveConventionalType('Unknown', { Story: 'feat', default: 'chore' })).toBe('chore');
    expect(resolveConventionalType(undefined, { default: 'feat' })).toBe('feat');
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

    expect(rendered.branch).toBe('feat/PAQ-42-add-csv-export-for-invoices');
    expect(rendered.commit).toBe(
      'feat(invoices): Add CSV export endpoint and downloadable file for invoices.\n\nRefs: PAQ-42',
    );
    expect(rendered.pr_title).toBe(
      'feat(invoices): Add CSV export endpoint and downloadable file for invoices. [PAQ-42]',
    );
    expect(rendered.pr_body).toContain('## Summary');
    expect(rendered.pr_body).toContain('PAQ-42');
  });

  it('falls back to type as scope when caller omits it', () => {
    const rendered = renderDelivery(
      DEFAULT_PROCESS,
      {
        ticket: 'PAQ-7',
        ticket_type: 'Task',
        title: 'Bump lockfile',
        summary: 'Bump lockfile.',
      },
      '',
    );
    expect(rendered.commit.startsWith('chore(chore):')).toBe(true);
  });
});
