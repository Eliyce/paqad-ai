import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/copy-and-ia-review/scripts/check-action-verbs.sh',
  names: [
    'check-action-verbs help',
    'check-action-verbs invalid input',
    'check-action-verbs fixture output',
    'check-action-verbs idempotency',
    'check-action-verbs dry run',
    'check-action-verbs output size',
    'check-action-verbs secrets',
  ],
  fixture: {
    args: ['--verbs', 'Save, Cancel, Delete, Submit, Done', '--root', '{dir}/src'],
    files: {
      'src/A.tsx': '<button>OK</button>',
      'src/B.tsx': '<Button>Yes</Button>',
      'src/C.tsx': '<button>Save</button>',
    },
    stdout: '<dir>/src/A.tsx:1\tOK\n<dir>/src/B.tsx:1\tYes\n',
  },
  invalid: { args: [], exit: 2 },
});
