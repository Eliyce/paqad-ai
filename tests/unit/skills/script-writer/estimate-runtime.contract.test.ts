import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/content/skills/script-writer/scripts/estimate-runtime.sh',
  names: [
    'estimate-runtime help',
    'estimate-runtime invalid input',
    'estimate-runtime fixture output',
    'estimate-runtime idempotency',
    'estimate-runtime dry run',
    'estimate-runtime output size',
    'estimate-runtime secrets',
  ],
  fixture: {
    args: ['script.md', '100'],
    files: {
      'script.md':
        '## Scene 1\n- **VO:** Refunds take five days to reach your card.\nVO: Ask support any time.\n[music]\n',
    },
    stdout: 'Words: 12 | WPM: 100 | Runtime: 00:07\n',
  },
  invalid: { args: ['missing.md'], exit: 2 },
});
