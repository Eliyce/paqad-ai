import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/module-health-rollup/scripts/list-unattributed.sh',
  names: [
    'list-unattributed help',
    'list-unattributed invalid input',
    'list-unattributed fixture output',
    'list-unattributed idempotency',
    'list-unattributed dry run',
    'list-unattributed output size',
    'list-unattributed secrets',
  ],
  fixture: {
    args: [],
    stdin: '{"blocked":null,"modules":[],"unattributed_files":["src/z.ts","src/a.ts","src/m.ts"]}',
    stdout: 'src/a.ts\nsrc/m.ts\nsrc/z.ts\n',
  },
  invalid: { args: ['no-such-root'], exit: 2 },
});
