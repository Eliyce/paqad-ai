import { describe, expect, it } from 'vitest';

import { renderMarkdown } from '@/dashboard/markdown';
import type { DashboardReport } from '@/dashboard/types';

const BASE: DashboardReport = {
  schemaVersion: 1,
  generatedAt: '2026-05-26T00:00:00.000Z',
  projectRoot: '/tmp/demo',
  projectName: 'demo',
  frameworkVersion: '1.2.0',
  notOnboarded: false,
  overallScore: 75,
  overallBand: 'amber',
  attention: [],
  sections: [],
};

describe('renderMarkdown', () => {
  it('renders the notOnboarded short-circuit', () => {
    const md = renderMarkdown({
      ...BASE,
      notOnboarded: true,
      overallScore: null,
      overallBand: 'unknown',
    });
    expect(md).toMatch(/paqad-ai onboard/);
  });

  it('renders an overall line with the band glyph', () => {
    expect(renderMarkdown(BASE)).toMatch(/Overall:.*75% \(amber\)/);
  });

  it('renders attention items with severity tags', () => {
    const md = renderMarkdown({
      ...BASE,
      attention: [
        { sectionId: 'decisions', message: 'D-1 pending 4d', severity: 'critical' },
        { sectionId: 'stack-drift', message: 'stack drifted', severity: 'warn' },
      ],
    });
    expect(md).toMatch(/\*\*critical\*\*/);
    expect(md).toMatch(/D-1 pending 4d/);
  });

  it('renders a section table', () => {
    const md = renderMarkdown({
      ...BASE,
      sections: [
        {
          id: 'project-profile',
          title: 'Project profile',
          band: 'green',
          score: 100,
          summary: 'All good',
          metrics: [{ label: 'rag', value: 'on' }],
        },
      ],
    });
    expect(md).toMatch(/\| Project profile \| 100%/);
    expect(md).toMatch(/### Project profile/);
    expect(md).toMatch(/- rag: on/);
  });
});
