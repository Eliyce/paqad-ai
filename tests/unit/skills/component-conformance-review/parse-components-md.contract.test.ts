import { describeContract } from '../_helpers/contract.js';

describeContract({
  script:
    'runtime/capabilities/coding/skills/component-conformance-review/scripts/parse-components-md.sh',
  names: [
    'parse-components-md help',
    'parse-components-md invalid input',
    'parse-components-md fixture output',
    'parse-components-md idempotency',
    'parse-components-md dry run',
    'parse-components-md output size',
    'parse-components-md secrets',
  ],
  fixture: {
    args: ['components.md'],
    files: {
      'components.md':
        '# Components\n\n## Button\n\n- variants: primary, secondary\n- states: default, hover, disabled\n\n## Card\n\n- variants: plain\n',
    },
    stdout: 'Button\tprimary,secondary\tdefault,hover,disabled\nCard\tplain\t-\n',
  },
  invalid: { args: ['missing.md'], exit: 2 },
});
