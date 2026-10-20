// @paqad-rule-script
// rule_id: RL-0000
// source: docs/instructions/rules/coding/example.md
// kind: deterministic
// scope: changed-files
// runtime: node
const findings = [];
// a comment in the body is still a comment
process.stdout.write(JSON.stringify({ rule_id: 'RL-0000', kind: 'deterministic', findings }));
