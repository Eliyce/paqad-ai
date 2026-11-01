import { describeContract } from '../_helpers/contract.js';

describeContract({
  script:
    'runtime/capabilities/coding/skills/design-system-sync/scripts/propose-components-diff.sh',
  names: [
    'propose-components-diff help',
    'propose-components-diff invalid input',
    'propose-components-diff fixture output',
    'propose-components-diff idempotency',
    'propose-components-diff dry run',
    'propose-components-diff output size',
    'propose-components-diff secrets',
  ],
  fixture: {
    args: [],
    stdin: 'Foo\tsrc/components/Foo.tsx\nBar\tsrc/components/Bar.tsx',
    stdout:
      '--- a/docs/instructions/design-system/components.md\n+++ b/docs/instructions/design-system/components.md\n@@ components @@\n+\n+## Foo\n+\n+- variants: TBD\n+- states: default, hover, focus, disabled\n+- composition: TBD (set during documentation_sync)\n+\n+## Bar\n+\n+- variants: TBD\n+- states: default, hover, focus, disabled\n+- composition: TBD (set during documentation_sync)\n',
  },
  invalid: { args: [], exit: 0 },
});
