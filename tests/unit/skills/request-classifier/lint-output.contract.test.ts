import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/request-classifier/scripts/lint-output.sh',
  names: [
    'lint-output help',
    'lint-output invalid input',
    'lint-output fixture output',
    'lint-output idempotency',
    'lint-output dry run',
    'lint-output output size',
    'lint-output secrets',
  ],
  fixture: {
    args: [],
    stdin:
      '## Classification\n\nworkflow: bug-fix\nscope: single-module\nrisk: low\nui_impact: no\napi_impact: yes\ndb_impact: yes\n\n## Evidence\n- workflow: "fix the broken login"',
    stdout: 'ok\n',
  },
  invalid: { args: [], stdin: 'workflow: bug-fix\n## Evidence\n', exit: 1 },
});
