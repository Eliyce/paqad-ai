import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/module-map-reconciler/scripts/reconcile.sh',
  names: [
    'reconcile help',
    'reconcile invalid input',
    'reconcile fixture output',
    'reconcile idempotency',
    'reconcile dry run',
    'reconcile output size',
    'reconcile secrets',
  ],
  fixture: {
    args: ['{dir}'],
    bin: { 'paqad-ai': '#!/bin/sh\nprintf \'{"argv":"%s","findings":[]}\\n\' "$*"\n' },
    stdout: '{"argv":"module-map reconcile --project-root <dir>","findings":[]}\n',
  },
  invalid: {
    args: ['{dir}'],
    bin: {
      'paqad-ai': "#!/bin/sh\necho 'Reconciler blocked: source_roots_unknown.' >&2\nexit 3\n",
    },
    exit: 3,
  },
});
