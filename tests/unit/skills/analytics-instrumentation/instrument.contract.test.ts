import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/analytics-instrumentation/scripts/instrument.mjs',
  names: [
    'instrument help',
    'instrument invalid input',
    'instrument fixture output',
    'instrument idempotency',
    'instrument dry run',
    'instrument output size',
    'instrument secrets',
  ],
  fixture: {
    args: [
      '.',
      '--module',
      'billing',
      '--feature',
      'refunds',
      '--event',
      'refund.requested',
      '--provider',
      'segment',
    ],
    stdout:
      '{\n  "docPath": "docs/modules/billing/analytics/refunds/refund-requested.md",\n  "written": [\n    "docs/modules/billing/analytics/refunds/refund-requested.md",\n    "docs/modules/billing/analytics/index.md"\n  ],\n  "snippet": "analytics.track(\'refund.requested\')"\n}\n',
  },
  invalid: { args: ['.', '--module', 'billing'], exit: 1 },
  writes: ['docs/modules/billing/analytics'],
  rerun: 'fresh-dir',
});
