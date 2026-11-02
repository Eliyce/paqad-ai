import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/module-health-rollup/scripts/is-blocked.sh',
  names: [
    'is-blocked help',
    'is-blocked invalid input',
    'is-blocked fixture output',
    'is-blocked idempotency',
    'is-blocked dry run',
    'is-blocked output size',
    'is-blocked secrets',
  ],
  fixture: {
    args: [],
    stdin: '{"blocked":null,"modules":[],"unattributed_files":[]}',
    stdout: 'none\n',
  },
  invalid: { args: [], stdin: 'nope', exit: 2 },
});
