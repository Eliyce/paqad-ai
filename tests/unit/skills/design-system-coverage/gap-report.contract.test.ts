import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/design-system-coverage/scripts/gap-report.sh',
  names: [
    'gap-report help',
    'gap-report invalid input',
    'gap-report fixture output',
    'gap-report idempotency',
    'gap-report dry run',
    'gap-report output size',
    'gap-report secrets',
  ],
  fixture: {
    args: ['{dir}/docs/instructions/design-system'],
    files: {
      'docs/instructions/design-system/components.md': '   \n  \n',
      'docs/instructions/design-system/tokens.md': '',
    },
    stdout:
      'DT-DS-0001\tempty-file\tmedium\t<dir>/docs/instructions/design-system/tokens.md\tcontract file exists but is empty; add at least one clause\nDT-DS-0002\tempty-file\tmedium\t<dir>/docs/instructions/design-system/components.md\tcontract file exists but is empty; add at least one clause\nDT-DS-0003\tmissing-file\tmedium\t<dir>/docs/instructions/design-system/accessibility.md\tcontract file is absent; create accessibility.md to declare accessibility\nDT-DS-0004\tmissing-file\tmedium\t<dir>/docs/instructions/design-system/responsive.md\tcontract file is absent; create responsive.md to declare responsive\nDT-DS-0005\tmissing-file\tmedium\t<dir>/docs/instructions/design-system/motion.md\tcontract file is absent; create motion.md to declare motion\nDT-DS-0006\tmissing-file\tmedium\t<dir>/docs/instructions/design-system/patterns.md\tcontract file is absent; create patterns.md to declare patterns\n',
  },
  invalid: { args: ['no-such-root'], exit: 0 },
});
