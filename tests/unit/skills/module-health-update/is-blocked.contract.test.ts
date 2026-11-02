import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/module-health-update/scripts/is-blocked.sh',
  names: [
    'is-blocked help',
    'is-blocked invalid input',
    'is-blocked fixture output',
    'is-blocked idempotency',
    'is-blocked dry run',
    'is-blocked output size',
    'is-blocked secrets',
  ],
  fixture: {
    args: [],
    stdin:
      '{"rollup":{"blocked":null,"unattributed_files":["src/zeta/new.ts","src/alpha/new.ts"],"modules":[{"slug":"payments","profile":{"blocked_metrics":["coverage:not_configured","tests:report_missing:x"]}},{"slug":"auth","profile":{"blocked_metrics":["contract_stability:no_public_api_extractor"]}},{"slug":"core","profile":{"blocked_metrics":[]}}]},"sync":{"processed_events":2,"updated_profiles":["payments","auth"]}}',
    stdout: 'none\n',
  },
  invalid: { args: [], stdin: 'nope', exit: 2 },
});
