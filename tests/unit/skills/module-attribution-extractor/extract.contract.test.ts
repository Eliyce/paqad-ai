import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/module-attribution-extractor/scripts/extract.sh',
  names: [
    'extract help',
    'extract invalid input',
    'extract fixture output',
    'extract idempotency',
    'extract dry run',
    'extract output size',
    'extract secrets',
  ],
  fixture: {
    args: ['prompt.md'],
    files: { 'prompt.md': 'Fix the refund flow in billing\n' },
    bin: { 'paqad-ai': '#!/bin/sh\nprintf \'{"argv":"%s"}\\n\' "$*"\n' },
    stdout: '{"argv":"module-decisions extract --project-root <dir> --prompt-file prompt.md"}\n',
  },
  invalid: { args: ['missing-prompt.md'], exit: 2 },
});
