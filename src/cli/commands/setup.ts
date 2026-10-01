import { readFileSync } from 'node:fs';

import { Command } from 'commander';

import { verifyReadinessToDevelop } from '@/onboarding/readiness.js';
import { readSetupPlan, validateSetupPlan } from '@/onboarding/setup-plan.js';

/**
 * `paqad-ai setup` (Slice 3) — work with the setup-plan record and the readiness check.
 *
 * paqad ships NO installers (BND-04): these verbs READ and VALIDATE the recorded plan of official
 * commands the owner/host runs and report whether the project is ready to develop. Nothing here
 * executes an installer.
 */
export function createSetupCommand(): Command {
  const setup = new Command('setup').description(
    'Inspect the setup-plan record and verify readiness to develop (Slice 3)',
  );

  const plan = new Command('plan').description('Work with the setup-plan record');

  plan
    .command('validate')
    .description('Validate a setup-plan JSON file')
    .argument('<file>', 'Path to the setup-plan JSON file')
    .action((file: string) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(file, 'utf8'));
      } catch (error) {
        console.error(`✖ could not read JSON from ${file}: ${errorMessage(error)}`);
        process.exitCode = 1;
        return;
      }

      const result = validateSetupPlan(parsed);
      if (result.ok) {
        console.log(`🟢 setup plan is valid: ${file}`);
        return;
      }

      console.error(`🔴 setup plan is invalid: ${file}`);
      for (const line of result.errors) {
        console.error(`  - ${line}`);
      }
      process.exitCode = 1;
    });

  plan
    .command('show')
    .description('Show the recorded setup plan and each step state')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((options: { projectRoot: string }) => {
      const record = readSetupPlan(options.projectRoot);
      if (!record) {
        console.log('No setup plan recorded yet (.paqad/setup-plan.json is absent).');
        return;
      }

      console.log(`Setup plan — scope: ${record.slice}`);
      record.steps.forEach((step, index) => {
        const version = step.version ? ` (v${step.version})` : '';
        const prerequisite = step.prerequisite ? ` [after ${step.prerequisite}]` : '';
        console.log(`  ${index + 1}. [${step.state}] ${step.id}${version}${prerequisite}`);
        console.log(`     ${step.description}`);
        console.log(`     run: ${step.command}`);
      });
    });

  setup.addCommand(plan);

  setup
    .command('verify')
    .description('Verify the project is ready to develop (FR-7)')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((options: { projectRoot: string }) => {
      const result = verifyReadinessToDevelop(options.projectRoot);
      if (result.ready) {
        console.log('🟢 ready to develop — commands configured and module documentation present.');
        return;
      }

      console.error('🔴 not ready to develop:');
      for (const blocker of result.blockers) {
        console.error(`  - ${blocker}`);
      }
      process.exitCode = 1;
    });

  return setup;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
