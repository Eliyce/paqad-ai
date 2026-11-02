import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/content/skills/content-reviewer/scripts/scan-prose.sh',
  names: [
    'scan-prose help',
    'scan-prose invalid input',
    'scan-prose fixture output',
    'scan-prose idempotency',
    'scan-prose dry run',
    'scan-prose output size',
    'scan-prose secrets',
  ],
  fixture: {
    args: ['draft.md'],
    files: {
      'draft.md':
        '# Refunds\n\nIt is very important to note that refunds are basically really simple.\nThe refund was processed by the team.\n',
    },
    stdout:
      'smell | line | excerpt\nfiller-word | 3 | It is very important to note that refunds are basically really simple.\npassive-voice-candidate | 4 | The refund was processed by the team.\n',
  },
  invalid: { args: ['missing.md'], exit: 2 },
});
