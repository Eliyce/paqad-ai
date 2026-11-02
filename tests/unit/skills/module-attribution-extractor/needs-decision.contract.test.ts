import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/module-attribution-extractor/scripts/needs-decision.sh',
  names: [
    'needs-decision help',
    'needs-decision invalid input',
    'needs-decision fixture output',
    'needs-decision idempotency',
    'needs-decision dry run',
    'needs-decision output size',
    'needs-decision secrets',
  ],
  fixture: {
    args: [],
    stdin: '{"needs_decision":[{"slug":"a"},{"slug":"b"}],"candidates":[]}',
    stdout: '2\n',
  },
  invalid: { args: [], stdin: 'not json', exit: 2 },
});
