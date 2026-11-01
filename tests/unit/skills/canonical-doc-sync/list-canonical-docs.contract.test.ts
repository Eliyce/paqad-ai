import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/canonical-doc-sync/scripts/list-canonical-docs.sh',
  names: [
    'list-canonical-docs help',
    'list-canonical-docs invalid input',
    'list-canonical-docs fixture output',
    'list-canonical-docs idempotency',
    'list-canonical-docs dry run',
    'list-canonical-docs output size',
    'list-canonical-docs secrets',
  ],
  fixture: {
    args: ['{dir}/docs'],
    files: {
      'docs/business/onboarding.md': '# b',
      'docs/maintainers/canonical-contract-map.md': '# c',
      'docs/modules/a/README.md': '# a',
      'docs/random/scratch.md': 'should be excluded',
      'docs/registries/modules.md': '# d',
    },
    stdout:
      '<dir>/docs/business/onboarding.md\n<dir>/docs/maintainers/canonical-contract-map.md\n<dir>/docs/modules/a/README.md\n<dir>/docs/registries/modules.md\n',
  },
  invalid: { args: ['no-such-root'], exit: 0 },
});
