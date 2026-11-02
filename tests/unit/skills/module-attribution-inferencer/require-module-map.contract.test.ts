import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/module-attribution-inferencer/scripts/require-module-map.sh',
  names: [
    'require-module-map help',
    'require-module-map invalid input',
    'require-module-map fixture output',
    'require-module-map idempotency',
    'require-module-map dry run',
    'require-module-map output size',
    'require-module-map secrets',
  ],
  fixture: {
    args: ['{dir}'],
    files: { 'docs/instructions/rules/module-map.yml': 'modules: []\n' },
    stdout: '<dir>/docs/instructions/rules/module-map.yml\n',
  },
  invalid: { args: ['{dir}'], exit: 1 },
});
