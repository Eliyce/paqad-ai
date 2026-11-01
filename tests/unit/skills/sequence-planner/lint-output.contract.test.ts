import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/sequence-planner/scripts/lint-output.sh',
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
      '## Implementation Sequence\n### Story 1 — schema migration\n- **Goal:** add column\n- **Dependencies:** none\n- **Verification:** migration test\n- **Reversibility:** medium\n- **Blast radius:** isolated\n### Story 2 — handler change\n- **Goal:** wire field\n- **Dependencies:** Story 1\n- **Verification:** route test\n- **Reversibility:** easy\n- **Blast radius:** isolated\n## Sequencing Risks\n- none',
    stdout: 'ok\n',
  },
  invalid: { args: [], stdin: '## Sequencing Risks\nnone\n', exit: 1 },
});
