import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/documentation-sync-engine/scripts/lint-output.sh',
  names: [
    'lint-output help',
    'lint-output invalid input',
    'lint-output fixture output',
    'lint-output idempotency',
    'lint-output dry run',
    'lint-output output size',
    'lint-output secrets',
  ],
  fixture: {
    args: [],
    stdin: 'Documentation Sync: no canonical docs require update.\n',
    stdout: 'ok\n',
  },
  invalid: {
    args: [],
    stdin: '## Documentation Sync\nStale Doc Set: detected 5\nKnown Drift: none\n',
    exit: 1,
  },
});
