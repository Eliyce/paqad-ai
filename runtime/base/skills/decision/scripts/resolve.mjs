#!/usr/bin/env node
import { resolvePendingDecision } from 'paqad-ai';

const [projectRoot, id, chosen, ...rationaleParts] = process.argv.slice(2);
const help = projectRoot === '--help' || projectRoot === '-h';
if (help || !projectRoot || !id || !chosen) {
  process.stdout.write(
    'Usage: node scripts/resolve.mjs <project-root> <id> <chosen> [rationale]\n',
  );
  process.exit(help ? 0 : 1);
}

try {
  const { path } = resolvePendingDecision(projectRoot, id, chosen, rationaleParts.join(' '));
  process.stdout.write(`${JSON.stringify({ path }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
