import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/security/skills/stride-threat-model/scripts/validate-threats.sh',
  names: [
    'validate-threats help',
    'validate-threats invalid input',
    'validate-threats fixture output',
    'validate-threats idempotency',
    'validate-threats dry run',
    'validate-threats output size',
    'validate-threats secrets',
  ],
  fixture: {
    stdin:
      '[{"module":"orders","asset":"refund endpoint","stride_category":"tampering","threat_description":"Refund amount changed in transit","severity_hint":"high"}]',
    stdout: 'ok\n',
  },
  invalid: { stdin: 'not json', exit: 1 },
});
