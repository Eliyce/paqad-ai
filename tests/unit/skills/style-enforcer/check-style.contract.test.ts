import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/content/skills/style-enforcer/scripts/check-style.sh',
  names: [
    'check-style help',
    'check-style invalid input',
    'check-style fixture output',
    'check-style idempotency',
    'check-style dry run',
    'check-style output size',
    'check-style secrets',
  ],
  fixture: {
    args: ['draft.md', 'style.tsv'],
    files: {
      'draft.md': 'We utilize the tool.\nWe use the tool.\n',
      'style.tsv': '# rules\nforbid\tutilize\n',
    },
    stdout: 'rule | line | excerpt\nforbid:utilize | 1 | We utilize the tool.\n',
  },
  invalid: { args: ['missing.md'], exit: 2 },
});
