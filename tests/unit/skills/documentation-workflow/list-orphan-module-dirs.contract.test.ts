import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/documentation-workflow/scripts/list-orphan-module-dirs.sh',
  names: [
    'list-orphan-module-dirs help',
    'list-orphan-module-dirs invalid input',
    'list-orphan-module-dirs fixture output',
    'list-orphan-module-dirs idempotency',
    'list-orphan-module-dirs dry run',
    'list-orphan-module-dirs output size',
    'list-orphan-module-dirs secrets',
  ],
  fixture: {
    args: [],
    files: {
      'docs/instructions/rules/module-map.yml':
        'users:\n  features:\n    - invite\nbilling:\n  features:\n    - charge',
      'docs/modules/billing/README.md': '',
      'docs/modules/orphan-pkg/README.md': '',
      'docs/modules/users/README.md': '',
    },
    stdout: 'docs/modules/orphan-pkg\n',
  },
  invalid: { args: [], exit: 1 },
});
