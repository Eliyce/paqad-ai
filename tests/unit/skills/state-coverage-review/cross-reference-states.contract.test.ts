import { describeContract } from '../_helpers/contract.js';

describeContract({
  script:
    'runtime/capabilities/coding/skills/state-coverage-review/scripts/cross-reference-states.sh',
  names: [
    'cross-reference-states help',
    'cross-reference-states invalid input',
    'cross-reference-states fixture output',
    'cross-reference-states idempotency',
    'cross-reference-states dry run',
    'cross-reference-states output size',
    'cross-reference-states secrets',
  ],
  fixture: {
    args: [
      '--declared',
      'default,focus,disabled,loading,error',
      '--implemented',
      '{dir}/impl.tsv',
      '--tested',
      '{dir}/tested.tsv',
    ],
    files: {
      'impl.tsv': 'default\timplicit\nfocus\tcss-pseudo\ndisabled\tprop',
      'tested.tsv': 'default\tButton.test\nfocus\tButton.test\nloading\tButton.test',
    },
    stdout:
      'declared-not-implemented\terror\ndeclared-not-implemented\tloading\nimplemented-not-tested\tdisabled\ntested-not-implemented\tloading\n',
  },
  invalid: { args: [], exit: 2 },
});
