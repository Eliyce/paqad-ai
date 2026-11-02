import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/module-health-update/scripts/refresh.sh',
  names: [
    'refresh help',
    'refresh invalid input',
    'refresh fixture output',
    'refresh idempotency',
    'refresh dry run',
    'refresh output size',
    'refresh secrets',
  ],
  fixture: {
    args: ['{dir}'],
    bin: { 'paqad-ai': '#!/bin/sh\nprintf \'{"argv":"%s"}\\n\' "$*"\n' },
    stdout:
      '{\n  "rollup": {\n    "argv": "module-health rollup --project-root <dir>"\n  },\n  "sync": {\n    "argv": "module-health sync --project-root <dir>"\n  }\n}\n',
  },
  invalid: {
    args: ['{dir}'],
    bin: { 'paqad-ai': "#!/bin/sh\necho 'engine failed' >&2\nexit 1\n" },
    exit: 0,
  },
});
