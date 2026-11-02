import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/token-conformance-review/scripts/normalize-color.sh',
  names: [
    'normalize-color help',
    'normalize-color invalid input',
    'normalize-color fixture output',
    'normalize-color idempotency',
    'normalize-color dry run',
    'normalize-color output size',
    'normalize-color secrets',
  ],
  fixture: { args: ['#1a73e880'], stdout: '#1a73e880\n' },
  invalid: { args: ['cornflowerblue'], exit: 1 },
});
