import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/rule-analyzer/scripts/analyze.mjs',
  names: [
    'analyze help',
    'analyze invalid input',
    'analyze fixture output',
    'analyze idempotency',
    'analyze dry run',
    'analyze output size',
    'analyze secrets',
  ],
  fixture: {
    args: ['.'],
    files: {
      'docs/instructions/rules/general.md':
        '# Rules\n\n- Never commit secrets to the repository.\n- Always use named exports.\n',
    },
    stdout:
      '{\n  "inventory": [\n    {\n      "id": "RL-41db",\n      "source": "docs/instructions/rules/general.md",\n      "text": "Never commit secrets to the repository.",\n      "text_hash": "34511637e306def8fd241001e2cd1dc21df84f274928f7727d3f44d6b098652b",\n      "isNew": true\n    },\n    {\n      "id": "RL-c895",\n      "source": "docs/instructions/rules/general.md",\n      "text": "Always use named exports.",\n      "text_hash": "a59e71c1a048cc77625daf0b66dc333eab424c98030c707888d212bfd5174905",\n      "isNew": true\n    }\n  ],\n  "files": [\n    "docs/instructions/rules/general.md"\n  ],\n  "rule_files_hash": "sha256-132b51360fb6a24d8e8f2ea4f5d36c509b2fc7becb9c5a053ed2a65191e61726",\n  "changed_files": [\n    "docs/instructions/rules/general.md"\n  ]\n}\n',
  },
  invalid: { args: ['no-such-root'], exit: 0 },
  writes: ['docs/instructions/rules/general.md'],
  rerun: 'fresh-dir',
});
