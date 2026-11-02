import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/design-system-coverage/scripts/validate-contract.sh',
  names: [
    'validate-contract help',
    'validate-contract invalid input',
    'validate-contract fixture output',
    'validate-contract idempotency',
    'validate-contract dry run',
    'validate-contract output size',
    'validate-contract secrets',
  ],
  fixture: {
    args: [],
    stdin:
      '{"tier":"missing","files":[],"clauses":{"tokens":[],"components":[],"accessibility":[],"responsive":[],"motion":[],"patterns":[]}}',
    stdout: 'ok\n',
  },
  invalid: { args: [], stdin: '{ "tier": "halfway" }', exit: 1 },
});
