import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/decision/scripts/create.mjs',
  names: [
    'create help',
    'create invalid input',
    'create fixture output',
    'create idempotency',
    'create dry run',
    'create output size',
    'create secrets',
  ],
  fixture: {
    args: [
      '.',
      '--category',
      'scope',
      '--title',
      'Pick a cache',
      '--context',
      'Two options',
      '--option',
      'a=Redis',
      '--option',
      'b=Memory',
      '--recommendation',
      'a',
    ],
    stdout: '{\n  "id": "<volatile>",\n  "path": ".paqad/decisions/pending/<volatile>.json"\n}\n',
  },
  invalid: { args: ['.', '--title', 'No options'], exit: 1 },
  volatile: [new RegExp('D-[0-9A-Z]{26}', 'gu')],
  writes: ['.paqad/decisions'],
  rerun: 'fresh-dir',
});
