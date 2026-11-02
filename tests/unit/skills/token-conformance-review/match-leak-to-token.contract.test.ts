import { describeContract } from '../_helpers/contract.js';

describeContract({
  script:
    'runtime/capabilities/coding/skills/token-conformance-review/scripts/match-leak-to-token.sh',
  names: [
    'match-leak-to-token help',
    'match-leak-to-token invalid input',
    'match-leak-to-token fixture output',
    'match-leak-to-token idempotency',
    'match-leak-to-token dry run',
    'match-leak-to-token output size',
    'match-leak-to-token secrets',
  ],
  fixture: {
    args: ['--leak', '#1a73e8', '--tokens', '{dir}/tokens.tsv'],
    files: { 'tokens.tsv': 'color.primary.500\t#1a73e8\tcolor\ncolor.brand.blue\t#1a73e8\tcolor' },
    stdout: 'ambiguous\tcolor.primary.500,color.brand.blue\n',
  },
  invalid: { args: [], exit: 2 },
});
