import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/content/skills/content-writer/scripts/word-count.sh',
  names: [
    'word-count help',
    'word-count invalid input',
    'word-count fixture output',
    'word-count idempotency',
    'word-count dry run',
    'word-count output size',
    'word-count secrets',
  ],
  fixture: {
    args: ['draft.md'],
    files: {
      'draft.md':
        '---\ntitle: x\n---\nOne two three four.\n```\nignored code words\n```\nFive six.\n',
    },
    stdout: '6\n',
  },
  invalid: { args: ['missing.md'], exit: 2 },
});
