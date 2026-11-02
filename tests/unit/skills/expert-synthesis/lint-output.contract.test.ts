import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/expert-synthesis/scripts/lint-output.sh',
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
    stdin:
      '{"verdict":"ready","accepted":["EX-db-expert-1"],"declined":[],"conflicts":[],"gaps":[],"questions":[],"tokens":100}',
    stdout: 'ok\n',
  },
  invalid: { args: ['/no/such/file.json'], exit: 2 },
});
