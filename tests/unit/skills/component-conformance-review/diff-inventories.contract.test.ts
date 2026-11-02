import { describeContract } from '../_helpers/contract.js';

describeContract({
  script:
    'runtime/capabilities/coding/skills/component-conformance-review/scripts/diff-inventories.sh',
  names: [
    'diff-inventories help',
    'diff-inventories invalid input',
    'diff-inventories fixture output',
    'diff-inventories idempotency',
    'diff-inventories dry run',
    'diff-inventories output size',
    'diff-inventories secrets',
  ],
  fixture: {
    args: ['--source', '{dir}/inv.tsv', '--declared', '{dir}/declared.tsv'],
    files: {
      'declared.tsv': 'Button\tprimary\tdefault,hover\nInput\ttext\tdefault\nDropdown\t-\t-',
      'inv.tsv':
        'Button\tsrc/components/Button.tsx\nInput\tsrc/components/Input.tsx\nModal\tsrc/components/Modal.tsx',
    },
    stdout:
      'in-source-not-declared\tModal\tsrc/components/Modal.tsx\ndeclared-not-in-source\tDropdown\t-\n',
  },
  invalid: { args: [], exit: 2 },
});
