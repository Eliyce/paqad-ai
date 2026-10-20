#!/usr/bin/env node
import { createPendingDecision } from 'paqad-ai';

const argv = process.argv.slice(2);
const projectRoot = argv[0];
if (!projectRoot || projectRoot === '--help' || projectRoot === '-h') {
  process.stdout.write(
    'Usage: node scripts/create.mjs <project-root> --category <c> --title <t> ' +
      '--context <ctx> --option <key>=<label> [--option ...] [--recommendation <key>]\n',
  );
  process.exit(projectRoot ? 0 : 1);
}

const flags = { category: '', title: '', context: '', recommendation: null };
const options = [];
for (let i = 1; i < argv.length; i++) {
  const arg = argv[i];
  const value = argv[i + 1];
  if (arg === '--option') {
    const eq = (value ?? '').indexOf('=');
    if (eq === -1) {
      process.stderr.write(`--option must be <key>=<label>, got "${value}"\n`);
      process.exit(1);
    }
    options.push({ option_key: value.slice(0, eq), label: value.slice(eq + 1) });
    i++;
  } else if (arg === '--category' || arg === '--title' || arg === '--context') {
    flags[arg.slice(2)] = value ?? '';
    i++;
  } else if (arg === '--recommendation') {
    flags.recommendation = value ?? null;
    i++;
  } else {
    process.stderr.write(`unknown argument: ${arg}\n`);
    process.exit(1);
  }
}

try {
  const result = createPendingDecision(projectRoot, {
    category: flags.category,
    title: flags.title,
    context: flags.context,
    options,
    recommendation: flags.recommendation,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
