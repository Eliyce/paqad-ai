import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/cross-module-impact-scanner/scripts/list-modules.sh',
  names: [
    'list-modules help',
    'list-modules invalid input',
    'list-modules fixture output',
    'list-modules idempotency',
    'list-modules dry run',
    'list-modules output size',
    'list-modules secrets',
  ],
  fixture: {
    args: ['{dir}/map.yml'],
    files: {
      'map.yml':
        'users:\n  features:\n    - invite\nbilling:\n  features:\n    - charge\napi-tokens:',
    },
    stdout: 'api-tokens\nbilling\nusers\n',
  },
  invalid: { args: ['/no/such/map.yml'], exit: 1 },
});
