import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/token-conformance-review/scripts/parse-tokens.sh',
  names: [
    'parse-tokens help',
    'parse-tokens invalid input',
    'parse-tokens fixture output',
    'parse-tokens idempotency',
    'parse-tokens dry run',
    'parse-tokens output size',
    'parse-tokens secrets',
  ],
  fixture: {
    args: ['{dir}/tokens.md'],
    files: {
      'tokens.md':
        '# Tokens\n\nSome prose explaining the system.\n\n## Colors\n\n- color.brand = #abcdef\n- not a token line\n- color.invalid =\n- = #orphan\n* color.bullet-star = #112233',
    },
    stdout: 'color.brand\t#abcdef\tcolor\ncolor.bullet-star\t#112233\tcolor\n',
  },
  invalid: { args: [], exit: 2 },
});
