import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/acceptance-criteria-gen/scripts/extract-ac-ids.sh',
  names: [
    'extract-ac-ids help',
    'extract-ac-ids invalid input',
    'extract-ac-ids fixture output',
    'extract-ac-ids idempotency',
    'extract-ac-ids dry run',
    'extract-ac-ids output size',
    'extract-ac-ids secrets',
  ],
  fixture: {
    args: ['-h'],
    stdout:
      'Purpose: Extract all flat AC identifiers (AC-N) from a markdown spec.\nUsage:   bash scripts/extract-ac-ids.sh <spec-file>   (or pipe text on stdin)\nOutput:  Sorted, deduplicated list of AC ids, one per line.\nExits:   0 ok | 2 usage error\n',
  },
  invalid: { args: ['/definitely/not/here.md'], exit: 2 },
});
