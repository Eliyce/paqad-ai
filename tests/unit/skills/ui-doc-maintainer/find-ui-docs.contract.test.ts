import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/ui-doc-maintainer/scripts/find-ui-docs.sh',
  names: [
    'find-ui-docs help',
    'find-ui-docs invalid input',
    'find-ui-docs fixture output',
    'find-ui-docs idempotency',
    'find-ui-docs dry run',
    'find-ui-docs output size',
    'find-ui-docs secrets',
  ],
  fixture: {
    args: ['{dir}/modules'],
    files: {
      'modules/users/screens.md': 'wrong location',
      'modules/users/ui/components.md': '',
      'modules/users/ui/flows.md': '',
      'modules/users/ui/screens.md': '',
      'modules/users/ui/states.md': '',
      'modules/users/ui/variants.md': '',
    },
    stdout:
      '<dir>/modules/users/ui/components.md\n<dir>/modules/users/ui/flows.md\n<dir>/modules/users/ui/screens.md\n<dir>/modules/users/ui/states.md\n<dir>/modules/users/ui/variants.md\n',
  },
  invalid: { args: ['no-such-root'], exit: 0 },
});
