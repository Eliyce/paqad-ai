// `paqad-ai index build|query` (issue #353). Builds the deterministic, offline
// code-knowledge index and queries it. Follows the createChecksCommand shape: a
// parent command with subcommands, `--project-root` defaulting to cwd, a `--quiet`
// flag that suppresses the machine-readable JSON line, and `process.exitCode` for a
// failure rather than a mid-action process.exit.

import { Command } from 'commander';

import { buildCodeKnowledgeIndex } from '@/code-knowledge/builder.js';
import { queryCodeKnowledge, type QueryCard } from '@/code-knowledge/query.js';
import { validateCodeKnowledgeIndex } from '@/code-knowledge/schema.js';
import { readCodeKnowledgeIndex, writeCodeKnowledgeIndex } from '@/code-knowledge/store.js';

interface BuildFlags {
  projectRoot: string;
  quiet: boolean;
}

interface QueryFlags {
  projectRoot: string;
  quiet: boolean;
}

export function createIndexCommand(): Command {
  const command = new Command('index').description(
    'Build and query the code-knowledge index (exported symbols + import reachability)',
  );

  command
    .command('build')
    .description('Build the code-knowledge index at .paqad/indexes/code-knowledge.json')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--quiet', 'Suppress the machine-readable summary line', false)
    .action(async (options: BuildFlags) => {
      const index = await buildCodeKnowledgeIndex(options.projectRoot);
      const validation = validateCodeKnowledgeIndex(index);
      if (!validation.valid) {
        console.error(
          '**▸ paqad** · the code-knowledge index failed schema validation — not written',
        );
        for (const error of validation.errors.slice(0, 10)) {
          console.error(`  - ${error}`);
        }
        process.exitCode = 1;
        return;
      }

      const path = writeCodeKnowledgeIndex(options.projectRoot, index);
      const orphans = index.files.filter((file) => file.orphan).length;
      const unusedDeps = index.dependencies.filter((dependency) => !dependency.imported).length;
      console.log(
        `**▸ paqad** · built the code-knowledge index for you — ` +
          `${index.symbols.length} symbols across ${index.files.length} files ` +
          `(${orphans} with no callers, ${unusedDeps} unused deps).`,
      );
      if (!options.quiet) {
        process.stdout.write(
          `${JSON.stringify({
            built: true,
            path,
            symbols: index.symbols.length,
            files: index.files.length,
            orphan_files: orphans,
            unused_dependencies: unusedDeps,
          })}\n`,
        );
      }
    });

  command
    .command('query')
    .description('Look up a symbol name or a project-relative file path in the index')
    .argument('<term>', 'A symbol name or a project-relative file path')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--quiet', 'Suppress the machine-readable summary line', false)
    .action((term: string, options: QueryFlags) => {
      const index = readCodeKnowledgeIndex(options.projectRoot);
      if (index === null) {
        console.error(
          '**▸ paqad** · no code-knowledge index yet — run `paqad-ai index build` first',
        );
        process.exitCode = 2;
        return;
      }

      const result = queryCodeKnowledge(index, term);
      if (result.matches.length === 0) {
        console.log(`**▸ paqad** · nothing named "${term}" in the code-knowledge index.`);
        process.exitCode = 1;
      } else {
        for (const card of result.matches) {
          console.log(formatCard(card));
        }
      }
      if (!options.quiet) {
        process.stdout.write(`${JSON.stringify(result)}\n`);
      }
    });

  return command;
}

function formatCard(card: QueryCard): string {
  if (card.kind === 'symbol') {
    const callers =
      card.top_callers.length > 0 ? card.top_callers.join(', ') : '(none in production code)';
    return [
      `**▸ paqad** · ${card.name} — \`${card.signature}\``,
      `> ${card.file}:${card.line}${card.module_slug ? ` · module ${card.module_slug}` : ''}`,
      `> called by ${card.caller_count} file(s)${card.orphan ? ' · 🟡 no callers (possible dead code)' : ''}`,
      `> top callers: ${callers}`,
    ].join('\n');
  }
  const importers = card.importers.length > 0 ? card.importers.join(', ') : '(none)';
  return [
    `**▸ paqad** · ${card.path}${card.entry_point ? ' · entry point' : ''}`,
    `> imported by ${card.caller_count} file(s)${card.orphan ? ' · 🟡 no importers (possible dead code)' : ''}`,
    `> importers: ${importers}`,
    `> defines: ${card.symbols.map((symbol) => symbol.name).join(', ') || '(no exported symbols)'}`,
  ].join('\n');
}
