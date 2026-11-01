import { describeContract } from '../_helpers/contract.js';

describeContract({
  script:
    'runtime/capabilities/coding/skills/design-system-coverage/scripts/list-contract-files.sh',
  names: [
    'list-contract-files help',
    'list-contract-files invalid input',
    'list-contract-files fixture output',
    'list-contract-files idempotency',
    'list-contract-files dry run',
    'list-contract-files output size',
    'list-contract-files secrets',
  ],
  fixture: {
    args: ['{dir}/docs/instructions/design-system'],
    files: {
      'docs/instructions/design-system/components.md': '',
      'docs/instructions/design-system/tokens.md': '# Tokens\n\ncolor.primary.500 = #1a73e8\n',
    },
    stdout:
      '<dir>/docs/instructions/design-system/tokens.md\tpresent\tnon-empty\n<dir>/docs/instructions/design-system/components.md\tpresent\tempty\n<dir>/docs/instructions/design-system/accessibility.md\tabsent\tempty\n<dir>/docs/instructions/design-system/responsive.md\tabsent\tempty\n<dir>/docs/instructions/design-system/motion.md\tabsent\tempty\n<dir>/docs/instructions/design-system/patterns.md\tabsent\tempty\n',
  },
  invalid: { args: ['no-such-root'], exit: 0 },
});
