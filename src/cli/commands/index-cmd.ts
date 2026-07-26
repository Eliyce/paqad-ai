// `paqad-ai index build|query` (issue #353). Builds the deterministic, offline
// code-knowledge index and queries it. Follows the createChecksCommand shape: a
// parent command with subcommands, `--project-root` defaulting to cwd, a `--quiet`
// flag that suppresses the machine-readable JSON line, and `process.exitCode` for a
// failure rather than a mid-action process.exit.

import { Command } from 'commander';

import { buildCodeKnowledgeIndex } from '@/code-knowledge/builder.js';
import { writeModuleMapEvidence } from '@/code-knowledge/module-map-evidence.js';
import { queryCodeKnowledge, type QueryCard } from '@/code-knowledge/query.js';
import { writeReuseCatalog } from '@/code-knowledge/reuse-catalog.js';
import { validateCodeKnowledgeIndex } from '@/code-knowledge/schema.js';
import { readCodeKnowledgeIndex, writeCodeKnowledgeIndex } from '@/code-knowledge/store.js';
import { buildFrameworkApiIndex } from '@/framework-api/builder.js';
import { queryFrameworkApi, type FrameworkApiQueryResult } from '@/framework-api/query.js';
import { validateFrameworkApiIndex } from '@/framework-api/schema.js';
import { readFrameworkApiIndex, writeFrameworkApiIndex } from '@/framework-api/store.js';

interface BuildFlags {
  projectRoot: string;
  quiet: boolean;
}

interface FrameworkApiBuildFlags extends BuildFlags {
  force: boolean;
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
      // Regenerate the reuse catalog and fill module-map evidence.symbols from the
      // fresh index (AC-6). These are the tracked writers the index feeds; the
      // background refresh deliberately does NOT touch them.
      const catalogPath = writeReuseCatalog(options.projectRoot, index);
      const evidence = writeModuleMapEvidence(options.projectRoot, index);

      const orphans = index.files.filter((file) => file.orphan).length;
      const unusedDeps = index.dependencies.filter((dependency) => !dependency.imported).length;
      console.log(
        `**▸ paqad** · built the code-knowledge index for you — ` +
          `${index.symbols.length} symbols across ${index.files.length} files ` +
          `(${orphans} with no callers, ${unusedDeps} unused deps). ` +
          `Reuse catalog + module-map evidence refreshed.`,
      );
      if (!options.quiet) {
        process.stdout.write(
          `${JSON.stringify({
            built: true,
            path,
            reuse_catalog: catalogPath,
            module_map_modules_updated: evidence.modulesUpdated,
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

  command.addCommand(createFrameworkApiCommand());

  return command;
}

/**
 * `paqad-ai index framework-api build|query` (issue #397). The installed framework-API
 * index: for each detected framework, at the version actually installed, which exported
 * symbols exist and which carry a static `@deprecated` marker. Same shape as the parent
 * command's build/query pair, so the two read alike.
 */
function createFrameworkApiCommand(): Command {
  const command = new Command('framework-api').description(
    'Build and query the installed framework-API index (does a framework symbol exist, and is it deprecated?)',
  );

  command
    .command('build')
    .description('Build the framework-API index at .paqad/indexes/framework-api.json')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--force', 'Re-walk every package instead of reusing unchanged entries', false)
    .option('--quiet', 'Suppress the machine-readable summary line', false)
    .action((options: FrameworkApiBuildFlags) => {
      const { index, cacheHits } = buildFrameworkApiIndex(options.projectRoot, {
        force: options.force,
      });
      const validation = validateFrameworkApiIndex(index);
      if (!validation.valid) {
        console.error(
          '**▸ paqad** · the framework-API index failed schema validation — not written',
        );
        for (const error of validation.errors.slice(0, 10)) {
          console.error(`  - ${error}`);
        }
        process.exitCode = 1;
        return;
      }

      const path = writeFrameworkApiIndex(options.projectRoot, index);
      const symbols = index.packages.reduce((total, entry) => total + entry.symbols.length, 0);
      const deprecated = index.packages.reduce(
        (total, entry) => total + entry.symbols.filter((symbol) => symbol.deprecated).length,
        0,
      );
      console.log(
        `**▸ paqad** · checked your installed frameworks for you — ` +
          `${symbols} symbols across ${index.packages.length} package(s), ` +
          `${deprecated} marked deprecated (${cacheHits} reused from cache).` +
          (index.blocked.length > 0 ? ` ⚪ ${index.blocked.length} package(s) skipped.` : ''),
      );
      for (const blocked of index.blocked) {
        console.log(`> ⚪ ${blocked.package} — ${blocked.detail}`);
      }
      if (!options.quiet) {
        process.stdout.write(
          `${JSON.stringify({
            built: true,
            path,
            packages: index.packages.length,
            symbols,
            deprecated_symbols: deprecated,
            cache_hits: cacheHits,
            blocked: index.blocked.length,
          })}\n`,
        );
      }
    });

  command
    .command('query')
    .description('Look one framework symbol up at the version actually installed')
    .argument('<package>', 'The installed package name, e.g. react')
    .argument('<symbol>', 'The exported symbol, e.g. useId or Component.componentWillMount')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--quiet', 'Suppress the machine-readable summary line', false)
    .action((packageName: string, symbol: string, options: QueryFlags) => {
      const index = readFrameworkApiIndex(options.projectRoot);
      if (index === null) {
        console.error(
          '**▸ paqad** · no framework-API index yet — run `paqad-ai index framework-api build` first',
        );
        process.exitCode = 2;
        return;
      }
      const result = queryFrameworkApi(index, packageName, symbol);
      console.log(formatFrameworkCard(result));
      // A symbol that is absent or deprecated is the answer the caller acts on, so it is
      // reported through the exit code too, exactly as `index query` reports a miss.
      if (result.verdict === 'absent' || result.verdict === 'deprecated') {
        process.exitCode = 1;
      }
      if (!options.quiet) {
        process.stdout.write(`${JSON.stringify(result)}\n`);
      }
    });

  return command;
}

function formatFrameworkCard(result: FrameworkApiQueryResult): string {
  const at = result.version === null ? result.package : `${result.package}@${result.version}`;
  switch (result.verdict) {
    case 'live':
      return `**▸ paqad** · 🟢 ${result.symbol} exists in ${at} and carries no deprecation marker.`;
    case 'deprecated': {
      const since = result.record?.since === null ? '' : ` since ${result.record?.since}`;
      const removal = result.record?.for_removal === true ? ' It is slated for removal.' : '';
      return [
        `**▸ paqad** · 🔴 ${result.symbol} is deprecated in ${at}${since}.`,
        `> ${result.record?.message ?? 'no reason given'}${removal}`,
      ].join('\n');
    }
    case 'absent':
      return [
        `**▸ paqad** · 🔴 ${result.symbol} does not exist in ${at}.`,
        result.nearest === null
          ? '> No close match — check the name against the package docs.'
          : `> Did you mean "${result.nearest}"?`,
      ].join('\n');
    case 'unknown-dynamic':
      return [
        `**▸ paqad** · 🟡 ${result.symbol} is provided dynamically by ${at}.`,
        '> I could not verify it statically, so I am not claiming it is missing.',
      ].join('\n');
    default:
      return [
        `**▸ paqad** · 🟡 ${result.package} is not in the framework-API index.`,
        "> Run `paqad-ai index framework-api build`, or check the index's blocked list for why it was skipped.",
      ].join('\n');
  }
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
