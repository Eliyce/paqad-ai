import { describeContract } from '../_helpers/contract.js';

describeContract({
  script:
    'runtime/capabilities/coding/skills/design-system-sync/scripts/detect-component-additions.sh',
  names: [
    'detect-component-additions help',
    'detect-component-additions invalid input',
    'detect-component-additions fixture output',
    'detect-component-additions idempotency',
    'detect-component-additions dry run',
    'detect-component-additions output size',
    'detect-component-additions secrets',
  ],
  fixture: {
    args: ['{dir}/d.patch'],
    files: {
      'd.patch':
        'diff --git a/src/components/Existing.tsx b/src/components/Existing.tsx\nindex 111..222\n--- a/src/components/Existing.tsx\n+++ b/src/components/Existing.tsx\n@@ -1 +1 @@\n-old\n+new',
    },
    stdout: '',
  },
  invalid: { args: ['no-such-root'], exit: 2 },
});
