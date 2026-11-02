import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/module-health-update/scripts/list-blocked-metrics.sh',
  names: [
    'list-blocked-metrics help',
    'list-blocked-metrics invalid input',
    'list-blocked-metrics fixture output',
    'list-blocked-metrics idempotency',
    'list-blocked-metrics dry run',
    'list-blocked-metrics output size',
    'list-blocked-metrics secrets',
  ],
  fixture: {
    args: [],
    stdin:
      '{"rollup":{"blocked":null,"unattributed_files":["src/zeta/new.ts","src/alpha/new.ts"],"modules":[{"slug":"payments","profile":{"blocked_metrics":["coverage:not_configured","tests:report_missing:x"]}},{"slug":"auth","profile":{"blocked_metrics":["contract_stability:no_public_api_extractor"]}},{"slug":"core","profile":{"blocked_metrics":[]}}]},"sync":{"processed_events":2,"updated_profiles":["payments","auth"]}}',
    stdout:
      'auth: contract_stability:no_public_api_extractor\npayments: coverage:not_configured, tests:report_missing:x\n',
  },
  invalid: { args: ['no-such-root'], exit: 2 },
});
