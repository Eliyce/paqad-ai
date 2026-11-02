import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/request-classifier/scripts/extract-signals.sh',
  names: [
    'extract-signals help',
    'extract-signals invalid input',
    'extract-signals fixture output',
    'extract-signals idempotency',
    'extract-signals dry run',
    'extract-signals output size',
    'extract-signals secrets',
  ],
  fixture: {
    args: [],
    stdin: 'process refund',
    stdout:
      'workflow: feature-development\nui_impact: no\napi_impact: no\ndb_impact: no\nscope: single-module\nrisk_hint: medium\n',
  },
  invalid: { args: ['/no/such/file.txt'], exit: 2 },
});
