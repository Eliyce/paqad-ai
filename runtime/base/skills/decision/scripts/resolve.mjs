#!/usr/bin/env node
import { answerPendingDecision } from 'paqad-ai';

const args = process.argv.slice(2);
const always = args.includes('--always');
const [projectRoot, id, chosen, ...rationaleParts] = args.filter((arg) => arg !== '--always');
const help = projectRoot === '--help' || projectRoot === '-h';
if (help || !projectRoot || !id || !chosen) {
  process.stdout.write(
    'Usage: node scripts/resolve.mjs <project-root> <id> <chosen> [rationale] [--always]\n',
  );
  process.exit(help ? 0 : 1);
}

try {
  const { path, rule } = answerPendingDecision(projectRoot, id, chosen, rationaleParts.join(' '), {
    always,
  });
  process.stdout.write(
    `${JSON.stringify({ path, ...(rule ? { standing_answer: rule.id } : {}) }, null, 2)}\n`,
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
