import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/design-system-coverage/scripts/count-clauses.sh',
  names: [
    'count-clauses help',
    'count-clauses invalid input',
    'count-clauses fixture output',
    'count-clauses idempotency',
    'count-clauses dry run',
    'count-clauses output size',
    'count-clauses secrets',
  ],
  fixture: {
    args: ['{dir}/thing.md'],
    files: {
      'thing.md':
        '---\nname: x\n---\n\n# Heading\n\n## Sub\n\n```\ncode\n```\n\n- one\n- two\n- three',
    },
    stdout: '<dir>/thing.md\t4\n',
  },
  invalid: { args: [], exit: 2 },
});
