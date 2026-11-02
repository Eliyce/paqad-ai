import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/design-system-sync/scripts/detect-token-additions.sh',
  names: [
    'detect-token-additions help',
    'detect-token-additions invalid input',
    'detect-token-additions fixture output',
    'detect-token-additions idempotency',
    'detect-token-additions dry run',
    'detect-token-additions output size',
    'detect-token-additions secrets',
  ],
  fixture: {
    args: [],
    stdin:
      "diff --git a/src/design-tokens/colors.ts b/src/design-tokens/colors.ts\nindex 0123456..789abcd 100644\n--- a/src/design-tokens/colors.ts\n+++ b/src/design-tokens/colors.ts\n@@ -3,6 +3,8 @@ export const colors = {\n     500: '#1a73e8',\n     600: '#1557b0',\n   },\n+  brand: '#abcdef',\n+  surfaceDeep: '#0f172a',\n   text: {\n     primary: '#111827',\n   },\ndiff --git a/tailwind.config.ts b/tailwind.config.ts\nindex 9999999..aaaaaaa 100644\n--- a/tailwind.config.ts\n+++ b/tailwind.config.ts\n@@ -10,5 +10,7 @@ export default {\n     extend: {\n       spacing: {\n         '13': '52px',\n+        '14': '56px',\n       },\n     },\n   },\n",
    stdout: 'brand\t#abcdef\nsurfaceDeep\t#0f172a\n14\t56px\n',
  },
  invalid: { args: ['/no/such/diff.patch'], exit: 2 },
});
