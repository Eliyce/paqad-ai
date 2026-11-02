import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/copy-and-ia-review/scripts/check-terminology.sh',
  names: [
    'check-terminology help',
    'check-terminology invalid input',
    'check-terminology fixture output',
    'check-terminology idempotency',
    'check-terminology dry run',
    'check-terminology output size',
    'check-terminology secrets',
  ],
  fixture: {
    args: ['--preferred', 'Member', '--avoid', 'User,Account', '--root', '{dir}/src'],
    files: {
      'src/OK.tsx': '<h1>Member directory</h1>',
      'src/Settings.tsx': '<h1>User Settings</h1>',
      'src/Team.tsx': '<p>Add a user to the team.</p>',
    },
    stdout: '<dir>/src/Settings.tsx:1\tUser\tMember\n<dir>/src/Team.tsx:1\tuser\tMember\n',
  },
  invalid: { args: [], exit: 2 },
});
