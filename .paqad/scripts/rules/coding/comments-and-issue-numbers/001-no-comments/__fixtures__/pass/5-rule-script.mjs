// @paqad-rule-script
// rule_id: RL-0000
// source: docs/instructions/rules/coding/example.md
// kind: deterministic
// scope: changed-files
// runtime: node
process.stdout.write(JSON.stringify({ rule_id: 'RL-0000', kind: 'deterministic', findings: [] }));
