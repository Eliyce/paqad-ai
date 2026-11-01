import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/module-attribution-inferencer/scripts/is-confident.sh',
  names: [
    'is-confident help',
    'is-confident invalid input',
    'is-confident fixture output',
    'is-confident idempotency',
    'is-confident dry run',
    'is-confident output size',
    'is-confident secrets',
  ],
  fixture: { args: [], stdin: '{"confident":true,"choices":[]}', stdout: 'true\n' },
  invalid: { args: [], stdin: 'nope', exit: 2 },
});
