import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/module-health-update/scripts/list-unattributed.sh',
  names: [
    'list-unattributed help',
    'list-unattributed invalid input',
    'list-unattributed fixture output',
    'list-unattributed idempotency',
    'list-unattributed dry run',
    'list-unattributed output size',
    'list-unattributed secrets',
  ],
  fixture: {
    args: [],
    stdin:
      '{"rollup":{"blocked":null,"unattributed_files":["src/zeta/new.ts","src/alpha/new.ts"],"modules":[{"slug":"payments","profile":{"blocked_metrics":["coverage:not_configured","tests:report_missing:x"]}},{"slug":"auth","profile":{"blocked_metrics":["contract_stability:no_public_api_extractor"]}},{"slug":"core","profile":{"blocked_metrics":[]}}]},"sync":{"processed_events":2,"updated_profiles":["payments","auth"]}}',
    stdout: 'src/alpha/new.ts\nsrc/zeta/new.ts\n',
  },
  invalid: { args: ['no-such-root'], exit: 2 },
});
