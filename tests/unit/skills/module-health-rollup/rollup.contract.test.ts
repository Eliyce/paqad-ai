import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/module-health-rollup/scripts/rollup.sh',
  names: [
    'rollup help',
    'rollup invalid input',
    'rollup fixture output',
    'rollup idempotency',
    'rollup dry run',
    'rollup output size',
    'rollup secrets',
  ],
  fixture: {
    args: ['{dir}', '--from-report', 'report.json'],
    files: { 'report.json': '{}\n' },
    bin: { 'paqad-ai': '#!/bin/sh\nprintf \'{"argv":"%s"}\\n\' "$*"\n' },
    stdout: '{"argv":"module-health rollup --project-root <dir> --from-report report.json"}\n',
  },
  invalid: { args: ['--bogus'], exit: 2 },
});
