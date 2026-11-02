import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/design-system-sync/scripts/propose-tokens-diff.sh',
  names: [
    'propose-tokens-diff help',
    'propose-tokens-diff invalid input',
    'propose-tokens-diff fixture output',
    'propose-tokens-diff idempotency',
    'propose-tokens-diff dry run',
    'propose-tokens-diff output size',
    'propose-tokens-diff secrets',
  ],
  fixture: {
    args: [],
    stdin: 'color.brand\t#abcdef\nspacing.14\t56px',
    stdout:
      '--- a/docs/instructions/design-system/tokens.md\n+++ b/docs/instructions/design-system/tokens.md\n@@ tokens @@\n+- color.brand = #abcdef\n+- spacing.14 = 56px\n',
  },
  invalid: { args: [], exit: 0 },
});
