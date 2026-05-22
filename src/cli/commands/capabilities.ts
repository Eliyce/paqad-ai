import { Command } from 'commander';

import {
  addActiveCapability,
  assertActiveCapability,
  listAvailableActiveCapabilities,
  removeActiveCapability,
} from '@/core/capabilities.js';
import { readProjectProfile, writeProjectProfile } from '@/core/project-profile.js';

export function createCapabilitiesCommand(): Command {
  const command = new Command('capabilities').description('Manage active project capabilities');

  command
    .command('list')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((options: { projectRoot: string }) => {
      const profile = requireProfile(options.projectRoot);
      process.stdout.write(`${profile.active_capabilities.join('\n')}\n`);
    });

  command.command('available').action(() => {
    process.stdout.write(`${listAvailableActiveCapabilities().join('\n')}\n`);
  });

  command
    .command('add <name>')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((name: string, options: { projectRoot: string }) => {
      const profile = requireProfile(options.projectRoot);
      const next = addActiveCapability(profile, assertActiveCapability(name));
      writeProjectProfile(options.projectRoot, next);
    });

  command
    .command('remove <name>')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((name: string, options: { projectRoot: string }) => {
      const profile = requireProfile(options.projectRoot);
      const next = removeActiveCapability(profile, assertActiveCapability(name));
      writeProjectProfile(options.projectRoot, next);
    });

  return command;
}

function requireProfile(projectRoot: string) {
  const profile = readProjectProfile(projectRoot);
  if (profile === null) {
    throw new Error('Project profile not found');
  }
  return profile;
}
