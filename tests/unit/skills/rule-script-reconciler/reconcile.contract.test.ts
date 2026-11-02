import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/rule-script-reconciler/scripts/reconcile.mjs',
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
    args: ['.'],
    files: {
      'docs/instructions/rules/general.md':
        '# Rules\n\n- Never commit secrets to the repository. <!-- @rule RL-41db -->\n- Always use default exports. <!-- @rule RL-c895 -->\n',
      'docs/instructions/rules/rule-script-map.yml':
        'schema_version: 1\ngenerated_at: 2026-11-01T21:51:27.222Z\nrule_files_hash: sha256-132b51360fb6a24d8e8f2ea4f5d36c509b2fc7becb9c5a053ed2a65191e61726\nrules:\n  - id: RL-41db\n    source: docs/instructions/rules/general.md\n    text: Never commit secrets to the repository.\n    text_hash: 34511637e306def8fd241001e2cd1dc21df84f274928f7727d3f44d6b098652b\n    verifiability: deterministic\n    enforced_by: []\n    scripts:\n      - path: .paqad/scripts/rules/general/001-no-secrets.mjs\n        kind: deterministic\n        runtime: node\n        scope: changed-files\n        last_validated_at: 2026-11-01T21:51:27.495Z\n        fixtures_passed: true\n  - id: RL-c895\n    source: docs/instructions/rules/general.md\n    text: Always use named exports.\n    text_hash: a59e71c1a048cc77625daf0b66dc333eab424c98030c707888d212bfd5174905\n    verifiability: unverifiable\n    enforced_by: []\n    scripts: []\n',
      '.paqad/scripts/rules/general/001-no-secrets.mjs':
        "// @paqad-rule-script\n// rule_id: RL-41db\n// source: docs/instructions/rules/general.md\n// kind: deterministic\n// scope: changed-files\n// runtime: node\nimport { readFileSync } from 'node:fs';\nimport { join } from 'node:path';\nconst { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));\nconst findings = [];\nfor (const file of files) {\n  readFileSync(join(projectRoot, file), 'utf8').split('\\n').forEach((line, i) => {\n    if (/SECRET=/.test(line)) findings.push({ file, line: i + 1, message: 'secret committed', severity: 'blocker' });\n  });\n}\nprocess.stdout.write(JSON.stringify({ rule_id: 'RL-41db', kind: 'deterministic', findings }));\n",
      '.paqad/scripts/rules/general/001-no-secrets/__fixtures__/pass/a.env': 'name=app\n',
      '.paqad/scripts/rules/general/001-no-secrets/__fixtures__/fail/a.env': 'SECRET=x\n',
    },
    exit: 1,
    stdout:
      '{\n  "generated_at": "<volatile>",\n  "findings": [\n    {\n      "code": "RS-RULE-EDITED",\n      "rule_id": "RL-c895",\n      "source": "docs/instructions/rules/general.md",\n      "message": "Rule RL-c895 text changed since the map was written. Run `edit rule RL-c895` or `generate rule scripts`."\n    }\n  ],\n  "counts": {\n    "RS-RULE-ADDED": 0,\n    "RS-RULE-EDITED": 1,\n    "RS-RULE-REMOVED": 0,\n    "RS-SCRIPT-STALE": 0,\n    "RS-FIXTURE-FAIL": 0,\n    "RS-CONFLICT": 0,\n    "RS-CACHE-INVALID": 0\n  },\n  "blocked": true\n}\n',
  },
  invalid: { args: ['--bogus'], exit: 0 },
  volatile: [
    new RegExp(
      '\\d{4}-\\d{2}-\\d{2}T\\d{2}[-:]\\d{2}[-:]\\d{2}[-.]\\d{3}Z(?:-[A-Za-z0-9_-]+?-\\d+-\\d+)?',
      'gu',
    ),
  ],
  writes: ['.paqad'],
  rerun: 'fresh-dir',
});
