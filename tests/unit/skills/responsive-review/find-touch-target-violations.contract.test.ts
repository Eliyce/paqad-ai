import { describeContract } from '../_helpers/contract.js';

describeContract({
  script:
    'runtime/capabilities/coding/skills/responsive-review/scripts/find-touch-target-violations.sh',
  names: [
    'find-touch-target-violations help',
    'find-touch-target-violations invalid input',
    'find-touch-target-violations fixture output',
    'find-touch-target-violations idempotency',
    'find-touch-target-violations dry run',
    'find-touch-target-violations output size',
    'find-touch-target-violations secrets',
  ],
  fixture: {
    args: ['{dir}/src'],
    files: {
      'src/Big.css': '.icon { width: 48px; }',
      'src/Tiny.css': '.icon { width: 18px; height: 18px; }',
    },
    stdout: '<dir>/src/Tiny.css:1\t18\t.icon { width: 18px; height: 18px; }\n',
  },
  invalid: { args: ['--min', 'big'], exit: 2 },
});
