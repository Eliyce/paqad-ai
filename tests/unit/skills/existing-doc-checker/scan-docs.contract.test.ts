import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/existing-doc-checker/scripts/scan-docs.sh',
  names: [
    'scan-docs help',
    'scan-docs invalid input',
    'scan-docs fixture output',
    'scan-docs idempotency',
    'scan-docs dry run',
    'scan-docs output size',
    'scan-docs secrets',
  ],
  fixture: {
    args: ['invitation'],
    files: {
      'docs/business/onboarding.md': 'invitation policy',
      'docs/modules/users/README.md': 'invitation flow with role check',
      'docs/modules/users/api/endpoints.md': 'unrelated content',
    },
    stdout: 'docs/business/onboarding.md\tinvitation\ndocs/modules/users/README.md\tinvitation\n',
  },
  invalid: { args: [], exit: 2 },
});
