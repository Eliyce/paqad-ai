import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/workflow-router/scripts/route-request.sh',
  names: [
    'route-request help',
    'route-request invalid input',
    'route-request fixture output',
    'route-request idempotency',
    'route-request dry run',
    'route-request output size',
    'route-request secrets',
  ],
  fixture: {
    args: ['now create the module documentation for users'],
    stdout:
      'workflow: module-documentation\nreason: matched rule at priority 225\nmatched_rule: "now create the module documentation"\n',
  },
  invalid: { args: ['no-such-root'], exit: 0 },
});
