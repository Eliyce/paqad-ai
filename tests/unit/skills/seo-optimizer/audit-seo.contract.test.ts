import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/content/skills/seo-optimizer/scripts/audit-seo.sh',
  names: [
    'audit-seo help',
    'audit-seo invalid input',
    'audit-seo fixture output',
    'audit-seo idempotency',
    'audit-seo dry run',
    'audit-seo output size',
    'audit-seo secrets',
  ],
  fixture: {
    args: ['draft.md', 'refunds'],
    files: {
      'draft.md':
        '# How refunds work\nA short guide to refunds for store owners.\n\n## Asking for a refund\n\nAsk support about refunds. ![form](form.png)\n',
    },
    stdout:
      'h1_count: 1\nh2_count: 1\nh3_count: 0\ntitle: How refunds work\ntitle_len: 16\nmeta: A short guide to refunds for store owners.\nmeta_len: 42\nprimary_kw: refunds\nprimary_kw_count: 3\nimages: 1\nimages_with_alt: 1\ninternal_links: 0\n',
  },
  invalid: { args: ['missing.md'], exit: 2 },
});
