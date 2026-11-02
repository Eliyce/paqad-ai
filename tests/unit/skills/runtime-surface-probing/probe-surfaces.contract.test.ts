import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/security/skills/runtime-surface-probing/scripts/probe-surfaces.sh',
  names: [
    'probe-surfaces help',
    'probe-surfaces invalid input',
    'probe-surfaces fixture output',
    'probe-surfaces idempotency',
    'probe-surfaces dry run',
    'probe-surfaces output size',
    'probe-surfaces secrets',
  ],
  fixture: {
    args: ['http://127.0.0.1:9', 'paths.txt'],
    files: { 'paths.txt': '# probes\n/admin\n' },
    exit: 1,
    stderr: new RegExp('base unreachable', 'u'),
    stdout: '',
  },
  invalid: { args: [], exit: 2 },
});
