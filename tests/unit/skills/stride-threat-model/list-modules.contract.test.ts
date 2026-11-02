import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/security/skills/stride-threat-model/scripts/list-modules.sh',
  names: [
    'list-modules help',
    'list-modules invalid input',
    'list-modules fixture output',
    'list-modules idempotency',
    'list-modules dry run',
    'list-modules output size',
    'list-modules secrets',
  ],
  fixture: {
    files: { 'docs/modules/orders/index.md': 'x\n', 'docs/modules/billing/index.md': 'x\n' },
    stdout: 'billing\norders\n',
  },
  invalid: { exit: 0 },
});
