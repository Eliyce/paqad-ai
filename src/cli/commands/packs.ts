import { Command } from 'commander';

import { createPack, installPack, listPacks, removePack, validatePackAt } from '@/packs/index.js';

export function createPacksCommand(): Command {
  const command = new Command('packs').description(
    'Manage stack pack installation and scaffolding',
  );

  command
    .command('list')
    .description('List effective packs and their active sources')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--json', 'Print machine-readable output')
    .action((options: { projectRoot: string; json?: boolean }) => {
      const packs = listPacks(options.projectRoot);
      if (options.json) {
        process.stdout.write(`${JSON.stringify(packs, null, 2)}\n`);
        return;
      }

      for (const pack of packs) {
        process.stdout.write(
          `[${pack.effective_source}] ${pack.name} (${pack.tier}) — ${pack.display_name}\toverride=${pack.override_active}\tmatched=${pack.matched_in_project}\n`,
        );
      }
    });

  command
    .command('install <source>')
    .description('Install a pack from a local path, git URL, or configured registry name')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--scope <scope>', 'Installation scope (global or project)', 'global')
    .action(
      async (source: string, options: { projectRoot: string; scope: 'global' | 'project' }) => {
        const pack = await installPack(source, {
          projectRoot: options.projectRoot,
          scope: options.scope,
        });
        process.stdout.write(
          `${JSON.stringify(
            {
              name: pack.manifest.name,
              source: pack.source,
              root: pack.root,
            },
            null,
            2,
          )}\n`,
        );
      },
    );

  command
    .command('remove <name>')
    .description('Remove a project or global pack override')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--scope <scope>', 'Removal scope (global or project)', 'global')
    .action((name: string, options: { projectRoot: string; scope: 'global' | 'project' }) => {
      removePack(name, options.projectRoot, options.scope);
    });

  command
    .command('validate <path>')
    .description('Validate a pack manifest and referenced files')
    .action((path: string) => {
      const pack = validatePackAt(path);
      process.stdout.write(
        `${JSON.stringify(
          {
            name: pack.manifest.name,
            valid: true,
            issues: pack.validation.issues,
          },
          null,
          2,
        )}\n`,
      );
    });

  command
    .command('create <name>')
    .description('Scaffold a minimal valid pack')
    .option('--destination <path>', 'Destination root', process.cwd())
    .option('--ecosystem <ecosystem>', 'Ecosystem identifier', 'node')
    .option('--tier <tier>', 'Pack tier (framework or archetype)', 'framework')
    .action(
      (
        name: string,
        options: { destination: string; ecosystem: string; tier: 'framework' | 'archetype' },
      ) => {
        const created = createPack(name, {
          destinationRoot: options.destination,
          ecosystem: options.ecosystem,
          tier: options.tier,
        });
        process.stdout.write(`${created}\n`);
      },
    );

  return command;
}
