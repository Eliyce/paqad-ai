#!/usr/bin/env node
// Purpose: Open a Decision Pause packet — mint a collision-free `D-<ULID>` id,
//          build the pending packet from the supplied content, and write it to
//          `.paqad/decisions/pending/D-<ULID>.json`. The agent supplies only
//          content; the id, timestamps, and JSON plumbing are handled here so a
//          hand-picked sequential `D-{N}` can never be minted (issue #272).
// Usage:   node scripts/create.mjs <project-root> \
//            --category <category> --title <title> --context <context> \
//            --option <key>=<label> [--option <key>=<label> ...] \
//            [--recommendation <key>]
// Output:  JSON { id, path } on stdout.
// Exit:    0 on success, 1 on usage/validation error.
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
