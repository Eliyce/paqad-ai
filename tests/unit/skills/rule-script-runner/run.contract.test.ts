import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/rule-script-runner/scripts/run.mjs',
  names: [
    'run help',
    'run invalid input',
    'run fixture output',
    'run idempotency',
    'run dry run',
    'run output size',
    'run secrets',
  ],
  fixture: {
    args: ['.', 'turn-end', 'app.env'],
    files: {
      'docs/instructions/rules/general.md':
        '# Rules\n\n- Never commit secrets to the repository. <!-- @rule RL-41db -->\n- Always use named exports. <!-- @rule RL-c895 -->\n',
      'docs/instructions/rules/rule-script-map.yml':
        'schema_version: 1\ngenerated_at: 2026-11-01T21:51:27.222Z\nrule_files_hash: sha256-132b51360fb6a24d8e8f2ea4f5d36c509b2fc7becb9c5a053ed2a65191e61726\nrules:\n  - id: RL-41db\n    source: docs/instructions/rules/general.md\n    text: Never commit secrets to the repository.\n    text_hash: 34511637e306def8fd241001e2cd1dc21df84f274928f7727d3f44d6b098652b\n    verifiability: deterministic\n    enforced_by: []\n    scripts:\n      - path: .paqad/scripts/rules/general/001-no-secrets.mjs\n        kind: deterministic\n        runtime: node\n        scope: changed-files\n        last_validated_at: 2026-11-01T21:51:27.495Z\n        fixtures_passed: true\n  - id: RL-c895\n    source: docs/instructions/rules/general.md\n    text: Always use named exports.\n    text_hash: a59e71c1a048cc77625daf0b66dc333eab424c98030c707888d212bfd5174905\n    verifiability: unverifiable\n    enforced_by: []\n    scripts: []\n',
      '.paqad/scripts/rules/general/001-no-secrets.mjs':
        "// @paqad-rule-script\n// rule_id: RL-41db\n// source: docs/instructions/rules/general.md\n// kind: deterministic\n// scope: changed-files\n// runtime: node\nimport { readFileSync } from 'node:fs';\nimport { join } from 'node:path';\nconst { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));\nconst findings = [];\nfor (const file of files) {\n  readFileSync(join(projectRoot, file), 'utf8').split('\\n').forEach((line, i) => {\n    if (/SECRET=/.test(line)) findings.push({ file, line: i + 1, message: 'secret committed', severity: 'blocker' });\n  });\n}\nprocess.stdout.write(JSON.stringify({ rule_id: 'RL-41db', kind: 'deterministic', findings }));\n",
      '.paqad/scripts/rules/general/001-no-secrets/__fixtures__/pass/a.env': 'name=app\n',
      '.paqad/scripts/rules/general/001-no-secrets/__fixtures__/fail/a.env': 'SECRET=x\n',
      'app.env': 'SECRET=abc\n',
    },
    stdout:
      '{\n  "generated_at": "<volatile>",\n  "mode": "turn-end",\n  "rule_files_hash": "sha256-132b51360fb6a24d8e8f2ea4f5d36c509b2fc7becb9c5a053ed2a65191e61726",\n  "script_files_hash": "sha256-1faac6e89073f7a67160cd481ddb9db74ed02246052104c800abb1d7158f3660",\n  "target_files_hash": "sha256-ff2ebd85acc9605dfb78d9826bbaafc32451509bd1bcf1040834a2abc19ef231",\n  "results": [\n    {\n      "rule_id": "RL-41db",\n      "script": ".paqad/scripts/rules/general/001-no-secrets.mjs",\n      "kind": "deterministic",\n      "findings": [\n        {\n          "file": "app.env",\n          "line": 1,\n          "message": "secret committed",\n          "severity": "blocker"\n        }\n      ]\n    }\n  ],\n  "counts": {\n    "deterministic": 1,\n    "heuristic": 0,\n    "skipped": 0\n  },\n  "blocking": false\n}\n',
  },
  invalid: { args: ['.'], exit: 1 },
  volatile: [
    new RegExp(
      '\\d{4}-\\d{2}-\\d{2}T\\d{2}[-:]\\d{2}[-:]\\d{2}[-.]\\d{3}Z(?:-[A-Za-z0-9_-]+?-\\d+-\\d+)?',
      'gu',
    ),
  ],
  writes: ['.paqad'],
  rerun: 'fresh-dir',
});
