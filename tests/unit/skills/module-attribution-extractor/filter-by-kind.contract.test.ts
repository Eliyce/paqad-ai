import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/module-attribution-extractor/scripts/filter-by-kind.sh',
  names: [
    'filter-by-kind help',
    'filter-by-kind invalid input',
    'filter-by-kind fixture output',
    'filter-by-kind idempotency',
    'filter-by-kind dry run',
    'filter-by-kind output size',
    'filter-by-kind secrets',
  ],
  fixture: {
    args: ['unknown'],
    stdin:
      '{"candidates":[{"slug":"a","kind":"unknown"},{"slug":"b","kind":"exact-match"},{"slug":"c","kind":"unknown"}]}',
    stdout: '[{"slug":"a","kind":"unknown"},{"slug":"c","kind":"unknown"}]',
  },
  invalid: { args: [], exit: 2 },
});
