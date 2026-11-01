import { describeContract } from '../_helpers/contract.js';

describeContract({
  script:
    'runtime/capabilities/security/skills/permission-boundary-review/scripts/scan-authz-smells.sh',
  names: [
    'scan-authz-smells help',
    'scan-authz-smells invalid input',
    'scan-authz-smells fixture output',
    'scan-authz-smells idempotency',
    'scan-authz-smells dry run',
    'scan-authz-smells output size',
    'scan-authz-smells secrets',
  ],
  fixture: {
    args: ['src'],
    files: { 'src/orders.js': 'Order.findById(req.params.id);\n' },
    stdout:
      'smell | file:line | excerpt\nlookup-by-user-id-no-authz | src/orders.js:1 | Order.findById(req.params.id);\n',
  },
  invalid: { args: ['no-such-root'], exit: 0 },
});
