import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/documentation-sync-engine/scripts/route-paths.sh',
  names: [
    'route-paths help',
    'route-paths invalid input',
    'route-paths fixture output',
    'route-paths idempotency',
    'route-paths dry run',
    'route-paths output size',
    'route-paths secrets',
  ],
  fixture: {
    args: [],
    stdin:
      'docs/modules/x/events.md\ndocs/modules/x/contracts.md\ndocs/modules/x/integration.md\ndocs/modules/x/integrations.md\n',
    stdout:
      'integration\tdocs/modules/x/contracts.md\nintegration\tdocs/modules/x/events.md\nintegration\tdocs/modules/x/integration.md\nintegration\tdocs/modules/x/integrations.md\n',
  },
  invalid: { args: [], exit: 0 },
});
