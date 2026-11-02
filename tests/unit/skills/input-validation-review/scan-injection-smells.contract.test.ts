import { describeContract } from '../_helpers/contract.js';

describeContract({
  script:
    'runtime/capabilities/security/skills/input-validation-review/scripts/scan-injection-smells.sh',
  names: [
    'scan-injection-smells help',
    'scan-injection-smells invalid input',
    'scan-injection-smells fixture output',
    'scan-injection-smells idempotency',
    'scan-injection-smells dry run',
    'scan-injection-smells output size',
    'scan-injection-smells secrets',
  ],
  fixture: {
    args: ['src'],
    files: { 'src/run.js': 'child_process.exec(cmd + input);\n' },
    stdout:
      'smell | file:line | excerpt\nshell-exec-with-input | src/run.js:1 | child_process.exec(cmd + input);\nshell-exec-builtin | src/run.js:1 | child_process.exec(cmd + input);\n',
  },
  invalid: { args: ['no-such-root'], exit: 0 },
});
