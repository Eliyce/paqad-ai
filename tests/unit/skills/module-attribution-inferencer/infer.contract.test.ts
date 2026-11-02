import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/module-attribution-inferencer/scripts/infer.sh',
  names: [
    'infer help',
    'infer invalid input',
    'infer fixture output',
    'infer idempotency',
    'infer dry run',
    'infer output size',
    'infer secrets',
  ],
  fixture: {
    args: ['prompt.md', '{dir}', '2'],
    files: { 'prompt.md': 'Fix the refund flow\n' },
    bin: { 'paqad-ai': '#!/bin/sh\nprintf \'{"argv":"%s"}\\n\' "$*"\n' },
    stdout:
      '{"argv":"module-decisions infer --project-root <dir> --prompt-file prompt.md --max-choices 2"}\n',
  },
  invalid: { args: ['missing-prompt.md'], exit: 2 },
});
